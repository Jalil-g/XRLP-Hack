// XRPL-10 · XrplLedgerAdapter: the shared LedgerPort (packages/shared/src/ports.ts) over devnet.
// Core wires it for LEDGER_MODE=devnet. Keys come from the demo wallet store (WALLETS_FILE, see wallets.ts): every
// address core passes (builder, investor, credential subject) must be a wallet in that file.
// Pure mapping (results, errors, signer choice) lives in adapter-map.ts; input and phase checks run in the api.ts calls.
import { isAbsolute, resolve } from "node:path";
import { TooSoonError, type CloseResult, type LedgerPort, type Project, type ProjectChainSetup, type TxResult as PortTxResult } from "@xrlp/shared";
import type { Wallet } from "xrpl";
import { apiCodeOf, keyForRole, pickQuorumSigners, SIGNING_ROLES, spvSignerCandidates, toAdapterError, toPortTx, XrplLedgerError } from "./adapter-map.ts";
import {
  builderPayToSpv,
  cancelExpiredMilestone,
  closeLoanAndCreateEscrows as closeLoanApi,
  depositToVault,
  forbiddenSpvSigners,
  PLATFORM_SCOPE,
  releaseMilestone,
  repayLoan as repayLoanApi,
  setupProjectOnChain as setupProjectApi,
  tryFinishWithWrongFulfillment,
  withdrawFromVault,
} from "./api.ts";
import { ledgerTime, type TxResult } from "./client.ts";
import { attest, ATTEST_EVENT_KIND, createDomain, grantCredential, payVerificationFee, submitSignedBlob } from "./compliance.ts";
import { assertSecretPath, config, REPO_ROOT } from "./config.ts";
import { FINISH_LLS_MARGIN } from "./escrow.ts";
import { getLoan, planLoanPayment } from "./loan.ts";
import { preflightFinish } from "./preflight.ts";
import { getBalance, getEscrowSnapshot, getLoanSnapshot, getVaultSnapshot, listEscrowsParsed } from "./reads.ts";
import { getSpvInfo, spvSignerProblems } from "./spv.ts";
import { loadWallets, type DemoWallets } from "./wallets.ts";

export { XrplLedgerError, apiCodeOf, toAdapterError } from "./adapter-map.ts";

type Arg<K extends keyof LedgerPort> = LedgerPort[K] extends (p: infer P, ...rest: never[]) => unknown ? P : never;

export interface XrplLedgerAdapterOptions {
  /** Wallet store path (absolute, or relative to the repo root). Sets the process-wide WALLETS_FILE. Default: env / .data/wallets.json. */
  walletsFile?: string;
  /** One line per submitted tx (explorer link) and per refusal. Default: silent. */
  log?: (line: string) => void;
  /** Private vault gated by the platform's KYC_INVESTOR PermissionedDomain + non-transferable shares. Default true. */
  privateVault?: boolean;
  /**
   * EscrowFinish LastLedgerSequence headroom (ledgers) and preflight's minimum seconds to CancelAfter. `preflightFinish`
   * and `finishEscrow` both use them, so a preflight `ok` is not then refused by the finish. Defaults: FINISH_LLS_MARGIN
   * (60 ledgers, so preflight wants >= 300 s before CancelAfter) and preflight's 120 s. Short-dated spikes: `{ lastLedgerMargin: 20, marginS: 60 }`.
   */
  finishMargins?: { lastLedgerMargin?: number; marginS?: number };
}

export class XrplLedgerAdapter implements LedgerPort {
  readonly mode = "devnet" as const;
  private readonly log: (line: string) => void;
  private readonly privateVault: boolean;
  private readonly finishMargins: { lastLedgerMargin: number; marginS?: number };
  /** projectId -> builder address, learned at setup/close (Project only carries builderId). */
  private readonly builders = new Map<string, string>();

  constructor(opts: XrplLedgerAdapterOptions = {}) {
    if (opts.walletsFile) config.walletsFile = assertSecretPath(isAbsolute(opts.walletsFile) ? opts.walletsFile : resolve(REPO_ROOT, opts.walletsFile), "file", "walletsFile");
    this.log = opts.log ?? (() => {});
    this.privateVault = opts.privateVault ?? true;
    this.finishMargins = {
      lastLedgerMargin: opts.finishMargins?.lastLedgerMargin ?? FINISH_LLS_MARGIN,
      ...(opts.finishMargins?.marginS !== undefined ? { marginS: opts.finishMargins.marginS } : {}),
    };
  }

  // ------------------------------------------------------------ onboarding / compliance

  payVerificationFee(p: Arg<"payVerificationFee">): Promise<PortTxResult> {
    return this.run("payVerificationFee", async () => {
      const { tx } = await payVerificationFee({ builder: this.key(p.builder, "builder", SIGNING_ROLES.builder), amount: p.amount });
      return this.tx("verification fee", tx, "verification_fee_paid");
    });
  }

  /** Idempotent: an already issued + accepted credential returns `[]` (nothing submitted). */
  issueCredential(p: Arg<"issueCredential">): Promise<PortTxResult[]> {
    return this.run("issueCredential", async () => {
      const r = await grantCredential({ subject: this.key(p.subject, `${p.type} subject`, SIGNING_ROLES[p.type]), type: p.type });
      const out: PortTxResult[] = [];
      if (r.createTx) out.push(this.tx(`CredentialCreate ${p.type}`, r.createTx, "credential_issued"));
      if (r.acceptTx) out.push(this.tx(`CredentialAccept ${p.type}`, r.acceptTx, "credential_accepted"));
      if (!out.length) this.log(`  ${p.type} for ${p.subject}: already ${r.status}, nothing submitted`);
      return out;
    });
  }

  // ------------------------------------------------------------ project setup

  setupProjectOnChain(p: Arg<"setupProjectOnChain">): Promise<ProjectChainSetup> {
    return this.run("setupProjectOnChain", async () => {
      const w = this.wallets();
      const inspector = p.inspectors[0];
      if (!inspector) throw new XrplLedgerError("validation", "setupProjectOnChain: no inspector assigned (SPV signer list needs builder + inspector)");
      const slots = [w.platform.classicAddress, p.builder.address, inspector, w.trustee.classicAddress];
      if (new Set(slots).size !== slots.length) throw new XrplLedgerError("validation", `setupProjectOnChain: SPV signers must be 4 distinct accounts (platform, builder, inspector, trustee), got ${slots.join(", ")}`);
      // Before any tx (the domain below included): no AI / releaseService / issuer key on the SPV list (M6).
      const signerIssues = spvSignerProblems({ platform: slots[0]!, builder: slots[1]!, inspector, trustee: slots[3]! }, forbiddenSpvSigners(w));
      if (signerIssues.length) throw new XrplLedgerError("validation", `setupProjectOnChain: ${signerIssues.join("; ")}`);

      const txs: PortTxResult[] = [];
      let domainId: string | undefined;
      if (this.privateVault) {
        const d = await createDomain();
        domainId = d.domainId;
        if (d.tx) txs.push(this.tx("PermissionedDomainSet", d.tx));
      }
      const s = await setupProjectApi(p.project, {
        subscriptionEndsAt: new Date(p.subscriptionDate),
        redemptionAt: new Date(p.redemptionDate),
        ...(p.coverDeposit ? { coverDeposit: p.coverDeposit } : {}),
        spvSigners: { builder: p.builder.address, inspector },
        ...(domainId ? { domainId, nonTransferableShares: true } : {}),
      });
      const steps: [keyof typeof s.txs, string, PortTxResult["kind"]][] = [
        ["spvTrustSet", "SPV TrustSet", undefined],
        ["spvSignerListSet", "SPV SignerListSet", undefined],
        ["spvDisableMaster", "SPV disable master", undefined],
        ["vaultCreate", "VaultCreate", "vault_created"],
        ["loanBrokerSet", "LoanBrokerSet", "loan_broker_created"],
        ["loanBrokerCoverDeposit", "LoanBrokerCoverDeposit", "cover_deposited"],
      ];
      for (const [key, label, kind] of steps) {
        const t = s.txs[key];
        if (t) txs.push(this.tx(label, t, kind));
      }
      this.builders.set(p.project.id, p.builder.address);
      return {
        spv: s.spv,
        vaultId: s.vaultId,
        loanBrokerId: s.loanBrokerId,
        shareMptIssuanceId: s.shareMptIssuanceId,
        subscriptionDate: s.subscriptionEndsAt,
        redemptionDate: s.redemptionAt,
        txs,
      };
    });
  }

  deposit(p: Arg<"deposit">): Promise<PortTxResult> {
    return this.run("deposit", async () => {
      const { tx } = await depositToVault({ projectId: p.project.id, vaultId: chain(p.project, "vaultId"), investor: this.key(p.investor, "investor", SIGNING_ROLES.investor), amount: p.amount });
      return this.tx(`VaultDeposit ${p.amount}`, tx, "vault_deposit");
    });
  }

  /** Throws TooSoonError (nothing submitted) while the vault is not in Redemption. */
  withdraw(p: Arg<"withdraw">): Promise<PortTxResult> {
    return this.run("withdraw", async () => {
      const vaultId = chain(p.project, "vaultId");
      const snap = await getVaultSnapshot(vaultId);
      if (!snap) throw new XrplLedgerError("not_found", `vault ${vaultId} not found`);
      // Port contract: TooSoonError before RedemptionDate. withdrawFromVault only refuses the Investment phase (the ledger
      // allows Subscription-phase withdrawals), so this stricter check stays.
      if (snap.phase !== "redemption") throw new TooSoonError(`withdrawals open at RedemptionDate ${snap.redemptionDate} (vault is in ${snap.phase})`);
      const { tx } = await withdrawFromVault({ projectId: p.project.id, vaultId, investor: this.key(p.investor, "investor", SIGNING_ROLES.investor), amount: p.amount });
      return this.tx(`VaultWithdraw ${p.amount}`, tx, "vault_withdraw");
    });
  }

  /**
   * LoanSet + EscrowCreate x N via api.ts `closeLoanAndCreateEscrows`, which checks everything before the first tx:
   * TooSoonError while the ledger is at or before SubscriptionDate; `planLoanClose` (one PREIMAGE-SHA-256 condition +
   * CancelAfter per milestone by index, no duplicates incl. the SPV's open escrows, now + 60 s < CancelAfter < maturity)
   * -> CloseValidationError -> `validation`. An EscrowCreate failing after LoanSet -> CloseLoanPartialError (`ledger_error`).
   */
  closeLoanAndCreateEscrows(p: Arg<"closeLoanAndCreateEscrows">): Promise<CloseResult> {
    return this.run("closeLoanAndCreateEscrows", async () => {
      const spv = chain(p.project, "spv");
      chain(p.project, "vaultId");
      chain(p.project, "loanBrokerId");
      const w = this.wallets();
      const signers = await this.spvQuorum(spv, [p.builder.address, w.platform.classicAddress, w.trustee.classicAddress]);
      this.builders.set(p.project.id, p.builder.address);
      const r = await closeLoanApi(p.project, {
        conditions: p.conditions,
        cancelAfters: p.cancelAfters,
        builderAddress: p.builder.address,
        ...(this.held(p.builder.address, SIGNING_ROLES.builder) ? { originationFeePayer: p.builder.address } : {}),
        spvSigners: signers,
        waitForInvestmentPhase: false,
      });
      // r.txs = [LoanSet, EscrowCreate x N]. Extra txs go LAST so txs[0] = LoanSet and txs[1..N] = EscrowCreate per milestone stays true.
      const txs = [
        this.tx("LoanSet", r.loanSetTx, "loan_set"),
        ...r.txs.slice(1).map((t, i) => this.tx(`EscrowCreate ${r.escrows[i]?.milestoneId} seq ${r.escrows[i]?.offerSequence}`, t, "escrow_created")),
        ...(r.originationFeeTopUpTx ? [this.tx("origination fee top-up (builder -> SPV)", r.originationFeeTopUpTx)] : []),
      ];
      return {
        loanId: r.loanId,
        escrows: r.escrows.map((e) => ({ milestoneId: e.milestoneId, owner: e.owner, offerSequence: e.offerSequence, condition: e.condition, cancelAfter: e.cancelAfter, createTx: e.createTx })),
        txs,
      };
    });
  }

  // ------------------------------------------------------------ release path

  /** Read-only. Checks as the releaseService (the account that will submit the finish). */
  preflightFinish(p: Arg<"preflightFinish">): Promise<{ ok: boolean; reason?: string }> {
    return this.run("preflightFinish", async () => {
      const r = await preflightFinish({
        owner: p.owner,
        offerSequence: p.offerSequence,
        destination: p.destination,
        submitter: this.wallets().releaseService.classicAddress,
        lastLedgerOffset: this.finishMargins.lastLedgerMargin,
        ...(this.finishMargins.marginS !== undefined ? { marginS: this.finishMargins.marginS } : {}),
      });
      if (r.ok) return { ok: true };
      this.log(`  preflight refused ${p.owner}/${p.offerSequence}: ${r.reason}`);
      return { ok: false, reason: `${r.reason}: ${r.message}` };
    });
  }

  /** EscrowFinish by releaseService; re-runs preflight first (UnsafeReleaseError -> code unsafe_release, nothing submitted). */
  finishEscrow(p: Arg<"finishEscrow">): Promise<PortTxResult> {
    return this.run("finishEscrow", async () => {
      const { tx } = await releaseMilestone({
        projectId: PLATFORM_SCOPE,
        milestoneId: "",
        escrow: { owner: p.owner, offerSequence: p.offerSequence, condition: p.condition },
        fulfillment: p.fulfillment,
        submitter: this.wallets().releaseService,
        ...this.finishMargins,
      });
      return this.tx(`EscrowFinish ${p.owner}/${p.offerSequence}`, tx, "escrow_finished");
    });
  }

  /**
   * Route 23: platform submits EscrowFinish with a random (wrong) fulfillment. Resolves with the tec result
   * (`tecCRYPTOCONDITION_ERROR`). Refuses (`unsafe_release`, nothing submitted) if the escrow is gone or near/past CancelAfter.
   */
  tryFinishWithWrongFulfillment(p: Arg<"tryFinishWithWrongFulfillment">): Promise<PortTxResult> {
    return this.run("tryFinishWithWrongFulfillment", async () => {
      const { tx } = await tryFinishWithWrongFulfillment({ owner: p.owner, offerSequence: p.offerSequence, condition: p.condition, submitter: this.wallets().platform });
      return this.tx(`EscrowFinish (wrong fulfillment) ${p.owner}/${p.offerSequence}`, tx, "release_refused");
    });
  }

  /**
   * EscrowCancel by releaseService. Checked on one validated ledger before submitting: consumed -> `not_found`
   * (local tecNO_TARGET); ledger time at or before CancelAfter -> TooSoonError. Nothing is submitted in either case.
   */
  cancelEscrow(p: Arg<"cancelEscrow">): Promise<PortTxResult> {
    return this.run("cancelEscrow", async () => {
      const { tx } = await cancelExpiredMilestone({
        projectId: PLATFORM_SCOPE,
        milestoneId: "",
        escrow: { owner: p.owner, offerSequence: p.offerSequence },
        submitter: this.wallets().releaseService,
      });
      return this.tx(`EscrowCancel ${p.owner}/${p.offerSequence}`, tx, "escrow_cancelled");
    });
  }

  /**
   * LoanPay from the SPV (multisig). source "builder": the builder first pays `amount` RLUSD into the SPV
   * (`builderPayToSpv`, logged; the port returns only the LoanPay). "escrow_refund": the SPV already holds the refunded
   * RLUSD. Mode comes from `planLoanPayment`: past due -> late; escrow_refund above one periodic payment -> overpayment
   * (extra goes to principal); else regular. The amount is checked before ANY tx (LoanPayAmountError -> `validation`),
   * and so is the SPV quorum, so a refused LoanPay never strands the builder's Payment in the SPV.
   */
  repayLoan(p: Arg<"repayLoan">): Promise<PortTxResult> {
    return this.run("repayLoan", async () => {
      const spv = chain(p.project, "spv");
      const loanId = chain(p.project, "loanId");
      const w = this.wallets();
      const [loan, now] = await Promise.all([getLoan(loanId), ledgerTime()]);
      if (!loan) throw new XrplLedgerError("not_found", `loan ${loanId} not found (paid off or never created)`);
      planLoanPayment({ loan, nowRipple: now, amount: p.amount, source: p.source });
      const builder = await this.builderOf(p.project);
      const signers = await this.spvQuorum(spv, [builder, w.platform.classicAddress, w.trustee.classicAddress]);
      if (p.source === "builder") {
        const pay = await builderPayToSpv({ projectId: p.project.id, spv, amount: p.amount, builder: this.key(builder, "builder", SIGNING_ROLES.builder) });
        this.tx(`builder -> SPV ${p.amount} RLUSD`, pay.tx);
      }
      const r = await repayLoanApi({ projectId: p.project.id, spv, loanId, amount: p.amount, source: p.source, signers });
      return this.tx(`LoanPay ${r.amount} (${r.mode}, ${p.source})`, r.tx, "loan_payment");
    });
  }

  attest(p: Arg<"attest">): Promise<PortTxResult> {
    return this.run("attest", async () => {
      if (!(SIGNING_ROLES.attest as readonly string[]).includes(p.signer)) {
        throw new XrplLedgerError("validation", `attest: signer must be one of ${SIGNING_ROLES.attest.join(", ")} (value not echoed)`);
      }
      const { tx } = await attest({ signer: p.signer, spv: p.spv, memo: p.memo });
      return this.tx(`attest ${p.memo.kind} (${p.signer})`, tx, ATTEST_EVENT_KIND[p.memo.kind]);
    });
  }

  submitSignedBlob(blob: string): Promise<PortTxResult> {
    return this.run("submitSignedBlob", async () => {
      const { tx, memo, signer } = await submitSignedBlob(blob);
      return this.tx(`attest ${memo.kind} (signed by ${signer})`, tx, ATTEST_EVENT_KIND[memo.kind]);
    });
  }

  // ------------------------------------------------------------ reads

  getVaultSnapshot(p: Arg<"getVaultSnapshot">) {
    return this.run("getVaultSnapshot", async () => {
      const s = await getVaultSnapshot(p.vaultId);
      if (!s) throw new XrplLedgerError("not_found", `vault ${p.vaultId} not found`);
      return s;
    });
  }

  getLoanSnapshot(p: Arg<"getLoanSnapshot">) {
    return this.run("getLoanSnapshot", async () => {
      const s = await getLoanSnapshot(p.loanId);
      if (!s) throw new XrplLedgerError("not_found", `loan ${p.loanId} not found`);
      return s;
    });
  }

  /** `null` = consumed (finished / cancelled) or never created. */
  getEscrow(owner: string, offerSequence: number) {
    return this.run("getEscrow", () => getEscrowSnapshot(owner, offerSequence));
  }

  getBalance(account: string, currency: "XRP" | "RLUSD"): Promise<string> {
    return this.run("getBalance", () => getBalance(account, currency, currency === "RLUSD" ? { issuer: this.wallets().issuer.classicAddress } : {}));
  }

  // ------------------------------------------------------------ helpers

  private wallets(): DemoWallets {
    return loadWallets();
  }

  /** Wallet for `address` among the `roles` keys of the store, if it is one. */
  private held(address: string, roles: readonly string[]): Wallet | undefined {
    const w = this.wallets() as Record<string, Wallet>;
    return roles.map((r) => w[r]).find((x) => x?.classicAddress === address);
  }

  /** The key for `address`, which must belong to one of `roles` (security review M4); else `validation`, nothing signed. */
  private key(address: string, label: string, roles: readonly string[]): Wallet {
    return keyForRole(this.wallets(), address, roles, label, config.walletsFile);
  }

  /** Signers for the SPV's on-ledger list (quorum 3) whose keys we hold, preferred ones first. */
  private async spvQuorum(spv: string, prefer: string[]): Promise<Wallet[]> {
    const info = await getSpvInfo(spv);
    if (info.signerQuorum == null) throw new XrplLedgerError("validation", `SPV ${spv} has no signer list`);
    const all = spvSignerCandidates(this.wallets());
    return pickQuorumSigners({ quorum: info.signerQuorum, signers: info.signers }, (a) => all.find((w) => w.classicAddress === a), prefer);
  }

  /** Builder address of a project: learned at setup/close, else the destination of an SPV escrow, else the demo builder. */
  private async builderOf(project: Project): Promise<string> {
    const known = this.builders.get(project.id);
    if (known) return known;
    const fromEscrow = (await listEscrowsParsed(chain(project, "spv")))[0]?.destination;
    const addr = fromEscrow ?? this.wallets().builder.classicAddress;
    this.builders.set(project.id, addr);
    return addr;
  }

  private tx(label: string, tx: TxResult, kind?: PortTxResult["kind"]): PortTxResult {
    this.log(`  ${label}: ${tx.result} ${tx.explorerUrl}`);
    return toPortTx(tx, kind);
  }

  private async run<T>(op: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      const err = toAdapterError(e, op);
      this.log(`  ${op} failed [${apiCodeOf(err)}]: ${err.message}`);
      throw err;
    }
  }
}

function chain<K extends "spv" | "vaultId" | "loanBrokerId" | "loanId">(project: Project, key: K): string {
  const v = project.chain?.[key];
  if (!v) throw new XrplLedgerError("validation", `project ${project.id} has no chain.${key} (run the earlier lifecycle step first)`);
  return v;
}
