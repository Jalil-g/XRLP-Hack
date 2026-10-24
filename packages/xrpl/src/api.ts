// High-level API for @xrlp/core. Each call does real devnet txs and returns ChainEvents.
// Wallets come from .data/wallets.json (bootstrapWallets). Pass a Wallet to override a role.
import type { ChainEvent, Milestone, Project } from "@xrlp/shared";
import { isoTimeToRippleTime, rippleTimeToISOTime, type Wallet } from "xrpl";
import { ledgerTime, waitForLedgerTimeAfter, type TxResult } from "./client.ts";
import { submitAttestation, type AttestationPayload } from "./attest.ts";
import { acceptCredential, createCredential, type CredentialType } from "./credentials.ts";
import { cancelEscrow, createMilestoneEscrow, finishEscrow } from "./escrow.ts";
import { toChainEvent } from "./events.ts";
import { createLoanBroker, depositBrokerCover, getLoan, loanPayMultisig, loanSet, type LoanPayMode } from "./loan.ts";
import { configureIssuer, ensureTrustline, topUpRlusd } from "./rlusd.ts";
import { createSpvAccount, lockSpv, type SpvSigners } from "./spv.ts";
import { createVault, depositToVaultTx, getShareBalance, getVault, vaultPhase, withdrawFromVaultTx } from "./vault.ts";
import { ensureFundedWallets, loadWallets, rememberSpv, resolveWallet, RLUSD_HOLDERS, rlusdTopUpPlan, type DemoWallets, type WalletRole } from "./wallets.ts";

/** Role name ("investor1"), a demo-wallet address (r...), or a Wallet. */
type WalletRef = WalletRole | string | Wallet;
const addr = (w: WalletRef) => resolveWallet(w).classicAddress;
const DAY = 86_400;
/** ChainEvent.projectId for events not tied to a project (matches core's PLATFORM_SCOPE). */
export const PLATFORM_SCOPE = "_platform";

// ---------------------------------------------------------------- bootstrap

export interface BootstrapOptions {
  fresh?: boolean;
  /** RLUSD each investor is topped up to. Default 50 000. */
  investorRlusd?: number;
  /** RLUSD the platform holds for first-loss cover across projects. Default 25 000. */
  platformRlusd?: number;
  /** RLUSD the builder holds for the verification fee (250 in the demo). Default 1 000. */
  builderRlusd?: number;
  log?: (s: string) => void;
}

/**
 * Fund all demo roles from the faucet (reusing/migrating the wallet file), configure the RLUSD issuer
 * (DefaultRipple + AllowTrustLineLocking), open trust lines for RLUSD_HOLDERS, and top up investors/platform/builder.
 * Idempotent: a second run submits 0 txs.
 */
export async function bootstrapWallets(opts: BootstrapOptions = {}): Promise<{ wallets: DemoWallets; txs: TxResult[] }> {
  const log = opts.log ?? (() => {});
  const wallets = await ensureFundedWallets({ fresh: opts.fresh, log });
  const issuer = wallets.issuer;
  const txs: TxResult[] = [];
  for (const t of await configureIssuer(issuer)) {
    txs.push(t);
    log(`issuer AccountSet ${t.explorerUrl}`);
  }
  for (const role of RLUSD_HOLDERS) {
    const t = await ensureTrustline(wallets[role], issuer.classicAddress);
    if (t) {
      txs.push(t);
      log(`trustline ${role} ${t.explorerUrl}`);
    }
  }
  for (const { role, target } of rlusdTopUpPlan(opts)) {
    const t = await topUpRlusd(issuer, wallets[role].classicAddress, target);
    if (t) {
      txs.push(t);
      log(`RLUSD ${role} -> ${target} ${t.explorerUrl}`);
    }
  }
  return { wallets, txs };
}

// ---------------------------------------------------------------- project setup

export interface SetupProjectOptions {
  /** End of funding (vault Subscription). Default: project.terms.fundingDeadline. */
  subscriptionEndsAt?: Date;
  /** Start of Redemption (withdrawals reopen). Default: subscription end + termDays + 2 days. */
  redemptionAt?: Date;
  /** Platform first-loss capital deposited into the LoanBroker cover pool (RLUSD). Omit to skip. */
  coverDeposit?: string;
  /** Lock the SPV (SignerListSet + disable master) now. Default true. */
  lockSpv?: boolean;
  /** SPV signer addresses. Pass the project's builder + assigned inspector; defaults come from the demo roles (builder, inspector1). */
  spvSigners?: Partial<SpvSigners>;
}

export interface ProjectChainSetup {
  spv: string;
  vaultId: string;
  loanBrokerId: string;
  shareMptIssuanceId: string;
  vaultPseudoAccount: string;
  subscriptionEndsAt: string; // ISO
  redemptionAt: string; // ISO
  events: ChainEvent[];
  txs: Record<string, TxResult>;
  /** SPV wallet (master key disabled if lockSpv). Only useful when lockSpv=false. */
  spvWallet: Wallet;
}

/**
 * Create the per-project SPV (+ signer list, master disabled), a closed-ended RLUSD vault and its LoanBroker.
 * Run while the project is in `funding`; investors deposit until `subscriptionEndsAt`.
 */
export async function setupProjectOnChain(project: Project, opts: SetupProjectOptions = {}): Promise<ProjectChainSetup> {
  const w = loadWallets();
  const issuer = w.issuer.classicAddress;
  const txs: Record<string, TxResult> = {};
  const events: ChainEvent[] = [];

  const { wallet: spv, trustTx } = await createSpvAccount(issuer);
  rememberSpv(project.id, spv);
  if (trustTx) txs.spvTrustSet = trustTx;
  if (opts.lockSpv !== false) {
    const lock = await lockSpv(spv, spvSignersFor(opts.spvSigners));
    txs.spvSignerListSet = lock.signerListSet;
    txs.spvDisableMaster = lock.disableMaster;
  }

  const now = await ledgerTime();
  const subEnd = opts.subscriptionEndsAt ? isoTimeToRippleTime(opts.subscriptionEndsAt.toISOString()) : isoTimeToRippleTime(project.terms.fundingDeadline);
  const redemption = opts.redemptionAt ? isoTimeToRippleTime(opts.redemptionAt.toISOString()) : subEnd + (project.terms.termDays + 2) * DAY;
  if (subEnd <= now) throw new Error(`subscription end ${rippleTimeToISOTime(subEnd)} is not in the future (ledger now ${rippleTimeToISOTime(now)})`);

  const vault = await createVault({
    owner: w.platform,
    issuer,
    subscriptionDate: subEnd,
    redemptionDate: redemption,
    assetsMaximum: project.terms.principal,
    data: `xrlp:${project.id}`,
  });
  txs.vaultCreate = vault.tx;
  events.push(toChainEvent(vault.tx, { projectId: project.id, kind: "vault_created", actor: w.platform.classicAddress }));

  const broker = await createLoanBroker({ owner: w.platform, vaultId: vault.vaultId, data: `xrlp:${project.id}` });
  txs.loanBrokerSet = broker.tx;
  events.push(toChainEvent(broker.tx, { projectId: project.id, kind: "loan_broker_created", actor: w.platform.classicAddress }));

  if (opts.coverDeposit) {
    // No dedicated ChainEvent kind for cover; reported via txs.loanBrokerCoverDeposit.
    txs.loanBrokerCoverDeposit = await depositBrokerCover(w.platform, broker.loanBrokerId, issuer, opts.coverDeposit);
  }

  return {
    spv: spv.classicAddress,
    vaultId: vault.vaultId,
    loanBrokerId: broker.loanBrokerId,
    shareMptIssuanceId: vault.shareMptIssuanceId,
    vaultPseudoAccount: vault.pseudoAccount,
    subscriptionEndsAt: rippleTimeToISOTime(subEnd),
    redemptionAt: rippleTimeToISOTime(redemption),
    events,
    txs,
    spvWallet: spv,
  };
}

/** v2 SPV signer list with demo-role defaults: platform, builder, inspector1, trustee (override any). */
export function spvSignersFor(o: Partial<SpvSigners> = {}): SpvSigners {
  const w = loadWallets();
  return {
    platform: o.platform ?? w.platform.classicAddress,
    builder: o.builder ?? w.builder.classicAddress,
    inspector: o.inspector ?? w.inspector1.classicAddress,
    trustee: o.trustee ?? w.trustee.classicAddress,
  };
}

/**
 * Default SPV multisig quorum: platform + builder + trustee (3 of 4). Independent of which inspector was assigned,
 * so it works for every project; pass `spvSigners`/`signers` to use the inspector instead.
 */
export function defaultSpvSignerWallets(): Wallet[] {
  const w = loadWallets();
  return [w.platform, w.builder, w.trustee];
}

/** SignerListSet {platform, builder, inspector, trustee} w1 quorum 3 + disable master (fallback path: lock after LoanSet). */
export async function lockSpvAccount(spv: Wallet, signers: Partial<SpvSigners> = {}): Promise<{ signerListSet: TxResult; disableMaster: TxResult }> {
  return lockSpv(spv, spvSignersFor(signers));
}

// ---------------------------------------------------------------- vault

export async function depositToVault(p: { projectId: string; vaultId: string; investor: WalletRef; amount: string }): Promise<{ tx: TxResult; event: ChainEvent }> {
  const w = loadWallets();
  const inv = resolveWallet(p.investor);
  const tx = await depositToVaultTx(inv, p.vaultId, w.issuer.classicAddress, p.amount);
  return { tx, event: toChainEvent(tx, { projectId: p.projectId, kind: "vault_deposit", actor: inv.classicAddress, amount: p.amount }) };
}

/** Only succeeds in the vault's Redemption phase (closed-ended vault). */
export async function withdrawFromVault(p: { projectId: string; vaultId: string; investor: WalletRef; amount: string }): Promise<{ tx: TxResult; event: ChainEvent }> {
  const w = loadWallets();
  const inv = resolveWallet(p.investor);
  const tx = await withdrawFromVaultTx(inv, p.vaultId, w.issuer.classicAddress, p.amount);
  return { tx, event: toChainEvent(tx, { projectId: p.projectId, kind: "vault_withdraw", actor: inv.classicAddress, amount: p.amount }) };
}

export async function getVaultStatus(vaultId: string) {
  const v = await getVault(vaultId);
  if (!v) return undefined;
  const now = await ledgerTime();
  return {
    vaultId,
    phase: vaultPhase(v, now),
    assetsTotal: v.AssetsTotal ?? "0",
    assetsAvailable: v.AssetsAvailable ?? "0",
    lossUnrealized: v.LossUnrealized ?? "0",
    shareMptIssuanceId: v.ShareMPTID,
    subscriptionEndsAt: v.SubscriptionDate != null ? rippleTimeToISOTime(v.SubscriptionDate) : undefined,
    redemptionAt: v.RedemptionDate != null ? rippleTimeToISOTime(v.RedemptionDate) : undefined,
  };
}

export { getShareBalance };

// ---------------------------------------------------------------- loan + escrows

export interface CloseLoanOptions {
  /** Per-milestone hex condition, generated INSPECTOR-side by generateMilestoneCondition(). Required for every milestone. */
  conditions: Record<string, string> | { milestoneId: string; condition: string }[];
  /** Default: terms.termDays / terms.paymentIntervalDays. */
  paymentTotal?: number;
  /** Default: terms.paymentIntervalDays * 86400. Must fit before vault RedemptionDate. */
  paymentIntervalS?: number;
  /** Default CancelAfter for milestones without milestone.cancelAfter: now + termDays. */
  defaultCancelAfter?: Date;
  /** Wait for the vault to leave Subscription before LoanSet (polls ledger time). Default true. */
  waitForInvestmentPhase?: boolean;
  /** SPV signers that countersign LoanSet + EscrowCreate (3 of the SPV list). Default platform + builder + trustee. AI is never a signer. */
  spvSigners?: Wallet[];
  /** If the SPV master key is still enabled, countersign with it instead of multisig (fallback path). */
  spvSingleKey?: Wallet;
  allowOverpayment?: boolean;
  /**
   * Escrow destination. Shared Project only carries builderId, so core should resolve Builder.address
   * and pass it here. Default: the demo "builder" wallet.
   */
  builderAddress?: string;
  onWait?: (secondsRemaining: number) => void;
}

export interface MilestoneEscrowInfo {
  milestoneId: string;
  owner: string;
  offerSequence: number;
  condition: string;
  createTx: string;
  /** Matches shared Milestone.escrow. */
  escrow: NonNullable<Milestone["escrow"]>;
  amount: string;
  cancelAfter: string; // ISO
}

export interface CloseLoanResult {
  loanId: string;
  loanSetTx: TxResult;
  escrows: MilestoneEscrowInfo[];
  events: ChainEvent[];
}

/**
 * LoanSet (platform signs as broker owner, SPV multisig countersigns) -> principal lands in the SPV ->
 * immediately one EscrowCreate per milestone (SPV multisig) so the SPV's liquid balance returns to ~0.
 */
export async function closeLoanAndCreateEscrows(project: Project, opts: CloseLoanOptions): Promise<CloseLoanResult> {
  const w = loadWallets();
  const { spv, vaultId, loanBrokerId } = project.chain;
  if (!spv || !vaultId || !loanBrokerId) throw new Error("project.chain missing spv/vaultId/loanBrokerId — run setupProjectOnChain first");
  const conds: Record<string, string> = Array.isArray(opts.conditions)
    ? Object.fromEntries(opts.conditions.map((c) => [c.milestoneId, c.condition]))
    : opts.conditions;
  for (const m of project.milestones) if (!conds[m.id]) throw new Error(`missing condition for milestone ${m.id}`);

  const vault = await getVault(vaultId);
  if (!vault) throw new Error(`vault ${vaultId} not found`);
  if (opts.waitForInvestmentPhase !== false && vault.SubscriptionDate != null) {
    await waitForLedgerTimeAfter(vault.SubscriptionDate, opts.onWait);
  }

  const paymentTotal = opts.paymentTotal ?? Math.max(1, Math.round(project.terms.termDays / project.terms.paymentIntervalDays));
  const paymentIntervalS = opts.paymentIntervalS ?? project.terms.paymentIntervalDays * DAY;
  const signers = opts.spvSigners ?? defaultSpvSignerWallets();

  const loan = await loanSet({
    brokerOwner: w.platform,
    loanBrokerId,
    borrower: spv,
    principal: project.terms.principal,
    interestRate: project.terms.interestRateBps * 10, // bps -> 1/10 bps
    paymentTotal,
    paymentIntervalS,
    allowOverpayment: opts.allowOverpayment ?? true,
    data: `xrlp:${project.id}`,
    borrowerSig: opts.spvSingleKey ? { single: opts.spvSingleKey } : { multisig: signers },
  });
  const events: ChainEvent[] = [
    toChainEvent(loan.tx, { projectId: project.id, kind: "loan_set", actor: spv, amount: project.terms.principal }),
  ];

  const now = await ledgerTime();
  const defaultCancel = opts.defaultCancelAfter ? isoTimeToRippleTime(opts.defaultCancelAfter.toISOString()) : now + project.terms.termDays * DAY;
  const escrows: MilestoneEscrowInfo[] = [];
  for (const m of project.milestones) {
    const condition = conds[m.id]!;
    const cancelAfter = m.cancelAfter ? isoTimeToRippleTime(m.cancelAfter) : defaultCancel;
    const esc = await createMilestoneEscrow({
      spv,
      builder: opts.builderAddress ?? w.builder.classicAddress,
      issuer: w.issuer.classicAddress,
      amount: m.amount,
      condition,
      cancelAfter,
      ...(opts.spvSingleKey ? { singleKey: opts.spvSingleKey } : { signers }),
    });
    escrows.push({
      milestoneId: m.id,
      owner: spv,
      offerSequence: esc.offerSequence,
      condition,
      createTx: esc.tx.hash,
      amount: m.amount,
      cancelAfter: rippleTimeToISOTime(cancelAfter),
      escrow: { owner: spv, offerSequence: esc.offerSequence, condition, createTx: esc.tx.hash },
    });
    events.push(toChainEvent(esc.tx, { projectId: project.id, milestoneId: m.id, kind: "escrow_created", actor: spv, amount: m.amount }));
  }
  return { loanId: loan.loanId, loanSetTx: loan.tx, escrows, events };
}

// ---------------------------------------------------------------- approvals + release

export async function attestApproval(p: {
  projectId: string;
  spv: string;
  milestoneId: string;
  role: AttestationPayload["role"];
  signer: WalletRef;
  decision: "approve" | "reject";
  notes?: string;
  verdictHash?: string;
  condition?: string;
}): Promise<{ tx: TxResult; event: ChainEvent; attestation: { milestoneId: string; role: AttestationPayload["role"]; signer: string; decision: "approve" | "reject"; notes: string; txHash: string; at: string } }> {
  const signer = resolveWallet(p.signer);
  const tx = await submitAttestation(signer, p.spv, {
    projectId: p.projectId,
    milestoneId: p.milestoneId,
    role: p.role,
    decision: p.decision,
    notes: p.notes,
    verdictHash: p.verdictHash,
    condition: p.condition,
  });
  const at = new Date().toISOString();
  return {
    tx,
    event: toChainEvent(tx, { projectId: p.projectId, milestoneId: p.milestoneId, kind: "approval_attested", actor: signer.classicAddress }),
    attestation: { milestoneId: p.milestoneId, role: p.role, signer: signer.classicAddress, decision: p.decision, notes: p.notes ?? "", txHash: tx.hash, at },
  };
}

/** EscrowFinish with the inspector-supplied fulfillment. Platform submits (anyone could). */
export async function releaseMilestone(p: {
  projectId: string;
  milestoneId: string;
  escrow: { owner: string; offerSequence: number; condition: string };
  fulfillment: string;
  amount?: string;
  submitter?: WalletRef;
}): Promise<{ tx: TxResult; event: ChainEvent }> {
  const submitter = resolveWallet(p.submitter ?? "platform");
  const tx = await finishEscrow({ submitter, owner: p.escrow.owner, offerSequence: p.escrow.offerSequence, condition: p.escrow.condition, fulfillment: p.fulfillment });
  return {
    tx,
    event: toChainEvent(tx, { projectId: p.projectId, milestoneId: p.milestoneId, kind: "escrow_finished", actor: submitter.classicAddress, ...(p.amount ? { amount: p.amount } : {}) }),
  };
}

/** EscrowCancel after CancelAfter; RLUSD returns to the SPV. Set wait=true to block until the ledger passes cancelAfter. */
export async function cancelExpiredMilestone(p: {
  projectId: string;
  milestoneId: string;
  escrow: { owner: string; offerSequence: number };
  cancelAfter?: string; // ISO
  wait?: boolean;
  amount?: string;
  submitter?: WalletRef;
  onWait?: (secondsRemaining: number) => void;
}): Promise<{ tx: TxResult; event: ChainEvent }> {
  if (p.wait && p.cancelAfter) await waitForLedgerTimeAfter(isoTimeToRippleTime(p.cancelAfter), p.onWait);
  const submitter = resolveWallet(p.submitter ?? "platform");
  const tx = await cancelEscrow({ submitter, owner: p.escrow.owner, offerSequence: p.escrow.offerSequence });
  return {
    tx,
    event: toChainEvent(tx, { projectId: p.projectId, milestoneId: p.milestoneId, kind: "escrow_cancelled", actor: submitter.classicAddress, ...(p.amount ? { amount: p.amount } : {}) }),
  };
}

// ---------------------------------------------------------------- repayment

/**
 * LoanPay from the SPV (multisig). amount defaults to the loan's PeriodicPayment (+service fee).
 * mode "overpayment" pays extra principal early (needs LoanSet tfLoanOverpayment, set by default).
 * If the next payment is already late, mode defaults to "late".
 */
export async function repayLoan(p: {
  projectId: string;
  spv: string;
  loanId: string;
  amount?: string;
  mode?: LoanPayMode;
  signers?: Wallet[];
}): Promise<{ tx: TxResult; event: ChainEvent; amount: string; mode: LoanPayMode }> {
  const w = loadWallets();
  const loan = await getLoan(p.loanId);
  if (!loan) throw new Error(`loan ${p.loanId} not found`);
  const periodic = Number(loan.PeriodicPayment ?? "0") + Number(loan.LoanServiceFee ?? "0");
  const amount = p.amount ?? ceil6(periodic);
  let mode = p.mode;
  if (!mode) {
    const now = await ledgerTime();
    mode = loan.NextPaymentDueDate != null && now > loan.NextPaymentDueDate ? "late" : "regular";
  }
  const tx = await loanPayMultisig({ borrower: p.spv, loanId: p.loanId, issuer: w.issuer.classicAddress, amount, signers: p.signers ?? defaultSpvSignerWallets(), mode });
  return { tx, amount, mode, event: toChainEvent(tx, { projectId: p.projectId, kind: "loan_payment", actor: p.spv, amount }) };
}

const ceil6 = (n: number) => (Math.ceil(n * 1e6) / 1e6).toFixed(6);

export { getLoan };

// ---------------------------------------------------------------- credentials

/** Platform issues a credential; if `acceptWith` (the subject's wallet) is given, the subject accepts it too. */
export async function issueCredential(p: {
  projectId?: string;
  subject: WalletRef;
  type: CredentialType;
  uri?: string;
  accept?: boolean;
}): Promise<{ createTx: TxResult; acceptTx?: TxResult; event: ChainEvent }> {
  const w = loadWallets();
  const subject = typeof p.subject === "string" ? resolveWallet(p.subject) : p.subject;
  const createTx = await createCredential(w.platform, subject.classicAddress, p.type, p.uri);
  const acceptTx = p.accept === false ? undefined : await acceptCredential(subject, w.platform.classicAddress, p.type);
  return {
    createTx,
    acceptTx,
    event: toChainEvent(createTx, { projectId: p.projectId ?? PLATFORM_SCOPE, kind: "credential_issued", actor: w.platform.classicAddress }),
  };
}

export { addr as walletAddress };
