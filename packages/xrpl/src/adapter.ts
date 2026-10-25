// XRPL-10 · XrplLedgerAdapter: the shared LedgerPort (packages/shared/src/ports.ts) over devnet.
// Core wires it for LEDGER_MODE=devnet. Keys come from the demo wallet store (WALLETS_FILE, see wallets.ts): every
// address core passes (builder, investor, credential subject) must be a wallet in that file.
// Pure mapping (results, errors, signer choice, input checks) lives in adapter-map.ts.
import { isAbsolute, resolve } from "node:path";
import { TooSoonError, type Builder, type CloseResult, type LedgerPort, type Project, type ProjectChainSetup, type TxResult as PortTxResult } from "@xrlp/shared";
import { rippleTimeToISOTime, type Wallet } from "xrpl";
import {
  apiCodeOf,
  pickQuorumSigners,
  repayMode,
  tecToPortTx,
  toEscrowSnapshot,
  toLedgerError,
  toPortTx,
  validateCloseInputs,
  XrplLedgerError,
} from "./adapter-map.ts";
import {
  cancelExpiredMilestone,
  closeLoanAndCreateEscrows as closeLoanApi,
  depositToVault,
  PLATFORM_SCOPE,
  releaseMilestone,
  repayLoan as repayLoanApi,
  setupProjectOnChain as setupProjectApi,
  withdrawFromVault,
} from "./api.ts";
import { ledgerTime, signAndSubmit, XrplTxError, type TxResult } from "./client.ts";
import { attest, ATTEST_EVENT_KIND, createDomain, grantCredential, payVerificationFee, submitSignedBlob } from "./compliance.ts";
import { generateMilestoneCondition } from "./condition.ts";
import { config, REPO_ROOT } from "./config.ts";
import { loanScheduleFromTerms } from "./lending-math.ts";
import { getLoan } from "./loan.ts";
import { preflightFinish } from "./preflight.ts";
import { getBalance, getEscrow, getLoanSnapshot, getVaultSnapshot, listEscrowsParsed } from "./reads.ts";
import { payRlusd } from "./rlusd.ts";
import { getSpvInfo } from "./spv.ts";
import { getVault } from "./vault.ts";
import { loadWallets, type DemoWallets } from "./wallets.ts";

export { XrplLedgerError, apiCodeOf, toLedgerError } from "./adapter-map.ts";

type Arg<K extends keyof LedgerPort> = LedgerPort[K] extends (p: infer P, ...rest: never[]) => unknown ? P : never;

export interface XrplLedgerAdapterOptions {
  /** Wallet store path (absolute, or relative to the repo root). Sets the process-wide WALLETS_FILE. Default: env / .data/wallets.json. */
  walletsFile?: string;
  /** One line per submitted tx (explorer link) and per refusal. Default: silent. */
  log?: (line: string) => void;
  /** Private vault gated by the platform's KYC_INVESTOR PermissionedDomain + non-transferable shares. Default true. */
  privateVault?: boolean;
}

export class XrplLedgerAdapter implements LedgerPort {
  readonly mode = "devnet" as const;
  private readonly log: (line: string) => void;
  private readonly privateVault: boolean;
  /** projectId -> builder address, learned at setup/close (Project only carries builderId). */
  private readonly builders = new Map<string, string>();

  constructor(opts: XrplLedgerAdapterOptions = {}) {
    if (opts.walletsFile) config.walletsFile = isAbsolute(opts.walletsFile) ? opts.walletsFile : resolve(REPO_ROOT, opts.walletsFile);
    this.log = opts.log ?? (() => {});
    this.privateVault = opts.privateVault ?? true;
  }

  // ------------------------------------------------------------ onboarding / compliance

  payVerificationFee(p: Arg<"payVerificationFee">): Promise<PortTxResult> {
    return this.run("payVerificationFee", async () => {
      const { tx } = await payVerificationFee({ builder: this.key(p.builder, "builder"), amount: p.amount });
      return this.tx("verification fee", tx, "verification_fee_paid");
    });
  }

  /** Idempotent: an already issued + accepted credential returns `[]` (nothing submitted). */
  issueCredential(p: Arg<"issueCredential">): Promise<PortTxResult[]> {
    return this.run("issueCredential", async () => {
      const r = await grantCredential({ subject: this.key(p.subject, "credential subject"), type: p.type });
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
      const { tx } = await depositToVault({ projectId: p.project.id, vaultId: chain(p.project, "vaultId"), investor: this.key(p.investor, "investor"), amount: p.amount });
      return this.tx(`VaultDeposit ${p.amount}`, tx, "vault_deposit");
    });
  }

  /** Throws TooSoonError (nothing submitted) while the vault is not in Redemption. */
  withdraw(p: Arg<"withdraw">): Promise<PortTxResult> {
    return this.run("withdraw", async () => {
      const vaultId = chain(p.project, "vaultId");
      const snap = await getVaultSnapshot(vaultId);
      if (!snap) throw new XrplLedgerError("not_found", `vault ${vaultId} not found`);
      if (snap.phase !== "redemption") throw new TooSoonError(`withdrawals open at RedemptionDate ${snap.redemptionDate} (vault is in ${snap.phase})`);
      // after XRPL-07 merge: withdrawFromVault throws TooSoonError itself; the pre-check above stays (no tx fee on a refusal).
      const { tx } = await withdrawFromVault({ projectId: p.project.id, vaultId, investor: this.key(p.investor, "investor"), amount: p.amount });
      return this.tx(`VaultWithdraw ${p.amount}`, tx, "vault_withdraw");
    });
  }

  /** TooSoonError (nothing submitted) until the validated ledger is past SubscriptionDate. Inputs validated before any tx. */
  closeLoanAndCreateEscrows(p: Arg<"closeLoanAndCreateEscrows">): Promise<CloseResult> {
    return this.run("closeLoanAndCreateEscrows", async () => {
      const spv = chain(p.project, "spv");
      const vaultId = chain(p.project, "vaultId");
      chain(p.project, "loanBrokerId");
      const [vault, now] = await Promise.all([getVault(vaultId), ledgerTime()]);
      if (!vault) throw new XrplLedgerError("not_found", `vault ${vaultId} not found`);
      const sub = vault.SubscriptionDate ?? 0;
      if (now <= sub) throw new TooSoonError(`LoanSet allowed after SubscriptionDate ${rippleTimeToISOTime(sub)} (ledger now ${rippleTimeToISOTime(now)}, ${sub - now + 1}s to go)`);
      const sched = loanScheduleFromTerms(p.project.terms);
      validateCloseInputs({
        milestoneCount: p.project.milestones.length,
        conditions: p.conditions,
        cancelAfters: p.cancelAfters,
        nowRipple: now,
        maturityFloorRipple: Math.max(now, sub) + sched.paymentTotal * sched.paymentIntervalS,
      });
      const w = this.wallets();
      const signers = await this.spvQuorum(spv, [p.builder.address, w.platform.classicAddress, w.trustee.classicAddress]);
      this.builders.set(p.project.id, p.builder.address);

      const r = await this.closeLoan(p.project, p.builder, p.conditions, p.cancelAfters, signers);
      const loanSet = this.tx("LoanSet", r.loanSetTx, "loan_set");
      const escrowTxs = r.escrowTxs.map((t, i) => {
        this.log(`  EscrowCreate ${p.project.milestones[i]?.id} seq ${r.escrows[i]?.offerSequence}: ${t.result} ${t.explorerUrl}`);
        return t;
      });
      // Extra txs go LAST so txs[0] = LoanSet and txs[1..N] = EscrowCreate per milestone stays true.
      const extra = r.originationFeeTopUpTx ? [this.tx("origination fee top-up (builder -> SPV)", r.originationFeeTopUpTx)] : [];
      return { loanId: r.loanId, escrows: r.escrows, txs: [loanSet, ...escrowTxs, ...extra] };
    });
  }

  // ------------------------------------------------------------ release path

  /** Read-only. Checks as the releaseService (the account that will submit the finish). */
  preflightFinish(p: Arg<"preflightFinish">): Promise<{ ok: boolean; reason?: string }> {
    return this.run("preflightFinish", async () => {
      const r = await preflightFinish({ owner: p.owner, offerSequence: p.offerSequence, destination: p.destination, submitter: this.wallets().releaseService.classicAddress });
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
      });
      return this.tx(`EscrowFinish ${p.owner}/${p.offerSequence}`, tx, "escrow_finished");
    });
  }

  /** Route 23: platform submits EscrowFinish with a random (wrong) fulfillment. Resolves with the tec result. */
  tryFinishWithWrongFulfillment(p: Arg<"tryFinishWithWrongFulfillment">): Promise<PortTxResult> {
    return this.run("tryFinishWithWrongFulfillment", async () => {
      const t = await this.submitWrongFulfillment(p.owner, p.offerSequence, p.condition);
      this.log(`  EscrowFinish (wrong fulfillment) ${p.owner}/${p.offerSequence}: ${t.result} ${t.explorerUrl}`);
      return t;
    });
  }

  /** EscrowCancel by releaseService. not_found if consumed; TooSoonError (nothing submitted) before CancelAfter. */
  cancelEscrow(p: Arg<"cancelEscrow">): Promise<PortTxResult> {
    return this.run("cancelEscrow", async () => {
      const e = await getEscrow(p.owner, p.offerSequence);
      if (!e) throw new XrplLedgerError("not_found", `escrow ${p.owner}/${p.offerSequence} not found (already finished or cancelled)`);
      if (!e.cancellable) throw new TooSoonError(`escrow ${p.owner}/${p.offerSequence} can be cancelled after CancelAfter ${e.cancelAfter ?? "(none)"}`);
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
   * LoanPay from the SPV (multisig). source "builder": the builder first pays `amount` RLUSD into the SPV (logged; the
   * port returns only the LoanPay). "escrow_refund": the SPV already holds the refunded RLUSD. More than one periodic
   * payment -> tfLoanOverpayment (extra goes to principal).
   */
  repayLoan(p: Arg<"repayLoan">): Promise<PortTxResult> {
    return this.run("repayLoan", async () => {
      const spv = chain(p.project, "spv");
      const loanId = chain(p.project, "loanId");
      const w = this.wallets();
      const [loan, now] = await Promise.all([getLoan(loanId), ledgerTime()]);
      if (!loan) throw new XrplLedgerError("not_found", `loan ${loanId} not found (paid off or never created)`);
      const builder = await this.builderOf(p.project);
      if (p.source === "builder") {
        // after XRPL-07 merge: builderPayToSpv({ projectId, builder, spv, amount }) and repayLoan({ ..., source }) does both.
        const pay = await payRlusd(this.key(builder, "builder"), spv, w.issuer.classicAddress, p.amount);
        this.tx(`builder -> SPV ${p.amount} RLUSD`, pay);
      }
      const mode = repayMode({
        amount: p.amount,
        periodicPayment: loan.PeriodicPayment ?? "0",
        serviceFee: loan.LoanServiceFee,
        nowRipple: now,
        ...(loan.NextPaymentDueDate != null ? { nextPaymentDueRipple: loan.NextPaymentDueDate } : {}),
      });
      const signers = await this.spvQuorum(spv, [builder, w.platform.classicAddress, w.trustee.classicAddress]);
      const { tx } = await repayLoanApi({ projectId: p.project.id, spv, loanId, amount: p.amount, mode, signers });
      return this.tx(`LoanPay ${p.amount} (${mode}, ${p.source})`, tx, "loan_payment");
    });
  }

  attest(p: Arg<"attest">): Promise<PortTxResult> {
    return this.run("attest", async () => {
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
    return this.run("getEscrow", async () => {
      const v = await getEscrow(owner, offerSequence);
      return v ? toEscrowSnapshot(v, offerSequence) : null;
    });
  }

  getBalance(account: string, currency: "XRP" | "RLUSD"): Promise<string> {
    return this.run("getBalance", () => getBalance(account, currency, currency === "RLUSD" ? { issuer: this.wallets().issuer.classicAddress } : {}));
  }

  // ------------------------------------------------------------ package calls that change when XRPL-06/07 merge

  private async closeLoan(project: Project, builder: Builder, conditions: string[], cancelAfters: string[], signers: Wallet[]) {
    // after XRPL-06 merge (1 line): closeLoanApi(project, { conditions, cancelAfters, builderAddress: builder.address, spvSigners: signers, waitForInvestmentPhase: false })
    const withDeadlines: Project = { ...project, milestones: project.milestones.map((m, i) => ({ ...m, cancelAfter: cancelAfters[i]! })) };
    const r = await closeLoanApi(withDeadlines, {
      conditions: project.milestones.map((m, i) => ({ milestoneId: m.id, condition: conditions[i]! })),
      builderAddress: builder.address,
      ...(this.held(builder.address) ? { originationFeePayer: builder.address } : {}),
      spvSigners: signers,
      waitForInvestmentPhase: false,
    });
    const created = r.events.filter((e) => e.kind === "escrow_created");
    return {
      loanId: r.loanId,
      loanSetTx: r.loanSetTx,
      originationFeeTopUpTx: r.originationFeeTopUpTx,
      escrows: r.escrows.map((e) => ({ milestoneId: e.milestoneId, owner: e.owner, offerSequence: e.offerSequence, condition: e.condition, cancelAfter: e.cancelAfter, createTx: e.createTx })),
      escrowTxs: created.map((e): PortTxResult => ({ hash: e.txHash, explorerUrl: e.explorerUrl, result: "tesSUCCESS", kind: "escrow_created", at: e.at })),
    };
  }

  private async submitWrongFulfillment(owner: string, offerSequence: number, condition: string): Promise<PortTxResult> {
    // after XRPL-07 merge (1 line): return toPortTx((await tryFinishWithWrongFulfillment({ owner, offerSequence, condition, submitter: platform })).tx, "release_refused")
    const platform = this.wallets().platform;
    const wrong = generateMilestoneCondition().fulfillment; // fresh random preimage: never a stored one
    try {
      const tx = await signAndSubmit(platform, { TransactionType: "EscrowFinish", Account: platform.classicAddress, Owner: owner, OfferSequence: offerSequence, Condition: condition, Fulfillment: wrong });
      return toPortTx(tx, "escrow_finished"); // 2^-256: the random preimage matched
    } catch (e) {
      const t = e instanceof XrplTxError ? tecToPortTx(e, "release_refused") : undefined;
      if (t) return t;
      throw e;
    }
  }

  // ------------------------------------------------------------ helpers

  private wallets(): DemoWallets {
    return loadWallets();
  }

  /** Wallet for `address` from the store, if we hold its key. */
  private held(address: string): Wallet | undefined {
    return Object.values(this.wallets()).find((w) => w.classicAddress === address);
  }

  private key(address: string, role: string): Wallet {
    const w = this.held(address);
    if (!w) throw new XrplLedgerError("validation", `no key for ${role} ${address} in ${config.walletsFile} (devnet demo: every signing account must be a bootstrapped wallet)`);
    return w;
  }

  /** Signers for the SPV's on-ledger list (quorum 3) whose keys we hold, preferred ones first. */
  private async spvQuorum(spv: string, prefer: string[]): Promise<Wallet[]> {
    const info = await getSpvInfo(spv);
    if (info.signerQuorum == null) throw new XrplLedgerError("validation", `SPV ${spv} has no signer list`);
    const all = Object.values(this.wallets());
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
      const err = toLedgerError(e, op);
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
