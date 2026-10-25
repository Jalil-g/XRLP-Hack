// High-level API for @xrlp/core. Each call does real devnet txs and returns ChainEvents.
// Wallets come from .data/wallets.json (bootstrapWallets). Pass a Wallet to override a role.
import { ChainEvent as ChainEventSchema, TooSoonError, type ChainEvent, type Milestone, type Project } from "@xrlp/shared";
import { isoTimeToRippleTime, rippleTimeToISOTime, type Wallet } from "xrpl";
import { ledgerTime, waitForLedgerTimeAfter, type TxResult } from "./client.ts";
import { submitAttestation, type AttestationPayload } from "./attest.ts";
import { acceptCredential, createCredential, type CredentialType } from "./credentials.ts";
import { cancelEscrow, createMilestoneEscrow, escrowAmountFromMeta, finishEscrow, finishWithWrongFulfillment, getEscrowAtLedger } from "./escrow.ts";
import { toChainEvent, type ChainEventKind } from "./events.ts";
import {
  COVER_RATE_LIQUIDATION,
  COVER_RATE_MINIMUM,
  defaultCoverDeposit,
  expectedInterest,
  fromMicro,
  loanScheduleFromTerms,
  MANAGEMENT_FEE_RATE,
  minimumCover,
  originationFeeFor,
  toMicro,
  validateBrokerRates,
  validateVaultDates,
  vaultDatesFor,
} from "./lending-math.ts";
import { ceilMicro, createLoanBroker, depositBrokerCover, getLoan, loanPayMultisig, loanSet, planLoanPayment, type LoanPayMode, type LoanPayPlan } from "./loan.ts";
import { configureIssuer, ensureTrustline, payRlusd, rlusdBalance, topUpRlusd } from "./rlusd.ts";
import { createSpvAccount, lockSpv, type SpvSigners } from "./spv.ts";
import { createVault, depositToVaultTx, getShareBalance, getVault, vaultPhase, withdrawFromVaultTx, withdrawPhaseCheck } from "./vault.ts";
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
  /**
   * Start of Redemption (withdrawals reopen). Default: subscription end + paymentIntervalS x paymentTotal + 60s + 2 days.
   * Validated to fit the loan schedule (else LoanSet would fail with tecNO_PERMISSION).
   */
  redemptionAt?: Date;
  /** Loan schedule the vault must fit and the cover is sized for. Default: from terms (same as closeLoanAndCreateEscrows). */
  paymentTotal?: number;
  paymentIntervalS?: number;
  /**
   * Platform first-loss capital (RLUSD) for the mandatory LoanBrokerCoverDeposit. Default: defaultCoverDeposit() =
   * max(10% of principal, ceil((principal + expected interest) x CoverRateMinimum) + 10% headroom).
   * Rejected if below the protocol minimum (LoanSet would fail with tecINSUFFICIENT_FUNDS).
   */
  coverDeposit?: string;
  /** LoanBrokerSet rates (1/10 bps). Defaults: COVER_RATE_MINIMUM 10000, COVER_RATE_LIQUIDATION 100000, MANAGEMENT_FEE_RATE 10000. */
  coverRateMinimum?: number;
  coverRateLiquidation?: number;
  managementFeeRate?: number;
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
  /** What LoanBrokerSet + LoanBrokerCoverDeposit put on the ledger. */
  cover: { amount: string; minimum: string; coverRateMinimum: number; coverRateLiquidation: number; managementFeeRate: number; txHash: string };
  /**
   * The `cover_deposited` event. TODO(#53): also in `events` only once shared ChainEvent.kind includes it
   * (detected at runtime), so strict ChainEvent.parse() in core never sees an unknown kind.
   */
  coverEvent: ChainEvent;
  events: ChainEvent[];
  txs: Record<string, TxResult>;
  /** SPV wallet (master key disabled if lockSpv). Only useful when lockSpv=false. */
  spvWallet: Wallet;
}

// TODO(#53): remove once packages/shared ChainEvent.kind has "cover_deposited" (CORE-01 / shared v2).
const SHARED_HAS_COVER_KIND = (ChainEventSchema.shape.kind.options as readonly string[]).includes("cover_deposited");

/**
 * Create the per-project SPV (+ signer list, master disabled), a closed-ended RLUSD vault (AssetsMaximum = principal),
 * its LoanBroker (cover rates + management fee) and the platform's mandatory first-loss cover deposit.
 * Run while the project is in `funding`; investors deposit until `subscriptionEndsAt`.
 */
export async function setupProjectOnChain(project: Project, opts: SetupProjectOptions = {}): Promise<ProjectChainSetup> {
  const w = loadWallets();
  const issuer = w.issuer.classicAddress;
  const txs: Record<string, TxResult> = {};
  const events: ChainEvent[] = [];

  // Validate rates, schedule and cover before any tx, so a bad input never leaves a half-built project.
  const rates = validateBrokerRates({
    coverRateMinimum: opts.coverRateMinimum ?? COVER_RATE_MINIMUM,
    coverRateLiquidation: opts.coverRateLiquidation ?? COVER_RATE_LIQUIDATION,
    managementFeeRate: opts.managementFeeRate ?? MANAGEMENT_FEE_RATE,
  });
  const termsSchedule = loanScheduleFromTerms(project.terms);
  const schedule = { paymentTotal: opts.paymentTotal ?? termsSchedule.paymentTotal, paymentIntervalS: opts.paymentIntervalS ?? termsSchedule.paymentIntervalS };
  const interest = expectedInterest({ principal: project.terms.principal, interestRate: project.terms.interestRateBps * 10, ...schedule });
  const coverMin = minimumCover({ principal: project.terms.principal, interest, coverRateMinimum: rates.coverRateMinimum });
  const coverAmount = opts.coverDeposit ?? defaultCoverDeposit({ principal: project.terms.principal, interest, coverRateMinimum: rates.coverRateMinimum });
  if (!(Number(coverAmount) > 0)) throw new Error(`coverDeposit must be > 0 (first-loss cover is mandatory), got ${coverAmount}`);
  if (Number(coverAmount) < Number(coverMin)) {
    throw new Error(`coverDeposit ${coverAmount} < protocol minimum ${coverMin} for principal ${project.terms.principal} + interest (LoanSet would fail tecINSUFFICIENT_FUNDS)`);
  }
  if (opts.redemptionAt) {
    const sub = isoTimeToRippleTime((opts.subscriptionEndsAt?.toISOString() ?? project.terms.fundingDeadline));
    validateVaultDates({ subscriptionDate: sub, redemptionDate: isoTimeToRippleTime(opts.redemptionAt.toISOString()), ...schedule });
  }
  const platformRlusd = await rlusdBalance(w.platform.classicAddress, issuer);
  if (Number(platformRlusd) < Number(coverAmount)) throw new Error(`platform holds ${platformRlusd} RLUSD < cover deposit ${coverAmount}; top it up (bootstrapWallets platformRlusd)`);

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
  const redemption = opts.redemptionAt
    ? isoTimeToRippleTime(opts.redemptionAt.toISOString())
    : vaultDatesFor({ subscriptionDate: subEnd, ...schedule }).redemptionDate;
  if (subEnd <= now) throw new Error(`subscription end ${rippleTimeToISOTime(subEnd)} is not in the future (ledger now ${rippleTimeToISOTime(now)})`);

  const vault = await createVault({
    owner: w.platform,
    issuer,
    subscriptionDate: subEnd,
    redemptionDate: redemption,
    assetsMaximum: project.terms.principal,
    loanSchedule: schedule,
    data: `xrlp:${project.id}`,
  });
  txs.vaultCreate = vault.tx;
  events.push(toChainEvent(vault.tx, { projectId: project.id, kind: "vault_created", actor: w.platform.classicAddress }));

  const broker = await createLoanBroker({ owner: w.platform, vaultId: vault.vaultId, ...rates, data: `xrlp:${project.id}` });
  txs.loanBrokerSet = broker.tx;
  events.push(toChainEvent(broker.tx, { projectId: project.id, kind: "loan_broker_created", actor: w.platform.classicAddress }));

  txs.loanBrokerCoverDeposit = await depositBrokerCover(w.platform, broker.loanBrokerId, issuer, coverAmount);
  const coverEvent = toChainEvent(txs.loanBrokerCoverDeposit, {
    projectId: project.id,
    kind: "cover_deposited" as ChainEventKind, // TODO(#53): drop the cast once shared has the kind
    actor: w.platform.classicAddress,
    amount: coverAmount,
  });
  if (SHARED_HAS_COVER_KIND) events.push(coverEvent);

  return {
    spv: spv.classicAddress,
    vaultId: vault.vaultId,
    loanBrokerId: broker.loanBrokerId,
    shareMptIssuanceId: vault.shareMptIssuanceId,
    vaultPseudoAccount: vault.pseudoAccount,
    subscriptionEndsAt: rippleTimeToISOTime(subEnd),
    redemptionAt: rippleTimeToISOTime(redemption),
    cover: { amount: coverAmount, minimum: coverMin, ...rates, txHash: txs.loanBrokerCoverDeposit.hash },
    coverEvent,
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

/**
 * VaultWithdraw. Reads the vault phase from LEDGER time first and throws shared `TooSoonError` (nothing submitted)
 * in the Investment phase, i.e. before RedemptionDate; an on-ledger tecTOO_SOON is mapped to `TooSoonError` as well.
 */
export async function withdrawFromVault(p: { projectId: string; vaultId: string; investor: WalletRef; amount: string }): Promise<{ tx: TxResult; event: ChainEvent }> {
  const w = loadWallets();
  const inv = resolveWallet(p.investor);
  const vault = await getVault(p.vaultId);
  if (!vault) throw new Error(`vault ${p.vaultId} not found`);
  const gate = withdrawPhaseCheck(vault, await ledgerTime());
  if (!gate.ok) throw new TooSoonError(`${gate.message} (nothing submitted)`);
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
  /** RLUSD LoanOriginationFee (taken from the principal, paid to the platform). Default: originationFeeFor(principal) = 1.5%. "0" disables. */
  originationFee?: string;
  /**
   * The fee leaves the SPV short of the milestone escrows (sum = principal). This wallet pays the shortfall into the SPV
   * before LoanSet ("points paid at closing"). Default: the demo "builder" wallet.
   */
  originationFeePayer?: WalletRef;
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
  originationFee: string;
  /** Payer -> SPV RLUSD Payment covering the origination fee shortfall, if one was needed. */
  originationFeeTopUpTx?: TxResult;
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

  const originationFee = opts.originationFee ?? originationFeeFor(project.terms.principal);
  const escrowTotal = project.milestones.reduce((a, m) => a + toMicro(m.amount), 0n);
  const spvHeld = BigInt(Math.floor(Number(await rlusdBalance(spv, w.issuer.classicAddress)) * 1e6));
  const shortfall = escrowTotal - (toMicro(project.terms.principal) - toMicro(originationFee)) - spvHeld;
  let originationFeeTopUpTx: TxResult | undefined;
  if (shortfall > 0n) {
    const payer = resolveWallet(opts.originationFeePayer ?? "builder");
    const held = await rlusdBalance(payer.classicAddress, w.issuer.classicAddress);
    if (Number(held) * 1e6 < Number(shortfall)) {
      throw new Error(`origination fee: ${payer.classicAddress} holds ${held} RLUSD, needs ${fromMicro(shortfall)} to pay it into the SPV (or pass originationFee: "0")`);
    }
    originationFeeTopUpTx = await payRlusd(payer, spv, w.issuer.classicAddress, fromMicro(shortfall));
  }

  const loan = await loanSet({
    brokerOwner: w.platform,
    loanBrokerId,
    borrower: spv,
    principal: project.terms.principal,
    interestRate: project.terms.interestRateBps * 10, // bps -> 1/10 bps
    paymentTotal,
    paymentIntervalS,
    allowOverpayment: opts.allowOverpayment ?? true,
    ...(Number(originationFee) > 0 ? { originationFee } : {}),
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
  return { loanId: loan.loanId, loanSetTx: loan.tx, originationFee, ...(originationFeeTopUpTx ? { originationFeeTopUpTx } : {}), escrows, events };
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

/**
 * EscrowFinish with the release fulfillment, submitted by `releaseService` (default). `finishEscrow` runs
 * preflightFinish first (UnsafeReleaseError, nothing submitted), uses its fulfillment-sized Fee and a 60-ledger
 * LastLedgerSequence, and rebuilds once (after a fresh preflight) if the submit fails retriable.
 * Event `escrow_finished`; `amount` defaults to the escrowed amount read from the tx metadata.
 */
export async function releaseMilestone(p: {
  projectId: string;
  milestoneId: string;
  escrow: { owner: string; offerSequence: number; condition: string };
  fulfillment: string;
  amount?: string;
  submitter?: WalletRef;
  /** Expected escrow Destination (Builder.address); preflight refuses a mismatch. */
  destination?: string;
  /** Preflight/LLS knobs (defaults FINISH_LLS_MARGIN = 60 ledgers, marginS 120). */
  lastLedgerMargin?: number;
  marginS?: number;
}): Promise<{ tx: TxResult; event: ChainEvent }> {
  const submitter = resolveWallet(p.submitter ?? "releaseService");
  const tx = await finishEscrow({
    submitter,
    owner: p.escrow.owner,
    offerSequence: p.escrow.offerSequence,
    condition: p.escrow.condition,
    fulfillment: p.fulfillment,
    ...(p.destination ? { destination: p.destination } : {}),
    ...(p.lastLedgerMargin !== undefined ? { lastLedgerMargin: p.lastLedgerMargin } : {}),
    ...(p.marginS !== undefined ? { marginS: p.marginS } : {}),
  });
  const amount = p.amount ?? escrowAmountFromMeta(tx.meta);
  return {
    tx,
    event: toChainEvent(tx, { projectId: p.projectId, milestoneId: p.milestoneId, kind: "escrow_finished", actor: submitter.classicAddress, ...(amount ? { amount } : {}) }),
  };
}

/**
 * Demo "try to steal" (route 23): EscrowFinish with a random WRONG fulfillment from `submitter` (default platform).
 * Bypasses preflight's condition check but refuses (UnsafeReleaseError, nothing submitted) if the escrow is gone or
 * expired. Does not throw on the tec: resolves `{ tx, event }` with event kind `release_refused` and
 * `result` = the on-ledger engine result (`tecCRYPTOCONDITION_ERROR`). Nothing moves.
 */
export async function tryFinishWithWrongFulfillment(p: {
  projectId?: string;
  milestoneId?: string;
  owner: string;
  offerSequence: number;
  condition: string;
  submitter?: WalletRef;
}): Promise<{ tx: TxResult; event: ChainEvent }> {
  const submitter = resolveWallet(p.submitter ?? "platform");
  const tx = await finishWithWrongFulfillment({ submitter, owner: p.owner, offerSequence: p.offerSequence, condition: p.condition });
  return {
    tx,
    event: {
      ...toChainEvent(tx, { projectId: p.projectId ?? PLATFORM_SCOPE, kind: "release_refused", actor: submitter.classicAddress, ...(p.milestoneId ? { milestoneId: p.milestoneId } : {}) }),
      result: tx.result,
    },
  };
}

/**
 * EscrowCancel after CancelAfter (keeper: `releaseService` submits by default); RLUSD returns to the SPV.
 * Checks CancelAfter against ledger time first: not passed -> shared `TooSoonError`, nothing submitted.
 * `wait: true` blocks until the ledger passes CancelAfter (the given ISO, else the on-ledger value) instead.
 * Event `escrow_cancelled`; `amount` defaults to the refunded amount from the tx metadata.
 */
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
  if (p.wait) {
    const cancelAfter = p.cancelAfter ? isoTimeToRippleTime(p.cancelAfter) : (await getEscrowAtLedger(p.escrow.owner, p.escrow.offerSequence)).escrow?.CancelAfter;
    if (cancelAfter !== undefined) await waitForLedgerTimeAfter(cancelAfter, p.onWait);
  }
  const submitter = resolveWallet(p.submitter ?? "releaseService");
  const tx = await cancelEscrow({ submitter, owner: p.escrow.owner, offerSequence: p.escrow.offerSequence });
  const amount = p.amount ?? escrowAmountFromMeta(tx.meta);
  return {
    tx,
    event: toChainEvent(tx, { projectId: p.projectId, milestoneId: p.milestoneId, kind: "escrow_cancelled", actor: submitter.classicAddress, ...(amount ? { amount } : {}) }),
  };
}

// ---------------------------------------------------------------- repayment

/**
 * Builder -> SPV RLUSD Payment (the builder funds a repayment; then `repayLoan({source: "builder"})` LoanPays it).
 * No ChainEvent: shared has no kind for it yet (TODO(#53)); the audit trail event is the LoanPay's `loan_payment`.
 */
export async function builderPayToSpv(p: { projectId: string; spv: string; amount: string; builder?: WalletRef }): Promise<{ tx: TxResult; amount: string; from: string; to: string }> {
  const w = loadWallets();
  if (toMicro(p.amount) <= 0n) throw new Error(`builderPayToSpv: amount must be > 0 (got ${p.amount})`);
  const builder = resolveWallet(p.builder ?? "builder");
  const held = await rlusdBalance(builder.classicAddress, w.issuer.classicAddress);
  if (ceilMicro(held) < toMicro(p.amount)) throw new Error(`builderPayToSpv: ${builder.classicAddress} holds ${held} RLUSD < ${p.amount}`);
  const tx = await payRlusd(builder, p.spv, w.issuer.classicAddress, p.amount);
  return { tx, amount: p.amount, from: builder.classicAddress, to: p.spv };
}

/**
 * LoanPay from the SPV (multisig, default platform + builder + trustee), under the SPV's per-account lock.
 * Amount defaults to one periodic payment (+ service fee) and is validated client-side (LoanPayAmountError, nothing
 * submitted): >= one periodic payment (else tecINSUFFICIENT_PAYMENT) and <= everything outstanding.
 * Mode (unless given): "late" when past due; `source: "escrow_refund"` above one periodic payment -> "overpayment"
 * (excess pays principal down early; needs the loan's tfLoanOverpayment, set by default at LoanSet); else "regular".
 */
export async function repayLoan(p: {
  projectId: string;
  spv: string;
  loanId: string;
  amount?: string;
  mode?: LoanPayMode;
  /** "builder" (builder paid the SPV first, see builderPayToSpv) or "escrow_refund" (money back from EscrowCancel). */
  source?: "builder" | "escrow_refund";
  signers?: Wallet[];
  /** Negative spikes only: let the ledger reject a sub-periodic amount. */
  skipAmountCheck?: boolean;
}): Promise<{ tx: TxResult; event: ChainEvent; amount: string; mode: LoanPayMode; plan: LoanPayPlan }> {
  const w = loadWallets();
  const loan = await getLoan(p.loanId);
  if (!loan) throw new Error(`loan ${p.loanId} not found`);
  const plan = planLoanPayment({
    loan,
    nowRipple: await ledgerTime(),
    ...(p.amount !== undefined ? { amount: p.amount } : {}),
    ...(p.source ? { source: p.source } : {}),
    ...(p.mode ? { mode: p.mode } : {}),
    ...(p.skipAmountCheck ? { skipAmountCheck: true } : {}),
  });
  const tx = await loanPayMultisig({ borrower: p.spv, loanId: p.loanId, issuer: w.issuer.classicAddress, amount: plan.amount, signers: p.signers ?? defaultSpvSignerWallets(), mode: plan.mode });
  return { tx, amount: plan.amount, mode: plan.mode, plan, event: toChainEvent(tx, { projectId: p.projectId, kind: "loan_payment", actor: p.spv, amount: plan.amount }) };
}

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
