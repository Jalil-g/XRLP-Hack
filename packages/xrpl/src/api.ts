// High-level API for @xrlp/core. Each call does real devnet txs and returns ChainEvents.
// Wallets come from .data/wallets.json (bootstrapWallets). Pass a Wallet to override a role.
import { explorerTxUrl, TooSoonError, type ChainEvent, type Milestone, type Project } from "@xrlp/shared";
import { isoTimeToRippleTime, isValidClassicAddress, rippleTimeToISOTime, type Wallet } from "xrpl";
import { DEFAULT_LLS_MARGIN, getClient, ledgerTime, waitForLedgerTimeAfter, withAccountLock, XrplTxError, type TxResult } from "./client.ts";
import { submitAttestation, type AttestationPayload } from "./attest.ts";
import { grantCredential } from "./compliance.ts";
import { getCredential, revokeCredential, type CredentialStatus, type CredentialType } from "./credentials.ts";
import { cancelEscrow, createMilestoneEscrow, escrowAmountFromMeta, finishEscrow, finishWithWrongFulfillment, getEscrowAtLedger, listEscrows } from "./escrow.ts";
import { toChainEvent } from "./events.ts";
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
import {
  CloseLoanPartialError,
  CloseValidationError,
  conditionsByIndex,
  defaultEscrowMode,
  escrowCreatesFromHistory,
  escrowDestinationProblems,
  historyTxs,
  ledgerEscrowsFromNodes,
  loanMaturity,
  loanSetFromHistory,
  mergeLedgerEscrows,
  planEscrowResume,
  planLoanClose,
  resolveEscrowMode,
  type CloseConditions,
  type ClosePartialContext,
  type CreatedEscrowRef,
  type EscrowMode,
  type HistoryTx,
  type PlannedEscrow,
  type ResumeEscrowRef,
  type ResumeMilestone,
} from "./loan-close.ts";
import { createSpvAccount, getSpvInfo, lockSpv, spvCountersignProblems, spvSignerProblems, type SpvSigners } from "./spv.ts";
import { createVault, depositToVaultTx, getShareBalance, getVault, vaultPhase, withdrawFromVaultTx, withdrawPhaseCheck } from "./vault.ts";
import {
  credentialPlan,
  ensureFundedWallets,
  loadWalletFile,
  loadWallets,
  NO_KYC_ROLES,
  rememberSpv,
  resolveWallet,
  RLUSD_HOLDERS,
  rlusdTopUpPlan,
  walletsFromFile,
  type DemoWallets,
  type WalletRole,
} from "./wallets.ts";
import { closePartialError, createEscrowsAtomic, type AtomicEscrow } from "./batch.ts";
import { fetchAccountRoot, fetchLedgerNow } from "./reads.ts";
import type { LoanEntry } from "./loan.ts";

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
  /**
   * RLUSD the platform is topped up to, for first-loss cover across concurrent projects. Default DEFAULT_PLATFORM_RLUSD
   * (25 000 ≈ cover for 3 projects of up to ~70 000 principal). Size other sets with platformRlusdFor(terms[]).
   */
  platformRlusd?: number;
  /** RLUSD the builder holds for the verification fee (250 in the demo). Default 1 000. */
  builderRlusd?: number;
  /**
   * Issue + accept the demo credentials (credentialPlan: KYC_INVESTOR investor1/2, VERIFIED_INSPECTOR inspector1..3) and
   * make sure investor3 holds no KYC_INVESTOR (the tecNO_AUTH beat). Default true.
   */
  credentials?: boolean;
  /** Also pre-issue VERIFIED_BUILDER to the builder (prestage). Default false: it is earned through project verification. */
  preVerifyBuilder?: boolean;
  log?: (s: string) => void;
}

export interface BootstrapCredential {
  role: WalletRole;
  type: CredentialType;
  /** "none" only for NO_KYC_ROLES (deliberately uncredentialed). */
  status: CredentialStatus;
}

/**
 * Fund all demo roles from the faucet (reusing/migrating the wallet file), configure the RLUSD issuer
 * (DefaultRipple + AllowTrustLineLocking), open trust lines for RLUSD_HOLDERS, top up investors/platform/builder,
 * then (unless `credentials: false`) grant the demo credentials and strip KYC from investor3.
 * Idempotent: a second run submits 0 txs.
 */
export async function bootstrapWallets(
  opts: BootstrapOptions = {},
): Promise<{ wallets: DemoWallets; txs: TxResult[]; credentials: BootstrapCredential[] }> {
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
  const credentials: BootstrapCredential[] = [];
  if (opts.credentials !== false) {
    for (const { role, type } of credentialPlan(opts)) {
      const r = await grantCredential({ subject: wallets[role], type, platform: wallets.platform });
      for (const t of r.txs) {
        txs.push(t);
        log(`${String(t.tx.TransactionType)} ${type} ${role} ${t.explorerUrl}`);
      }
      credentials.push({ role, type, status: r.status });
    }
    for (const role of NO_KYC_ROLES) {
      const t = await revokeCredential(wallets.platform, wallets[role].classicAddress, "KYC_INVESTOR");
      if (t) {
        txs.push(t);
        log(`CredentialDelete KYC_INVESTOR ${role} (must stay uncredentialed for tecNO_AUTH) ${t.explorerUrl}`);
      }
      credentials.push({ role, type: "KYC_INVESTOR", status: "none" });
    }
  }
  return { wallets, txs, credentials };
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
  /** XRPL-10: private vault gated by this PermissionedDomain (compliance.ts createDomain). Default: public vault. */
  domainId?: string;
  /** XRPL-10: tfVaultShareNonTransferable (no secondary market for shares). Default false. */
  nonTransferableShares?: boolean;
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
  /** The `cover_deposited` event (also in `events`, after loan_broker_created). */
  coverEvent: ChainEvent;
  events: ChainEvent[];
  txs: Record<string, TxResult>;
  /** SPV wallet (master key disabled if lockSpv). Only useful when lockSpv=false. */
  spvWallet: Wallet;
}

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
  // Signers and dates are checked before the SPV is funded (security review L4, M6).
  const spvSigners = opts.lockSpv !== false ? spvSignersFor(opts.spvSigners) : undefined;
  const now = await ledgerTime();
  const subEnd = opts.subscriptionEndsAt ? isoTimeToRippleTime(opts.subscriptionEndsAt.toISOString()) : isoTimeToRippleTime(project.terms.fundingDeadline);
  const redemption = opts.redemptionAt
    ? isoTimeToRippleTime(opts.redemptionAt.toISOString())
    : vaultDatesFor({ subscriptionDate: subEnd, ...schedule }).redemptionDate;
  if (subEnd <= now) throw new Error(`subscription end ${rippleTimeToISOTime(subEnd)} is not in the future (ledger now ${rippleTimeToISOTime(now)})`);

  const { wallet: spv, trustTx } = await createSpvAccount(issuer);
  rememberSpv(project.id, spv);
  if (trustTx) txs.spvTrustSet = trustTx;
  if (spvSigners) {
    const lock = await lockSpv(spv, spvSigners);
    txs.spvSignerListSet = lock.signerListSet;
    txs.spvDisableMaster = lock.disableMaster;
  }
  const beforeVault = await ledgerTime();
  if (subEnd <= beforeVault) throw new Error(`subscription end ${rippleTimeToISOTime(subEnd)} is not in the future (ledger now ${rippleTimeToISOTime(beforeVault)})`);

  const vault = await createVault({
    owner: w.platform,
    issuer,
    subscriptionDate: subEnd,
    redemptionDate: redemption,
    assetsMaximum: project.terms.principal,
    loanSchedule: schedule,
    data: `xrlp:${project.id}`,
    ...(opts.domainId ? { domainId: opts.domainId } : {}),
    ...(opts.nonTransferableShares ? { nonTransferableShares: true } : {}),
  });
  txs.vaultCreate = vault.tx;
  events.push(toChainEvent(vault.tx, { projectId: project.id, kind: "vault_created", actor: w.platform.classicAddress }));

  const broker = await createLoanBroker({ owner: w.platform, vaultId: vault.vaultId, ...rates, data: `xrlp:${project.id}` });
  txs.loanBrokerSet = broker.tx;
  events.push(toChainEvent(broker.tx, { projectId: project.id, kind: "loan_broker_created", actor: w.platform.classicAddress }));

  txs.loanBrokerCoverDeposit = await depositBrokerCover(w.platform, broker.loanBrokerId, issuer, coverAmount);
  const coverEvent = toChainEvent(txs.loanBrokerCoverDeposit, {
    projectId: project.id,
    kind: "cover_deposited",
    actor: w.platform.classicAddress,
    amount: coverAmount,
  });
  events.push(coverEvent);

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

/** Demo keys that must never be SPV signers (security review M6): the AI only attests, releaseService only finishes. */
export function forbiddenSpvSigners(w: DemoWallets): Record<string, string> {
  return { aiAgent: w.aiAgent.classicAddress, releaseService: w.releaseService.classicAddress, issuer: w.issuer.classicAddress };
}

/**
 * v2 SPV signer list with demo-role defaults: platform, builder, inspector1, trustee (override any). Refuses
 * (CloseValidationError, before any tx) a slot that isn't a classic address or holds the aiAgent / releaseService /
 * issuer key.
 */
export function spvSignersFor(o: Partial<SpvSigners> = {}): SpvSigners {
  const w = loadWallets();
  const s: SpvSigners = {
    platform: o.platform ?? w.platform.classicAddress,
    builder: o.builder ?? w.builder.classicAddress,
    inspector: o.inspector ?? w.inspector1.classicAddress,
    trustee: o.trustee ?? w.trustee.classicAddress,
  };
  const issues = spvSignerProblems(s, forbiddenSpvSigners(w));
  if (issues.length) throw new CloseValidationError(issues, "SPV signers");
  return s;
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
  /**
   * One PREIMAGE-SHA-256 condition per milestone, generated by core's release service (CORE-12); this package never
   * generates preimages. `string[]` (index = project.milestones[i]), `Record<milestoneId, condition>`, or
   * `{milestoneId, condition}[]`. Must be well-formed (`A0258020…810120`), unique within the call and not already used by
   * an open escrow of the SPV.
   */
  conditions: CloseConditions;
  /** ISO CancelAfter by milestone index; overrides milestone.cancelAfter and defaultCancelAfter. Each must be < loan maturity. */
  cancelAfters?: string[];
  /** Default: terms.termDays / terms.paymentIntervalDays (must be ≥ 2). */
  paymentTotal?: number;
  /** Default: terms.paymentIntervalDays * 86400. Must fit before vault RedemptionDate. */
  paymentIntervalS?: number;
  /** CancelAfter for milestones without cancelAfters[i] / milestone.cancelAfter. Default: maturity − one payment interval. */
  defaultCancelAfter?: Date;
  /**
   * Wait for the vault to leave Subscription before LoanSet (polls ledger time). Default true.
   * `false`: throw shared `TooSoonError` (nothing submitted) if the vault is still in Subscription.
   */
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
  /**
   * XRPL-13b. How the milestone escrows are created after LoanSet:
   *  - "batch": ONE all-or-nothing XLS-56 Batch holding every EscrowCreate (outer = SPV, multisigned by `spvSigners`).
   *    Either every escrow exists or none does, and the SPV holds the principal for ~1-2 ledgers. 2..8 milestones.
   *  - "sequential": one EscrowCreate per milestone, back to back (the XRPL-06 path).
   * Default: "batch" for 2..8 milestones, else "sequential". "batch" for any other count → CloseValidationError.
   */
  escrowMode?: EscrowMode;
  /**
   * Awaited after each tx of the close is validated: origination-fee top-up, LoanSet, then the escrow Batch or each
   * EscrowCreate (e.g. to stream explorer links). A throw after LoanSet surfaces as CloseLoanPartialError.
   */
  onTx?: (e: CloseTxEvent) => void | Promise<void>;
}

/** One validated tx of a close (`onTx` of closeLoanAndCreateEscrows / resumeEscrowCreation). */
export interface CloseTxEvent {
  step: "origination_fee" | "loan_set" | "escrow_batch" | "escrow_create";
  tx: TxResult;
  /** Milestones this tx created escrows for ([] for the fee top-up and LoanSet). */
  milestoneIds: string[];
}

export interface MilestoneEscrowInfo {
  milestoneId: string;
  owner: string;
  offerSequence: number;
  condition: string;
  /** The EscrowCreate hash; in batch mode the Batch's INNER EscrowCreate (its own on-ledger tx), not the Batch. */
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
  /** One per milestone, in project.milestones order (structurally the shared `EscrowRef`). */
  escrows: MilestoneEscrowInfo[];
  /** LoanSet + one EscrowCreate per milestone, in order (shared `CloseResult.txs`). Batch mode: the inner EscrowCreates. */
  txs: TxResult[];
  /** Lower bound of loan maturity used for the CancelAfter check (ISO). */
  maturity: string;
  events: ChainEvent[];
  /** How the escrows were created (XRPL-13b). */
  escrowMode: EscrowMode;
  /** Batch mode: the outer Batch tx (fee paid by the SPV). Not an escrow's createTx: those are its inner txs. */
  batchTx?: TxResult;
}

/** ISO close time of the ledger a validated tx landed in (`tx.date`), if rippled returned it. */
function txTime(t: TxResult): string | undefined {
  const d = (t.tx as { date?: unknown }).date;
  return typeof d === "number" ? rippleTimeToISOTime(d) : undefined;
}

function escrowInfo(spv: string, e: { milestoneId: string; offerSequence: number; condition: string; createTx: string; amount: string; cancelAfter: string; createdAt?: string }): MilestoneEscrowInfo {
  const { milestoneId, offerSequence, condition, createTx, amount, cancelAfter } = e;
  return {
    milestoneId,
    owner: spv,
    offerSequence,
    condition,
    createTx,
    amount,
    cancelAfter,
    escrow: { owner: spv, offerSequence, condition, createTx, createdAt: e.createdAt ?? new Date().toISOString() },
  };
}

const createdRefOf = ({ escrow: _e, amount: _a, ...ref }: MilestoneEscrowInfo): CreatedEscrowRef => ref;

function batchEscrowInfo(spv: string, e: AtomicEscrow): MilestoneEscrowInfo {
  const createdAt = txTime(e.tx);
  return escrowInfo(spv, { ...e, cancelAfter: rippleTimeToISOTime(e.cancelAfter), ...(createdAt ? { createdAt } : {}) });
}

/**
 * LoanSet (platform = Account, SPV multisig countersigns) -> principal lands in the SPV -> immediately every milestone
 * escrow (SPV multisig) with the caller's conditions, so the SPV's liquid balance returns to ~0. XRPL-13b: for 2..8
 * milestones the escrows go in ONE all-or-nothing Batch (`escrowMode`, default), else one EscrowCreate each.
 *
 * Everything is validated BEFORE any tx (planLoanClose): PaymentTotal ≥ 2, InterestRate > 0, the loan fits the vault,
 * well-formed + unique conditions (also vs the SPV's open escrows), now + 60s < CancelAfter < maturity, escrowMode fits
 * the milestone count, the SPV signers reach quorum. Bad input → `CloseValidationError` (code "validation"), nothing
 * submitted. Vault still in Subscription with `waitForInvestmentPhase: false` → shared `TooSoonError`. A failure after
 * LoanSet (an EscrowCreate, or a Batch that did not apply) → `CloseLoanPartialError` with the loanId, the escrows
 * created so far and the pending milestones; `resumeEscrowCreation(err)` creates exactly the missing ones.
 * Validation through the last escrow holds the SPV's submit lock: a second close of the same project in this process
 * waits, then is refused before any tx (its conditions are on the SPV's escrows).
 */
export async function closeLoanAndCreateEscrows(project: Project, opts: CloseLoanOptions): Promise<CloseLoanResult> {
  const w = loadWallets();
  const issuer = w.issuer.classicAddress;
  const { spv, vaultId, loanBrokerId } = project.chain;
  if (!spv || !vaultId || !loanBrokerId) throw new Error("project.chain missing spv/vaultId/loanBrokerId — run setupProjectOnChain first");

  const vault = await getVault(vaultId);
  if (!vault) throw new Error(`vault ${vaultId} not found`);
  const before = await ledgerTime();
  if (vault.SubscriptionDate != null && before <= vault.SubscriptionDate) {
    if (opts.waitForInvestmentPhase === false) {
      throw new TooSoonError(`vault ${vaultId} is in Subscription until ${rippleTimeToISOTime(vault.SubscriptionDate)} (ledger now ${rippleTimeToISOTime(before)}); LoanSet would fail tecTOO_SOON`);
    }
    await waitForLedgerTimeAfter(vault.SubscriptionDate, opts.onWait);
  }

  return withAccountLock(spv, async () => {
    const now = await ledgerTime();
    const termsSchedule = loanScheduleFromTerms(project.terms);
    const signers = opts.spvSigners ?? defaultSpvSignerWallets();
    const existing = await listEscrows(spv);
    const plan = planLoanClose({
      milestones: project.milestones,
      conditions: opts.conditions,
      ...(opts.cancelAfters ? { cancelAfters: opts.cancelAfters } : {}),
      ...(opts.defaultCancelAfter ? { defaultCancelAfter: isoTimeToRippleTime(opts.defaultCancelAfter.toISOString()) } : {}),
      ...(opts.escrowMode ? { escrowMode: opts.escrowMode } : {}),
      now,
      paymentTotal: opts.paymentTotal ?? termsSchedule.paymentTotal,
      paymentIntervalS: opts.paymentIntervalS ?? termsSchedule.paymentIntervalS,
      interestRate: project.terms.interestRateBps * 10, // bps -> 1/10 bps
      ...(vault.RedemptionDate != null ? { redemptionDate: vault.RedemptionDate } : {}),
      existingConditions: existing.flatMap((e) => (e.Condition ? [e.Condition] : [])),
    });
    // The escrow destination is fixed at EscrowCreate and every release pays it: check it before the LoanSet (M5).
    const builder = opts.builderAddress ?? w.builder.classicAddress;
    const info = opts.spvSingleKey ? undefined : await getSpvInfo(spv);
    const destinationIssues = escrowDestinationProblems({
      destination: builder,
      spv,
      issuer,
      otherRoles: nonBuilderRoles(w),
      ...(info ? { spvSigners: info.signers.map((s) => s.account) } : {}),
      exists: isValidClassicAddress(builder) ? (await fetchAccountRoot(builder)) !== null : true,
    });
    if (destinationIssues.length) throw new CloseValidationError(destinationIssues);
    if (info) {
      const why = spvCountersignProblems(info, signers.map((s) => s.classicAddress));
      if (why.length) throw new CloseValidationError(why.map((w) => `SPV signers cannot countersign: ${w}`));
    }

    const originationFee = opts.originationFee ?? originationFeeFor(project.terms.principal);
    const escrowTotal = plan.escrows.reduce((a, e) => a + toMicro(e.amount), 0n);
    if (escrowTotal > toMicro(project.terms.principal)) {
      throw new CloseValidationError([`milestone amounts sum to ${fromMicro(escrowTotal)} > principal ${project.terms.principal}`]);
    }
    const spvHeld = BigInt(Math.floor(Number(await rlusdBalance(spv, issuer)) * 1e6));
    const shortfall = escrowTotal - (toMicro(project.terms.principal) - toMicro(originationFee)) - spvHeld;
    let originationFeeTopUpTx: TxResult | undefined;
    if (shortfall > 0n) {
      const payer = resolveWallet(opts.originationFeePayer ?? "builder");
      const held = await rlusdBalance(payer.classicAddress, issuer);
      if (Number(held) * 1e6 < Number(shortfall)) {
        throw new Error(`origination fee: ${payer.classicAddress} holds ${held} RLUSD, needs ${fromMicro(shortfall)} to pay it into the SPV (or pass originationFee: "0")`);
      }
      originationFeeTopUpTx = await payRlusd(payer, spv, issuer, fromMicro(shortfall));
      await opts.onTx?.({ step: "origination_fee", tx: originationFeeTopUpTx, milestoneIds: [] });
    }

    let loan: { tx: TxResult; loanId: string };
    try {
      loan = await loanSet({
        brokerOwner: w.platform,
        loanBrokerId,
        borrower: spv,
        principal: project.terms.principal,
        interestRate: plan.interestRate,
        paymentTotal: plan.paymentTotal,
        paymentIntervalS: plan.paymentIntervalS,
        allowOverpayment: opts.allowOverpayment ?? true,
        ...(Number(originationFee) > 0 ? { originationFee } : {}),
        data: `xrlp:${project.id}`,
        borrowerSig: opts.spvSingleKey ? { single: opts.spvSingleKey } : { multisig: signers },
      });
    } catch (e) {
      if (e instanceof XrplTxError && e.engineResult === "tecTOO_SOON") {
        throw new TooSoonError(`LoanSet: vault ${vaultId} still in Subscription`, { txResult: e.engineResult, ...(e.hash ? { txHash: e.hash } : {}) });
      }
      throw e;
    }
    const events: ChainEvent[] = [
      toChainEvent(loan.tx, { projectId: project.id, kind: "loan_set", actor: spv, amount: project.terms.principal, ...atOf(loan.tx) }),
    ];
    const txs: TxResult[] = [loan.tx];

    // From here on the loan exists: every failure is a CloseLoanPartialError (the SPV holds what isn't escrowed yet).
    const escrows: MilestoneEscrowInfo[] = [];
    const context = { projectId: project.id, spv, builder, issuer, escrowMode: plan.escrowMode, planned: plan.escrows, maturity: plan.maturity, originationFee };
    const partial = (failure: unknown, extra: { prepared?: { hash: string; lastLedgerSequence: number }; uncertain?: boolean } = {}) =>
      closePartialError({ loanId: loan.loanId, loanSetTx: loan.tx.hash, created: escrows.map(createdRefOf), failure, context, ...extra });
    const hook = async (e: CloseTxEvent) => {
      try {
        await opts.onTx?.(e);
      } catch (err) {
        throw partial(err, { uncertain: false });
      }
    };
    const record = (info: MilestoneEscrowInfo, tx: TxResult) => {
      escrows.push(info);
      txs.push(tx);
      events.push(toChainEvent(tx, { projectId: project.id, milestoneId: info.milestoneId, kind: "escrow_created", actor: spv, amount: info.amount, ...atOf(tx) }));
    };
    await hook({ step: "loan_set", tx: loan.tx, milestoneIds: [] });

    let batchTx: TxResult | undefined;
    if (plan.escrowMode === "batch") {
      let prepared: { hash: string; lastLedgerSequence: number } | undefined;
      let created: Awaited<ReturnType<typeof createEscrowsAtomic>>;
      try {
        created = await createEscrowsAtomic({
          spv,
          builder,
          issuer,
          milestones: plan.escrows,
          ...(opts.spvSingleKey ? { spvSingleKey: opts.spvSingleKey } : { spvSigners: signers }),
          onPrepared: (b) => (prepared = b),
        });
      } catch (err) {
        throw partial(err, prepared ? { prepared } : {});
      }
      batchTx = created.batch.tx;
      for (const e of created.escrows) record(batchEscrowInfo(spv, e), e.tx);
      await hook({ step: "escrow_batch", tx: batchTx, milestoneIds: created.escrows.map((e) => e.milestoneId) });
    } else {
      for (const e of plan.escrows) {
        let esc: Awaited<ReturnType<typeof createMilestoneEscrow>>;
        try {
          esc = await createMilestoneEscrow({
            spv,
            builder,
            issuer,
            amount: e.amount,
            condition: e.condition,
            cancelAfter: e.cancelAfter,
            ...(opts.spvSingleKey ? { singleKey: opts.spvSingleKey } : { signers }),
          });
        } catch (err) {
          throw partial(err);
        }
        const createdAt = txTime(esc.tx);
        record(
          escrowInfo(spv, { milestoneId: e.milestoneId, offerSequence: esc.offerSequence, condition: e.condition, createTx: esc.tx.hash, amount: e.amount, cancelAfter: rippleTimeToISOTime(e.cancelAfter), ...(createdAt ? { createdAt } : {}) }),
          esc.tx,
        );
        await hook({ step: "escrow_create", tx: esc.tx, milestoneIds: [e.milestoneId] });
      }
    }
    return {
      loanId: loan.loanId,
      loanSetTx: loan.tx,
      originationFee,
      ...(originationFeeTopUpTx ? { originationFeeTopUpTx } : {}),
      escrows,
      txs,
      maturity: rippleTimeToISOTime(plan.maturity),
      events,
      escrowMode: plan.escrowMode,
      ...(batchTx ? { batchTx } : {}),
    };
  });
}

/** Every demo role's address except the builder's: none of them may receive milestone escrows (M5). */
function nonBuilderRoles(w: DemoWallets): Record<string, string> {
  return Object.fromEntries(Object.entries(w).flatMap(([role, wallet]) => (role === "builder" ? [] : [[role, wallet.classicAddress]])));
}

/** `{ at }` for toChainEvent: the tx's ledger close time when known (else toChainEvent uses now). */
function atOf(t: TxResult): { at?: string } {
  const at = txTime(t);
  return at ? { at } : {};
}

// ---------------------------------------------------------------- recovering a partial close (XRPL-13b)

/** resumeEscrowCreation input when the CloseLoanPartialError is gone (e.g. after a restart). */
export interface ResumeEscrowInput {
  project: Project;
  loanId: string;
  /** Escrows known to exist (CloseLoanPartialError.created). Default []. */
  created?: CreatedEscrowRef[];
  /**
   * Milestones still without an escrow (CloseLoanPartialError.pending). Only sanity-checked: resume always completes
   * every milestone of the project and re-checks the SPV's escrows by condition first.
   */
  pending?: string[];
  /** Same shapes as CloseLoanOptions.conditions; needed for every milestone not in `created`. */
  conditions: CloseConditions;
  /** ISO by milestone index; else milestone.cancelAfter; else (real) loan maturity − one payment interval. */
  cancelAfters?: string[];
  /** The LoanSet hash, if known (else it is looked up in the SPV's history). */
  loanSetTx?: string;
}

export interface ResumeEscrowOptions {
  /** Default: "batch" for 2..8 missing escrows, else "sequential". */
  escrowMode?: EscrowMode;
  /** SPV quorum for the EscrowCreates. Default platform + builder + trustee. */
  spvSigners?: Wallet[];
  spvSingleKey?: Wallet;
  /**
   * Escrow destination. **Required** for the `{ project, ... }` form (checked like the close: a classic address, not the
   * SPV / issuer / another demo role); a CloseLoanPartialError carries its own and must match it.
   */
  builderAddress?: string;
  /** RLUSD issuer for the `{ project, ... }` form (a CloseLoanPartialError carries its own). Default: the demo issuer. */
  issuer?: string;
  /**
   * When the failed close's last submit had an unknown outcome (`context.uncertain`), wait until that tx can no longer
   * validate (its LastLedgerSequence, else one DEFAULT_LLS_MARGIN) before reading the ledger. The `{ project, ... }` form
   * (e.g. after a restart) always counts as unknown and waits one DEFAULT_LLS_MARGIN. Default true; false skips the wait.
   */
  waitForInFlight?: boolean;
  onWait?: (ledgersRemaining: number) => void;
  onTx?: (e: CloseTxEvent) => void | Promise<void>;
  /** Network seams (tests). Defaults are the real devnet reads and submits. */
  deps?: Partial<ResumeDeps>;
}

/** What resumeEscrowCreation reads and submits (all injectable for offline tests). */
export interface ResumeDeps {
  ledgerNow(): Promise<{ ledgerIndex: number; closeTime: number }>;
  getLoan(loanId: string): Promise<LoanEntry | undefined>;
  /** The escrow lister: raw Escrow nodes the SPV owns (account_objects). */
  listEscrowNodes(spv: string): Promise<unknown[]>;
  /** Raw account_tx entries of the SPV (validated, newest first). */
  accountTx(spv: string): Promise<unknown[]>;
  rlusdBalance(account: string, issuer: string): Promise<string>;
  fetchTx(hash: string): Promise<TxResult>;
  createEscrowsAtomic: typeof createEscrowsAtomic;
  createMilestoneEscrow: typeof createMilestoneEscrow;
  sleep(ms: number): Promise<void>;
}

export interface ResumeEscrowResult extends CloseLoanResult {
  resumed: {
    /** Milestones this call created escrows for, project order. [] = nothing was missing and nothing was submitted. */
    created: string[];
    /** Milestones whose escrow already existed: reported created, open on the SPV, or already finished / cancelled. */
    alreadyPresent: { milestoneId: string; source: ResumeEscrowRef["source"] }[];
    /** What this call submitted: the escrow Batch, or each EscrowCreate. */
    submitted: TxResult[];
  };
}

/** The SPV's validated history, newest first (account_tx, up to 5 pages of 200). */
async function spvHistory(spv: string): Promise<unknown[]> {
  const client = await getClient();
  const out: unknown[] = [];
  let marker: unknown;
  for (let page = 0; page < 5; page++) {
    const res = await client.request({ command: "account_tx", account: spv, ledger_index_min: -1, ledger_index_max: -1, limit: 200, forward: false, ...(marker ? { marker } : {}) });
    out.push(...res.result.transactions);
    marker = res.result.marker;
    if (!marker) break;
  }
  return out;
}

const realResumeDeps: ResumeDeps = {
  ledgerNow: fetchLedgerNow,
  getLoan,
  listEscrowNodes: listEscrows,
  accountTx: spvHistory,
  rlusdBalance,
  fetchTx: validatedTx,
  createEscrowsAtomic,
  createMilestoneEscrow,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

interface ResumeSource {
  projectId: string;
  spv: string;
  builder: string;
  issuer?: string;
  loanId: string;
  loanSetTx?: string;
  created: CreatedEscrowRef[];
  escrowMode?: EscrowMode;
  originationFee?: string;
  uncertain: boolean;
  inFlightUntilLedger?: number;
  /** Milestones in project order; CancelAfter defaults to (real maturity − interval) where none was given. */
  milestones(maturity: number | undefined, interval: number | undefined): ResumeMilestone[];
}

function resumeSourceOf(input: CloseLoanPartialError | ResumeEscrowInput, opts: ResumeEscrowOptions): ResumeSource {
  const what = "resumeEscrowCreation";
  if (input instanceof CloseLoanPartialError) {
    const c = input.context;
    if (!c) throw new CloseValidationError(["this CloseLoanPartialError has no context; pass { project, loanId, created, pending, conditions, cancelAfters } instead"], what);
    if (opts.builderAddress && opts.builderAddress !== c.builder) {
      throw new CloseValidationError([`builderAddress ${opts.builderAddress} is not the failed close's escrow destination ${c.builder}`], what);
    }
    return {
      projectId: c.projectId ?? PLATFORM_SCOPE,
      spv: c.spv,
      builder: c.builder,
      ...(c.issuer ? { issuer: c.issuer } : {}),
      loanId: input.loanId,
      loanSetTx: input.loanSetTx,
      created: input.created,
      escrowMode: c.escrowMode,
      ...(c.originationFee ? { originationFee: c.originationFee } : {}),
      uncertain: c.uncertain === true,
      ...(c.inFlightUntilLedger != null ? { inFlightUntilLedger: c.inFlightUntilLedger } : {}),
      milestones: () => c.planned.map((e) => ({ milestoneId: e.milestoneId, index: e.index, amount: e.amount, condition: e.condition, cancelAfter: e.cancelAfter })),
    };
  }
  const { project } = input;
  const spv = project.chain.spv;
  const issues: string[] = [];
  if (!spv) issues.push("project.chain.spv missing");
  const conds = conditionsByIndex(project.milestones, input.conditions, issues);
  if (input.cancelAfters && input.cancelAfters.length !== project.milestones.length) {
    issues.push(`cancelAfters has ${input.cancelAfters.length} entries for ${project.milestones.length} milestones (index = project.milestones[i])`);
  }
  const explicit = project.milestones.map((m, i) => {
    const raw = input.cancelAfters?.[i] ?? m.cancelAfter;
    if (raw == null) return undefined;
    const t = Date.parse(raw);
    if (Number.isNaN(t)) issues.push(`milestone ${m.id} (#${i}): CancelAfter is not an ISO timestamp: ${JSON.stringify(raw)}`);
    return Number.isNaN(t) ? undefined : isoTimeToRippleTime(new Date(t).toISOString());
  });
  const created = input.created ?? [];
  const ids = new Set(project.milestones.map((m) => m.id));
  for (const id of input.pending ?? []) {
    if (!ids.has(id)) issues.push(`pending: unknown milestone ${id}`);
    if (created.some((c) => c.milestoneId === id)) issues.push(`milestone ${id} is both created and pending`);
  }
  // No error object = no record of the close's escrow destination: it must be given, and is checked like the close does
  // (security review M8). Never default it to the demo builder: with every milestone pending nothing would cross-check it.
  if (!opts.builderAddress) issues.push("builderAddress is required with the { project, ... } form (the escrow destination of the failed close)");
  else if (spv) {
    const f = loadWalletFile();
    issues.push(...escrowDestinationProblems({ destination: opts.builderAddress, spv, ...(opts.issuer ? { issuer: opts.issuer } : {}), ...(f ? { otherRoles: nonBuilderRoles(walletsFromFile(f)) } : {}) }));
  }
  if (issues.length) throw new CloseValidationError(issues, what);
  return {
    projectId: project.id,
    spv: spv!,
    builder: opts.builderAddress!,
    ...(opts.issuer ? { issuer: opts.issuer } : {}),
    loanId: input.loanId,
    ...(input.loanSetTx ? { loanSetTx: input.loanSetTx } : {}),
    created,
    // After a restart the last tx of the failed close may still be in flight: wait one LastLedgerSequence margin before
    // reading the ledger (waitForInFlight: false skips it), so an in-flight EscrowCreate is never created twice.
    uncertain: true,
    milestones: (maturity, interval) =>
      project.milestones.map((m, index) => {
        const cancelAfter = explicit[index] ?? (maturity != null && interval != null ? maturity - interval : undefined);
        return { milestoneId: m.id, index, amount: m.amount, ...(conds[index] != null ? { condition: conds[index] } : {}), ...(cancelAfter != null ? { cancelAfter } : {}) };
      }),
  };
}

const historyTxResult = (h: HistoryTx): TxResult => ({
  hash: h.hash,
  explorerUrl: explorerTxUrl(h.hash),
  result: String(h.meta.TransactionResult ?? "unknown"),
  ...(h.ledgerIndex != null ? { ledgerIndex: h.ledgerIndex } : {}),
  tx: h.closeTime && (h.tx as { date?: unknown }).date == null ? { ...h.tx, date: isoTimeToRippleTime(h.closeTime) } : h.tx,
  meta: h.meta,
});

/**
 * Finish a partial close: create exactly the milestone escrows that are missing, then return the completed
 * CloseLoanResult (+ `resumed`: what this call created / found / submitted). Idempotent: before creating anything it
 * re-reads the SPV's escrows and matches them **by condition** (open ones, and ones already finished or cancelled per
 * the SPV's history), so a retry never double-creates; a second run submits nothing.
 *
 * Input: the `CloseLoanPartialError` (its `context` carries the plan, builder, Batch state), or
 * `{ project, loanId, created, pending, conditions, cancelAfters }`. Order: wait out an in-flight tx of the failed close
 * (only when its outcome was unknown) → the loan must exist with Borrower = SPV → plan (`planEscrowResume`: every new
 * escrow passes the close's checks, CancelAfter before the REAL loan maturity) → the SPV must hold the RLUSD for the
 * missing escrows → create them ("batch" for 2..8, else "sequential") under the SPV's submit lock. Bad input or a
 * mismatch → CloseValidationError, nothing submitted; a failure while creating → a new CloseLoanPartialError (resume
 * again).
 */
export async function resumeEscrowCreation(input: CloseLoanPartialError | ResumeEscrowInput, opts: ResumeEscrowOptions = {}): Promise<ResumeEscrowResult> {
  const d: ResumeDeps = { ...realResumeDeps, ...opts.deps };
  const what = "resumeEscrowCreation";
  const src = resumeSourceOf(input, opts);
  const { spv, builder, loanId, projectId } = src;

  if (src.uncertain && opts.waitForInFlight !== false) {
    let at = await d.ledgerNow();
    const until = src.inFlightUntilLedger ?? at.ledgerIndex + DEFAULT_LLS_MARGIN;
    while (at.ledgerIndex <= until) {
      opts.onWait?.(until - at.ledgerIndex + 1);
      await d.sleep(3_000);
      at = await d.ledgerNow();
    }
  }

  const loan = await d.getLoan(loanId);
  if (!loan) throw new CloseValidationError([`loan ${loanId} not found on the ledger`], what);
  if (loan.Borrower !== spv) throw new CloseValidationError([`loan ${loanId} is borrowed by ${loan.Borrower}, not the SPV ${spv}`], what);
  const maturity = loanMaturity(loan);
  const milestones = src.milestones(maturity, loan.PaymentInterval);

  return withAccountLock(spv, async () => {
    const now = await d.ledgerNow();
    const history = await d.accountTx(spv);
    const ledgerEscrows = mergeLedgerEscrows(ledgerEscrowsFromNodes(await d.listEscrowNodes(spv), spv), escrowCreatesFromHistory(history, spv));
    const plan = planEscrowResume({ spv, builder, milestones, created: src.created, ledgerEscrows, now: now.closeTime, ...(maturity != null ? { maturity } : {}) });
    const byHash = new Map(historyTxs(history).map((h) => [h.hash, h]));
    const txOf = async (hash: string | undefined): Promise<TxResult | undefined> => {
      if (!hash) return undefined;
      const h = byHash.get(hash);
      if (h) return historyTxResult(h);
      try {
        return await d.fetchTx(hash);
      } catch {
        return undefined;
      }
    };
    // Resolve the LoanSet BEFORE submitting anything, so a lookup problem never strands half-created escrows.
    const loanSetEntry = loanSetFromHistory(history, loanId);
    const loanSetTx = loanSetEntry ? historyTxResult(loanSetEntry) : await txOf(src.loanSetTx);
    if (!loanSetTx) throw new CloseValidationError([`LoanSet of loan ${loanId} not found in the SPV's history${src.loanSetTx ? ` or by hash ${src.loanSetTx}` : ""}; pass loanSetTx`], what);

    const present = new Map(plan.present.map((p) => [p.milestoneId, p]));
    const createdNow = new Map<string, { info: MilestoneEscrowInfo; tx: TxResult }>();
    const submitted: TxResult[] = [];
    let mode: EscrowMode | undefined;
    let batchTx: TxResult | undefined;

    if (plan.toCreate.length) {
      mode = resolveEscrowMode(plan.toCreate.length, opts.escrowMode, what);
      const issuer = src.issuer ?? loadWallets().issuer.classicAddress;
      const need = plan.toCreate.reduce((a, e) => a + toMicro(e.amount), 0n);
      const held = await d.rlusdBalance(spv, issuer);
      if (BigInt(Math.floor(Number(held) * 1e6)) < need) {
        throw new CloseValidationError([`SPV ${spv} holds ${held} RLUSD < ${fromMicro(need)} for the missing escrows [${plan.toCreate.map((e) => e.milestoneId).join(", ")}]`], what);
      }
      const signers = opts.spvSingleKey ? undefined : (opts.spvSigners ?? defaultSpvSignerWallets());
      const planned: PlannedEscrow[] = milestones.map((m) => {
        const p = present.get(m.milestoneId);
        const t = plan.toCreate.find((e) => e.milestoneId === m.milestoneId);
        if (t) return t;
        return { milestoneId: m.milestoneId, index: m.index, amount: m.amount, condition: p?.condition ?? m.condition ?? "", cancelAfter: p?.cancelAfter ? isoTimeToRippleTime(p.cancelAfter) : (m.cancelAfter ?? 0) };
      });
      const context: Omit<ClosePartialContext, "batch" | "uncertain" | "inFlightUntilLedger"> = {
        projectId,
        spv,
        builder,
        issuer,
        escrowMode: mode,
        planned,
        ...(maturity != null ? { maturity } : {}),
        ...(src.originationFee ? { originationFee: src.originationFee } : {}),
      };
      const createdRefs = () => [
        ...plan.present.map(({ amount: _a, source: _s, ...ref }) => ref),
        ...[...createdNow.values()].map((c) => createdRefOf(c.info)),
      ];
      const partial = (failure: unknown, extra: { prepared?: { hash: string; lastLedgerSequence: number }; uncertain?: boolean } = {}) =>
        closePartialError({ loanId, loanSetTx: loanSetTx.hash, created: createdRefs(), failure, context, ...extra });
      const hook = async (e: CloseTxEvent) => {
        try {
          await opts.onTx?.(e);
        } catch (err) {
          throw partial(err, { uncertain: false });
        }
      };

      if (mode === "batch") {
        let prepared: { hash: string; lastLedgerSequence: number } | undefined;
        let r: Awaited<ReturnType<typeof createEscrowsAtomic>>;
        try {
          r = await d.createEscrowsAtomic({
            spv,
            builder,
            issuer,
            milestones: plan.toCreate,
            ...(opts.spvSingleKey ? { spvSingleKey: opts.spvSingleKey } : { spvSigners: signers! }),
            now: now.closeTime,
            onPrepared: (b) => (prepared = b),
          });
        } catch (err) {
          throw partial(err, prepared ? { prepared } : {});
        }
        batchTx = r.batch.tx;
        submitted.push(batchTx);
        for (const e of r.escrows) createdNow.set(e.milestoneId, { info: batchEscrowInfo(spv, e), tx: e.tx });
        await hook({ step: "escrow_batch", tx: batchTx, milestoneIds: r.escrows.map((e) => e.milestoneId) });
      } else {
        for (const e of plan.toCreate) {
          let esc: Awaited<ReturnType<typeof createMilestoneEscrow>>;
          try {
            esc = await d.createMilestoneEscrow({
              spv,
              builder,
              issuer,
              amount: e.amount,
              condition: e.condition,
              cancelAfter: e.cancelAfter,
              ...(opts.spvSingleKey ? { singleKey: opts.spvSingleKey } : { signers: signers! }),
            });
          } catch (err) {
            throw partial(err);
          }
          submitted.push(esc.tx);
          const createdAt = txTime(esc.tx);
          createdNow.set(e.milestoneId, {
            info: escrowInfo(spv, { milestoneId: e.milestoneId, offerSequence: esc.offerSequence, condition: e.condition, createTx: esc.tx.hash, amount: e.amount, cancelAfter: rippleTimeToISOTime(e.cancelAfter), ...(createdAt ? { createdAt } : {}) }),
            tx: esc.tx,
          });
          await hook({ step: "escrow_create", tx: esc.tx, milestoneIds: [e.milestoneId] });
        }
      }
    }

    // The completed close: LoanSet + one escrow per milestone, project order (pre-existing ones rebuilt from history).
    const principal = loanSetTx.tx.PrincipalRequested;
    const events: ChainEvent[] = [
      toChainEvent(loanSetTx, { projectId, kind: "loan_set", actor: spv, ...(typeof principal === "string" ? { amount: principal } : {}), ...atOf(loanSetTx) }),
    ];
    const txs: TxResult[] = [loanSetTx];
    const escrows: MilestoneEscrowInfo[] = [];
    for (const m of milestones) {
      const fresh = createdNow.get(m.milestoneId);
      const p = present.get(m.milestoneId);
      const tx = fresh?.tx ?? (await txOf(p?.createTx));
      const info = fresh?.info ?? escrowInfo(spv, { ...p!, ...(tx && txTime(tx) ? { createdAt: txTime(tx)! } : {}) });
      escrows.push(info);
      if (tx) {
        txs.push(tx);
        events.push(toChainEvent(tx, { projectId, milestoneId: m.milestoneId, kind: "escrow_created", actor: spv, amount: info.amount, ...atOf(tx) }));
      }
    }
    const originationFee = src.originationFee ?? (typeof loan.LoanOriginationFee === "string" ? loan.LoanOriginationFee : undefined) ?? "0";
    return {
      loanId,
      loanSetTx,
      originationFee,
      escrows,
      txs,
      maturity: maturity != null ? rippleTimeToISOTime(maturity) : "",
      events,
      escrowMode: mode ?? src.escrowMode ?? defaultEscrowMode(milestones.length),
      ...(batchTx ? { batchTx } : {}),
      resumed: {
        created: milestones.filter((m) => createdNow.has(m.milestoneId)).map((m) => m.milestoneId),
        alreadyPresent: plan.present.map((p) => ({ milestoneId: p.milestoneId, source: p.source })),
        submitted,
      },
    };
  });
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

/**
 * Platform issues a credential; the subject accepts it unless `accept: false`. Idempotent (delegates to grantCredential):
 * nothing is re-submitted if the credential already exists / is accepted.
 * `createTx` / `event` describe the CredentialCreate: this call's, or the existing one on the ledger (then `txs` and
 * `events`, i.e. what this call submitted, are empty).
 * @deprecated use `grantCredential` (compliance.ts), which returns only what it submitted.
 */
export async function issueCredential(p: {
  projectId?: string;
  subject: WalletRef;
  type: CredentialType;
  uri?: string;
  accept?: boolean;
}): Promise<{ createTx: TxResult; acceptTx?: TxResult; event: ChainEvent; status: CredentialStatus; txs: TxResult[]; events: ChainEvent[] }> {
  const w = loadWallets();
  const r = await grantCredential({
    subject: p.subject,
    type: p.type,
    platform: w.platform,
    ...(p.uri ? { uri: p.uri } : {}),
    ...(p.accept === false ? { accept: false } : {}),
    ...(p.projectId ? { projectId: p.projectId } : {}),
  });
  const subject = typeof p.subject === "string" && isValidClassicAddress(p.subject) ? p.subject : addr(p.subject);
  const createTx = r.createTx ?? (await existingCredentialCreateTx(subject, w.platform.classicAddress, p.type));
  const event = r.events.find((e) => e.kind === "credential_issued") ??
    toChainEvent(createTx, { projectId: p.projectId ?? PLATFORM_SCOPE, kind: "credential_issued", actor: w.platform.classicAddress });
  return { createTx, ...(r.acceptTx ? { acceptTx: r.acceptTx } : {}), event, status: r.status, txs: r.txs, events: r.events };
}

/** The CredentialCreate behind an existing Credential: its PreviousTxnID, or one hop back if that was the CredentialAccept. */
async function existingCredentialCreateTx(subject: string, issuer: string, type: CredentialType): Promise<TxResult> {
  const c = await getCredential(subject, issuer, type);
  if (!c) throw new Error(`issueCredential: ${type} for ${subject} not found after grant`);
  let tx = await validatedTx(c.PreviousTxnID);
  if (tx.tx.TransactionType === "CredentialAccept") {
    const nodes = (tx.meta.AffectedNodes ?? []) as { ModifiedNode?: { LedgerEntryType?: string; LedgerIndex?: string; PreviousTxnID?: string } }[];
    const prev = nodes.find((n) => n.ModifiedNode?.LedgerEntryType === "Credential" && n.ModifiedNode.LedgerIndex === c.index)?.ModifiedNode?.PreviousTxnID;
    if (prev) tx = await validatedTx(prev);
  }
  return tx;
}

async function validatedTx(hash: string): Promise<TxResult> {
  const client = await getClient();
  const res = await client.request({ command: "tx", transaction: hash });
  const r = res.result as unknown as Record<string, unknown>;
  const meta = (r.meta ?? {}) as Record<string, unknown>;
  return {
    hash,
    explorerUrl: explorerTxUrl(hash),
    result: String(meta.TransactionResult ?? "unknown"),
    ...(typeof r.ledger_index === "number" ? { ledgerIndex: r.ledger_index } : {}),
    tx: (r.tx_json ?? r) as Record<string, unknown>,
    meta,
  };
}

export { addr as walletAddress };
