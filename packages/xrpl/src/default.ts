// XRPL-15 · Loan default + first-loss cover absorption: XLS-66 `LoanManage` (tfLoanImpair / tfLoanUnimpair / tfLoanDefault).
// Only the LoanBroker owner (= platform) may submit it. Two devnet rules differ from the base XLS-66 text
// (rippled 3.4.1 `LoanManage.cpp`; evidence in docs/xrpl-protocol-notes.md §3c):
//  - fixCleanup3_4_0 (XLS-66.2): boundaries are exclusive. Impair only once the payment is overdue
//    (now > NextPaymentDueDate), default only once now > NextPaymentDueDate + GracePeriod. "now" = parent ledger close time.
//  - LendingProtocolV1_1 cash-basis accounting (Vault.LEVersion 1, every vault created on devnet today): DebtTotal and
//    AssetsTotal carry principal only, so impair/default use Loan.PrincipalOutstanding as the exposure. Accrual (legacy)
//    vaults use TotalValueOutstanding − ManagementFeeOutstanding, as in XLS-66 §3.10.5.
// Split: pure guards, cover math and metadata parsers (offline, test/default.test.ts) + thin wrappers that run the guard on
// one validated ledger under the platform's account lock (XRPL-12) and never submit a LoanManage expected to fail.
import { LedgerError, TooSoonError, type ChainEvent, type Rlusd } from "@xrlp/shared";
import { LedgerEntry, LoanManageFlags, rippleTimeToISOTime, type Wallet } from "xrpl";
import { signAndSubmit, withAccountLock, type TxResult } from "./client.ts";
import { fetchValidatedTx } from "./escrow.ts";
import { toChainEvent } from "./events.ts";
import { TENTH_BPS_ONE } from "./lending-math.ts";
import type { LoanBrokerEntry, LoanEntry } from "./loan.ts";
import { divDecimal, fetchLedgerNow, rawRequest, toPlainDecimal, toRlusd } from "./reads.ts";
import type { VaultLedgerEntry } from "./vault.ts";
import { resolveWallet, type WalletRole } from "./wallets.ts";

const LSF_LOAN_DEFAULT = LedgerEntry.LoanFlags.lsfLoanDefault;
const LSF_LOAN_IMPAIRED = LedgerEntry.LoanFlags.lsfLoanImpaired;
/** Vault.LEVersion of a vault created under LendingProtocolV1_1 (rippled `VaultVersion::CashBasis`). Absent = legacy accrual. */
export const VAULT_VERSION_CASH_BASIS = 1;

export type LoanManageAction = "impair" | "unimpair" | "default";

/** LoanManage `Flags` per action (mutually exclusive). */
export const LOAN_MANAGE_FLAG: Record<LoanManageAction, number> = {
  impair: LoanManageFlags.tfLoanImpair,
  unimpair: LoanManageFlags.tfLoanUnimpair,
  default: LoanManageFlags.tfLoanDefault,
};

/** Loan ledger entry with the fields LoanManage reads (rippled omits zero/default fields). */
export interface LoanManageEntry extends LoanEntry {
  GracePeriod?: number;
  ManagementFeeOutstanding?: string;
  /** Exponent all loan amounts are rounded to (e.g. -12). */
  LoanScale?: number;
  StartDate?: number;
  PreviousTxnID?: string;
}

/** The Loan fields the pure guards and the exposure need. */
export type LoanManageLoan = Pick<
  LoanManageEntry,
  "Flags" | "NextPaymentDueDate" | "GracePeriod" | "PaymentRemaining" | "PrincipalOutstanding" | "TotalValueOutstanding" | "ManagementFeeOutstanding"
>;

export interface LoanBrokerManageEntry extends LoanBrokerEntry {
  CoverRateMinimum?: number;
  CoverRateLiquidation?: number;
}

export type VaultManageEntry = VaultLedgerEntry & { LEVersion?: number; Scale?: number };

// ---------------------------------------------------------------- exact decimals (no floats)

/** value = n / 10^s. rippled IOU values have ≤ 16 significant digits and may come in e-notation. */
interface Dec {
  n: bigint;
  s: number;
}

function dec(v: unknown): Dec {
  const plain = toPlainDecimal(v == null || v === "" ? "0" : String(v));
  const neg = plain.startsWith("-");
  const [i = "0", f = ""] = (neg ? plain.slice(1) : plain).split(".");
  const n = BigInt(i + f);
  return { n: neg ? -n : n, s: f.length };
}

const scaled = (d: Dec, s: number): bigint => d.n * 10n ** BigInt(s - d.s);

function fmt(d: Dec): string {
  const neg = d.n < 0n;
  const digits = (neg ? -d.n : d.n).toString().padStart(d.s + 1, "0");
  const int = digits.slice(0, digits.length - d.s);
  const frac = digits.slice(digits.length - d.s).replace(/0+$/, "");
  const out = frac ? `${int}.${frac}` : int;
  return neg && out !== "0" ? `-${out}` : out;
}

function cmpDec(a: Dec, b: Dec): number {
  const s = Math.max(a.s, b.s);
  const x = scaled(a, s);
  const y = scaled(b, s);
  return x === y ? 0 : x < y ? -1 : 1;
}

const minDec = (a: Dec, b: Dec): Dec => (cmpDec(a, b) <= 0 ? a : b);

function addDec(a: Dec, b: Dec, sign: 1n | -1n = 1n): Dec {
  const s = Math.max(a.s, b.s);
  return { n: scaled(a, s) + sign * scaled(b, s), s };
}

const decSub = (a: unknown, b: unknown): string => fmt(addDec(dec(a), dec(b), -1n));
const decAdd = (a: unknown, b: unknown): string => fmt(addDec(dec(a), dec(b)));
const decCmp = (a: unknown, b: unknown): number => cmpDec(dec(a), dec(b));

/** Round a non-negative value UP to a multiple of 10^scale (rippled `roundToAsset` with Upward rounding). */
function ceilToScale(d: Dec, scale: number): Dec {
  const keep = -scale; // decimals kept
  if (keep >= d.s) return d;
  const factor = 10n ** BigInt(d.s - keep);
  let q = d.n / factor;
  if (d.n % factor !== 0n) q += 1n;
  return keep >= 0 ? { n: q, s: keep } : { n: q * 10n ** BigInt(-keep), s: 0 };
}

// ---------------------------------------------------------------- pure: accounting, exposure, cover math

export type VaultAccounting = "cash_basis" | "accrual";

/** `cash_basis` for Vault.LEVersion 1 (LendingProtocolV1_1, every devnet vault), else `accrual`. */
export function vaultAccounting(vault: { LEVersion?: unknown } | undefined): VaultAccounting {
  return vault?.LEVersion === VAULT_VERSION_CASH_BASIS ? "cash_basis" : "accrual";
}

/**
 * What impair marks as a paper loss and default writes off (rippled `loanVaultExposure`), exact decimal:
 * cash basis → Loan.PrincipalOutstanding; accrual → TotalValueOutstanding − ManagementFeeOutstanding (XLS-66 §3.10.5).
 */
export function loanExposure(
  loan: Pick<LoanManageLoan, "PrincipalOutstanding" | "TotalValueOutstanding" | "ManagementFeeOutstanding">,
  accounting: VaultAccounting,
): string {
  return accounting === "cash_basis" ? fmt(dec(loan.PrincipalOutstanding)) : decSub(loan.TotalValueOutstanding, loan.ManagementFeeOutstanding);
}

export interface DefaultCoverInput {
  /** LoanBroker.DebtTotal before the default (cash basis: principal still owed across the broker's loans). */
  debtTotal: string;
  /** LoanBroker.CoverRateMinimum in 1/10 bps (10000 = 10%). */
  coverRateMinimum: number;
  /** LoanBroker.CoverRateLiquidation in 1/10 bps of the minimum cover (100000 = 100%). */
  coverRateLiquidation: number;
  /** The defaulted loan's exposure, `loanExposure(loan, accounting)`. */
  defaultAmount: string;
  /** LoanBroker.CoverAvailable before the default. */
  coverAvailable: string;
  /** Loan.LoanScale (e.g. -12): rippled rounds the liquidation UP to 10^LoanScale before the CoverAvailable cap. */
  loanScale?: number;
}

/**
 * First-loss cover a default moves from the LoanBroker pseudo-account to the vault (XLS-66 §3.10.5; rippled 3.4.1
 * `LoanManage::defaultLoan`):
 *   DefaultCovered = min( roundUp( min(DebtTotal × CoverRateMinimum × CoverRateLiquidation, DefaultAmount), 10^LoanScale ), CoverAvailable )
 * with both rates in 1/10 bps (÷ 100000 each). Exact decimal arithmetic. With Drawproof's rates (10% / 100%) that is
 * 10% of DebtTotal, capped by the exposure and by the cover actually posted.
 */
export function expectedDefaultCovered(p: DefaultCoverInput): string {
  for (const [name, v] of [
    ["CoverRateMinimum", p.coverRateMinimum],
    ["CoverRateLiquidation", p.coverRateLiquidation],
  ] as const) {
    if (!Number.isInteger(v) || v < 0 || v > TENTH_BPS_ONE) throw new Error(`${name} must be an integer in 0..${TENTH_BPS_ONE} (got ${v})`);
  }
  const debt = dec(p.debtTotal);
  const exposure = dec(p.defaultAmount);
  const cover = dec(p.coverAvailable);
  for (const [name, d] of [
    ["debtTotal", debt],
    ["defaultAmount", exposure],
    ["coverAvailable", cover],
  ] as const) {
    if (d.n < 0n) throw new Error(`${name} must be >= 0 (got ${fmt(d)})`);
  }
  // DebtTotal × CRM/1e5 × CRL/1e5 is exact with 10 more decimals.
  const liquidation: Dec = { n: debt.n * BigInt(p.coverRateMinimum) * BigInt(p.coverRateLiquidation), s: debt.s + 10 };
  let covered = minDec(liquidation, exposure);
  if (p.loanScale !== undefined) covered = ceilToScale(covered, p.loanScale);
  return fmt(minDec(covered, cover));
}

// ---------------------------------------------------------------- pure: guards (mirror rippled 3.4.1 preclaim order)

/** Ledger time (Ripple s) the close time must pass before tfLoanDefault is allowed: NextPaymentDueDate + GracePeriod. */
export function defaultableAfter(loan: Pick<LoanManageLoan, "NextPaymentDueDate" | "GracePeriod">): number {
  return (loan.NextPaymentDueDate ?? 0) + (loan.GracePeriod ?? 0);
}

/** Ledger time (Ripple s) the close time must pass before tfLoanImpair is allowed (fixCleanup3_4_0): NextPaymentDueDate. */
export function impairableAfter(loan: Pick<LoanManageLoan, "NextPaymentDueDate">): number {
  return loan.NextPaymentDueDate ?? 0;
}

export type LoanManageRefusal =
  | "loan_not_found" // tecNO_ENTRY
  | "already_defaulted" // tecNO_PERMISSION: a defaulted loan can't be modified
  | "already_impaired" // tecNO_PERMISSION
  | "not_impaired" // tecNO_PERMISSION: unimpair on an unimpaired loan
  | "paid_off" // tecNO_PERMISSION: PaymentRemaining 0
  | "too_soon" // tecTOO_SOON: default before due + grace, impair before due
  | "not_broker_owner" // tecNO_PERMISSION: only LoanBroker.Owner may submit
  | "loss_exceeds_vault"; // tecLIMIT_EXCEEDED: impair would push LossUnrealized above AssetsTotal − AssetsAvailable

export type LoanManageCheck =
  | { ok: true; expectedResult: "tesSUCCESS" }
  | {
      ok: false;
      reason: LoanManageRefusal;
      /** What rippled would return for this tx. */
      expectedResult: string;
      message: string;
      /** too_soon only: the action is allowed once the ledger close time is greater than this (Ripple s). */
      allowedAfter?: number;
    };

export type LoanManageRefused = Extract<LoanManageCheck, { ok: false }>;

export interface LoanManageCheckInput {
  action: LoanManageAction;
  /** The Loan entry; undefined = not on the ledger. */
  loan: LoanManageLoan | undefined;
  /**
   * Close time (Ripple s) of the validated ledger the reads came from. The tx applies in a later ledger whose parent
   * close time is at least this, so a pass here is a pass on the ledger (timing only gets more permissive).
   */
  now: number;
  /** Signing account and LoanBroker.Owner: compared when both are given. */
  submitter?: string;
  brokerOwner?: string;
  /** Vault entry: enables the impair tecLIMIT_EXCEEDED check. */
  vault?: Pick<VaultManageEntry, "AssetsTotal" | "AssetsAvailable" | "LossUnrealized" | "LEVersion">;
}

const iso = (t: number) => rippleTimeToISOTime(t);

/**
 * Would rippled 3.4.1 (fixCleanup3_4_0 enabled, as on devnet) accept this LoanManage at ledger time `now`? Checks run in
 * rippled's order (preclaim, then doApply), so the reason is the code the ledger would return. Pure.
 */
export function checkLoanManage(p: LoanManageCheckInput): LoanManageCheck {
  const { action, loan, now } = p;
  const refuse = (reason: LoanManageRefusal, expectedResult: string, message: string, allowedAfter?: number): LoanManageRefused => ({
    ok: false,
    reason,
    expectedResult,
    message,
    ...(allowedAfter !== undefined ? { allowedAfter } : {}),
  });
  if (!loan) return refuse("loan_not_found", "tecNO_ENTRY", "no Loan with this ID on the ledger (never created, or removed by LoanDelete)");
  const flags = loan.Flags ?? 0;
  const impaired = (flags & LSF_LOAN_IMPAIRED) !== 0;
  if ((flags & LSF_LOAN_DEFAULT) !== 0) return refuse("already_defaulted", "tecNO_PERMISSION", "the loan is in default; a defaulted loan can't be modified");
  if (impaired && action === "impair") return refuse("already_impaired", "tecNO_PERMISSION", "the loan is already impaired");
  if (!impaired && action === "unimpair") return refuse("not_impaired", "tecNO_PERMISSION", "the loan is not impaired");
  if (!loan.PaymentRemaining) return refuse("paid_off", "tecNO_PERMISSION", "the loan is fully paid (PaymentRemaining 0)");
  if (action === "default") {
    const after = defaultableAfter(loan);
    if (now <= after) {
      return refuse(
        "too_soon",
        "tecTOO_SOON",
        `default is allowed only once ledger time > NextPaymentDueDate + GracePeriod = ${iso(after)} (ledger now ${iso(now)}, ${after - now + 1}s to go)`,
        after,
      );
    }
  }
  if (p.submitter && p.brokerOwner && p.submitter !== p.brokerOwner) {
    return refuse("not_broker_owner", "tecNO_PERMISSION", `only the LoanBroker owner ${p.brokerOwner} may submit LoanManage (submitter ${p.submitter})`);
  }
  if (action === "impair") {
    const due = impairableAfter(loan);
    if (now <= due) {
      return refuse("too_soon", "tecTOO_SOON", `impair is allowed only once the payment is overdue: ledger time > NextPaymentDueDate ${iso(due)} (ledger now ${iso(now)}, ${due - now + 1}s to go)`, due);
    }
    if (p.vault) {
      const loss = decAdd(p.vault.LossUnrealized, loanExposure(loan, vaultAccounting(p.vault)));
      const room = decSub(p.vault.AssetsTotal, p.vault.AssetsAvailable);
      if (decCmp(loss, room) > 0) {
        return refuse("loss_exceeds_vault", "tecLIMIT_EXCEEDED", `LossUnrealized would become ${loss} > AssetsTotal − AssetsAvailable = ${room}`);
      }
    }
  }
  return { ok: true, expectedResult: "tesSUCCESS" };
}

/** True when `LoanManage tfLoanDefault` would pass at ledger time `now`: not defaulted, payments remain, now > due + grace. */
export function canDefaultAt(loan: LoanManageLoan, now: number): boolean {
  return checkLoanManage({ action: "default", loan, now }).ok;
}

/** True when `LoanManage tfLoanImpair` would pass at ledger time `now` (fixCleanup3_4_0: only once the payment is overdue). */
export function canImpairAt(loan: LoanManageLoan, now: number): boolean {
  return checkLoanManage({ action: "impair", loan, now }).ok;
}

// ---------------------------------------------------------------- errors (nothing was submitted)

/** The ledger would answer tecTOO_SOON: a shared `TooSoonError` (code `too_soon`) that also says when to retry. */
export class LoanManageTooSoonError extends TooSoonError {
  constructor(
    readonly action: LoanManageAction,
    readonly loanId: string,
    /** Ledger close time (Ripple s) the guard ran at. */
    readonly now: number,
    /** Retry once the ledger close time is greater than this (Ripple s). */
    readonly allowedAfter: number,
    message: string,
  ) {
    super(`LoanManage ${action} ${loanId.slice(0, 8)}… refused before submit: ${message}`);
    this.name = "LoanManageTooSoonError";
  }

  get allowedAfterIso(): string {
    return iso(this.allowedAfter);
  }
}

/** Any other refusal the ledger would make (tecNO_PERMISSION / tecNO_ENTRY / tecLIMIT_EXCEEDED). Shared `LedgerError`, code `ledger_error`. */
export class LoanManageRefusedError extends LedgerError {
  readonly reason: LoanManageRefusal;
  /** What the ledger would have returned. */
  readonly expectedResult: string;

  constructor(
    readonly action: LoanManageAction,
    readonly loanId: string,
    check: LoanManageRefused,
  ) {
    super("ledger_error", `LoanManage ${action} ${loanId.slice(0, 8)}… refused before submit (${check.reason}, the ledger would return ${check.expectedResult}): ${check.message}`);
    this.name = "LoanManageRefusedError";
    this.reason = check.reason;
    this.expectedResult = check.expectedResult;
  }
}

function refusalError(action: LoanManageAction, loanId: string, now: number, check: LoanManageRefused): LedgerError {
  return check.reason === "too_soon" && check.allowedAfter !== undefined
    ? new LoanManageTooSoonError(action, loanId, now, check.allowedAfter, check.message)
    : new LoanManageRefusedError(action, loanId, check);
}

// ---------------------------------------------------------------- pure: outcomes from tx metadata

interface MetaNode {
  LedgerEntryType?: string;
  LedgerIndex?: string;
  PreviousFields?: Record<string, unknown>;
  FinalFields?: Record<string, unknown>;
}

function modifiedNode(meta: Record<string, unknown>, type: string, index?: string): MetaNode | undefined {
  const nodes = (meta.AffectedNodes ?? []) as Array<{ ModifiedNode?: MetaNode }>;
  return nodes.map((n) => n.ModifiedNode).find((m): m is MetaNode => !!m && m.LedgerEntryType === type && (!index || m.LedgerIndex === index));
}

function requireNode(meta: Record<string, unknown>, type: string, index?: string): MetaNode {
  const n = modifiedNode(meta, type, index);
  if (!n) throw new Error(`LoanManage metadata has no modified ${type}${index ? ` ${index}` : ""}`);
  return n;
}

/**
 * Before/after of one numeric field of a ModifiedNode, as plain decimals. rippled lists a field in PreviousFields only if
 * it existed before and changed; a field that was absent (= 0) and is now set shows up in FinalFields only. `grew` (the tx
 * is known to have raised the field) resolves that case to "0" instead of "unchanged".
 */
function fieldChange(node: MetaNode, field: string, grew = false): { before: string; after: string } {
  const prev = node.PreviousFields?.[field];
  const after = fmt(dec(node.FinalFields?.[field]));
  if (prev != null) return { before: fmt(dec(prev)), after };
  return { before: grew ? "0" : after, after };
}

/** Same formula as reads.ts `parseVaultSnapshot().sharePrice`: assets per whole share (shares / 10^Scale), 6 dp, "1" with no shares. */
function pricePerShare(assets: string, sharesOutstanding: string, scale: number): string {
  if (BigInt(sharesOutstanding) === 0n) return "1";
  return divDecimal(assets, toPlainDecimal(`${sharesOutstanding}e-${scale}`), 6);
}

export interface VaultFigures {
  assetsTotal: Rlusd;
  assetsAvailable: Rlusd;
  lossUnrealized: Rlusd;
  /** What reads.ts `getVaultSnapshot` / the UI show: AssetsTotal per whole share (6 dp). */
  sharePrice: string;
  /** XLS-65 §3.1.7.1 exchange rate: (AssetsTotal − LossUnrealized) per whole share (6 dp), what a withdrawal pays. */
  netSharePrice: string;
}

function vaultFigures(v: { assetsTotal: string; assetsAvailable: string; lossUnrealized: string }, sharesOutstanding: string, scale: number): VaultFigures {
  return {
    assetsTotal: toRlusd(v.assetsTotal),
    assetsAvailable: toRlusd(v.assetsAvailable),
    lossUnrealized: toRlusd(v.lossUnrealized),
    sharePrice: pricePerShare(v.assetsTotal, sharesOutstanding, scale),
    netSharePrice: pricePerShare(decSub(v.assetsTotal, v.lossUnrealized), sharesOutstanding, scale),
  };
}

export interface DefaultOutcome {
  loanId: string;
  /** `cash_basis` on every devnet vault (exposure = principal outstanding). */
  accounting: VaultAccounting;
  /** The loan was impaired first; the default then also clears that paper loss (LossUnrealized −= exposure). */
  wasImpaired: boolean;
  /** DefaultAmount, the exposure written off: Loan.PrincipalOutstanding (cash basis) or TVO − ManagementFeeOutstanding (accrual). */
  defaultAmount: Rlusd;
  /** First-loss cover moved from the LoanBroker pseudo-account into the vault (CoverAvailable drop = AssetsAvailable rise). */
  defaultCovered: Rlusd;
  /** `expectedDefaultCovered()` on the pre-default ledger state: equals `defaultCovered` when the ledger did what the spec says. */
  expectedDefaultCovered: Rlusd;
  /** Vault write-down (AssetsTotal drop) = defaultAmount − defaultCovered: what the investors lose. */
  vaultLoss: Rlusd;
  debtTotal: { before: Rlusd; after: Rlusd };
  coverAvailable: { before: Rlusd; after: Rlusd };
  vault: { before: VaultFigures; after: VaultFigures };
  /** Share-MPT units outstanding (a LoanManage never changes them). */
  sharesOutstanding: string;
  /** Exact ledger decimals behind the truncated Rlusd figures. */
  exact: { defaultAmount: string; defaultCovered: string; expectedDefaultCovered: string; vaultLoss: string };
}

/** Pure: a validated `LoanManage tfLoanDefault`'s metadata → `DefaultOutcome`. `sharesOutstanding` from the vault's share issuance. */
export function parseDefaultOutcome(meta: Record<string, unknown>, ctx: { loanId: string; sharesOutstanding: string }): DefaultOutcome {
  const loanNode = requireNode(meta, "Loan", ctx.loanId);
  const brokerNode = requireNode(meta, "LoanBroker");
  const vaultNode = requireNode(meta, "Vault");
  const loanBefore = { ...loanNode.FinalFields, ...loanNode.PreviousFields } as LoanManageLoan & { LoanScale?: number };
  const accounting = vaultAccounting(vaultNode.FinalFields);
  const cover = fieldChange(brokerNode, "CoverAvailable");
  const debt = fieldChange(brokerNode, "DebtTotal");
  const defaultCovered = decSub(cover.before, cover.after);
  const assetsTotal = fieldChange(vaultNode, "AssetsTotal");
  const assetsAvailable = fieldChange(vaultNode, "AssetsAvailable", decCmp(defaultCovered, "0") > 0);
  const lossUnrealized = fieldChange(vaultNode, "LossUnrealized");
  const vaultLoss = decSub(assetsTotal.before, assetsTotal.after);
  const defaultAmount = loanExposure(loanBefore, accounting);
  const expected = expectedDefaultCovered({
    debtTotal: debt.before,
    coverRateMinimum: Number(brokerNode.FinalFields?.CoverRateMinimum ?? 0),
    coverRateLiquidation: Number(brokerNode.FinalFields?.CoverRateLiquidation ?? 0),
    defaultAmount,
    coverAvailable: cover.before,
    ...(typeof loanBefore.LoanScale === "number" ? { loanScale: loanBefore.LoanScale } : {}),
  });
  const scale = Number(vaultNode.FinalFields?.Scale ?? 0);
  return {
    loanId: ctx.loanId,
    accounting,
    wasImpaired: ((loanBefore.Flags ?? 0) & LSF_LOAN_IMPAIRED) !== 0,
    defaultAmount: toRlusd(defaultAmount),
    defaultCovered: toRlusd(defaultCovered),
    expectedDefaultCovered: toRlusd(expected),
    vaultLoss: toRlusd(vaultLoss),
    debtTotal: { before: toRlusd(debt.before), after: toRlusd(debt.after) },
    coverAvailable: { before: toRlusd(cover.before), after: toRlusd(cover.after) },
    vault: {
      before: vaultFigures({ assetsTotal: assetsTotal.before, assetsAvailable: assetsAvailable.before, lossUnrealized: lossUnrealized.before }, ctx.sharesOutstanding, scale),
      after: vaultFigures({ assetsTotal: assetsTotal.after, assetsAvailable: assetsAvailable.after, lossUnrealized: lossUnrealized.after }, ctx.sharesOutstanding, scale),
    },
    sharesOutstanding: ctx.sharesOutstanding,
    exact: { defaultAmount, defaultCovered, expectedDefaultCovered: expected, vaultLoss },
  };
}

export interface ImpairOutcome {
  loanId: string;
  action: "impair" | "unimpair";
  accounting: VaultAccounting;
  /** Paper loss booked (impair) or reversed (unimpair): |ΔLossUnrealized| = the loan's exposure. */
  exposure: Rlusd;
  vault: { before: VaultFigures; after: VaultFigures };
  /** Loan.NextPaymentDueDate after the tx (ISO). fixCleanup3_4_0: impair/unimpair leave it unchanged. */
  nextPaymentDueDate: string;
  sharesOutstanding: string;
}

/** Pure: a validated `LoanManage tfLoanImpair|tfLoanUnimpair`'s metadata → `ImpairOutcome`. */
export function parseImpairOutcome(
  meta: Record<string, unknown>,
  ctx: { loanId: string; action: "impair" | "unimpair"; sharesOutstanding: string },
): ImpairOutcome {
  const vaultNode = requireNode(meta, "Vault");
  const loanNode = requireNode(meta, "Loan", ctx.loanId);
  const loss = fieldChange(vaultNode, "LossUnrealized", ctx.action === "impair");
  const assetsTotal = fieldChange(vaultNode, "AssetsTotal");
  const assetsAvailable = fieldChange(vaultNode, "AssetsAvailable");
  const scale = Number(vaultNode.FinalFields?.Scale ?? 0);
  const due = Number(loanNode.FinalFields?.NextPaymentDueDate ?? 0);
  const exposure = ctx.action === "impair" ? decSub(loss.after, loss.before) : decSub(loss.before, loss.after);
  return {
    loanId: ctx.loanId,
    action: ctx.action,
    accounting: vaultAccounting(vaultNode.FinalFields),
    exposure: toRlusd(exposure),
    vault: {
      before: vaultFigures({ assetsTotal: assetsTotal.before, assetsAvailable: assetsAvailable.before, lossUnrealized: loss.before }, ctx.sharesOutstanding, scale),
      after: vaultFigures({ assetsTotal: assetsTotal.after, assetsAvailable: assetsAvailable.after, lossUnrealized: loss.after }, ctx.sharesOutstanding, scale),
    },
    nextPaymentDueDate: due ? iso(due) : "",
    sharesOutstanding: ctx.sharesOutstanding,
  };
}

// ---------------------------------------------------------------- network: state read, guarded submit

/** Loan + its LoanBroker + Vault from ONE validated ledger, and that ledger's close time. */
export interface LoanManageState {
  ledgerIndex: number;
  /** Close time (Ripple s) of `ledgerIndex`. */
  now: number;
  loan: LoanManageEntry | undefined;
  broker: LoanBrokerManageEntry | undefined;
  vault: VaultManageEntry | undefined;
}

async function entryAt<T>(sel: Record<string, unknown>, ledgerIndex: number | "validated"): Promise<T | undefined> {
  const r = await rawRequest({ command: "ledger_entry", ...sel, ledger_index: ledgerIndex });
  if (r.error === "entryNotFound") return undefined;
  if (r.error) throw new Error(`ledger_entry ${JSON.stringify(sel)}: rippled error ${r.error}`);
  return r.node as T;
}

export async function fetchLoanManageState(loanId: string): Promise<LoanManageState> {
  const { ledgerIndex, closeTime } = await fetchLedgerNow();
  const loan = await entryAt<LoanManageEntry>({ index: loanId }, ledgerIndex);
  const broker = loan ? await entryAt<LoanBrokerManageEntry>({ index: loan.LoanBrokerID }, ledgerIndex) : undefined;
  const vault = broker ? await entryAt<VaultManageEntry>({ index: broker.VaultID }, ledgerIndex) : undefined;
  return { ledgerIndex, now: closeTime, loan, broker, vault };
}

export interface LoanManageParams {
  loanId: string;
  /** The LoanBroker owner (= platform): a Wallet, role name or demo address. Default: the demo "platform" wallet. */
  brokerOwner?: WalletRole | string | Wallet;
  /** Negative spikes only: submit even when the guard refuses, so the ledger's tec lands on-ledger. */
  skipGuard?: boolean;
}

/** Guard on `state`, then sign + submit as `owner`. Call inside `withAccountLock(owner)`. */
async function submitGuarded(action: LoanManageAction, p: LoanManageParams, owner: Wallet, state: LoanManageState): Promise<TxResult> {
  const check = checkLoanManage({ action, loan: state.loan, now: state.now, submitter: owner.classicAddress, brokerOwner: state.broker?.Owner, vault: state.vault });
  if (!check.ok && !p.skipGuard) throw refusalError(action, p.loanId, state.now, check);
  return signAndSubmit(owner, { TransactionType: "LoanManage", Account: owner.classicAddress, LoanID: p.loanId, Flags: LOAN_MANAGE_FLAG[action] });
}

/** Share-MPT units outstanding at `ledgerIndex` (the ledger the LoanManage validated in). */
async function sharesAt(shareMptId: unknown, ledgerIndex: number | undefined): Promise<string> {
  if (typeof shareMptId !== "string") return "0";
  const node = await entryAt<{ OutstandingAmount?: string }>({ mpt_issuance: shareMptId }, ledgerIndex ?? "validated");
  return node?.OutstandingAmount ?? "0";
}

const txTime = (tx: TxResult): string | undefined => (typeof tx.tx.date === "number" ? iso(tx.tx.date) : undefined);

export interface ImpairResult {
  tx: TxResult;
  outcome: ImpairOutcome;
}

async function manageImpairment(action: "impair" | "unimpair", p: LoanManageParams): Promise<ImpairResult> {
  const owner = resolveWallet(p.brokerOwner ?? "platform");
  const tx = await withAccountLock(owner.classicAddress, async () => submitGuarded(action, p, owner, await fetchLoanManageState(p.loanId)));
  const vaultNode = requireNode(tx.meta, "Vault");
  const sharesOutstanding = await sharesAt(vaultNode.FinalFields?.ShareMPTID, tx.ledgerIndex);
  return { tx, outcome: parseImpairOutcome(tx.meta, { loanId: p.loanId, action, sharesOutstanding }) };
}

/**
 * `LoanManage tfLoanImpair` by the broker owner: books the loan's exposure as the vault's `LossUnrealized` (a reversible
 * paper loss; the next LoanPay clears it). Devnet (fixCleanup3_4_0): only once the payment is overdue, else
 * `LoanManageTooSoonError` without submitting. Emits no ChainEvent: shared v2 has no impairment kind, and `loan_default`
 * would claim a default that hasn't happened.
 */
export function impairLoan(p: LoanManageParams): Promise<ImpairResult> {
  return manageImpairment("impair", p);
}

/** `LoanManage tfLoanUnimpair`: reverses the paper loss (`LossUnrealized −= exposure`). No ChainEvent (see impairLoan). */
export function unimpairLoan(p: LoanManageParams): Promise<ImpairResult> {
  return manageImpairment("unimpair", p);
}

export interface DefaultLoanResult {
  tx: TxResult;
  /** `loan_default`, amount = DefaultAmount, at = the ledger close time of the default. */
  event: ChainEvent;
  outcome: DefaultOutcome;
  /** The loan was already defaulted: nothing was submitted; `tx` / `outcome` / `event` describe the original default. */
  alreadyDefaulted: boolean;
}

/** The tx that defaulted `loan`: its PreviousTxnID, since nothing can modify a defaulted loan afterwards. */
async function priorDefaultTx(loan: LoanManageEntry, loanId: string): Promise<TxResult | undefined> {
  if (!loan.PreviousTxnID) return undefined;
  const tx = await fetchValidatedTx(loan.PreviousTxnID).catch((e: unknown) => {
    if ((e as { data?: { error?: string } }).data?.error === "txnNotFound") return undefined; // history pruned on this node
    throw e;
  });
  const ok =
    tx?.result === "tesSUCCESS" &&
    tx.tx.TransactionType === "LoanManage" &&
    tx.tx.LoanID === loanId &&
    (Number(tx.tx.Flags ?? 0) & LoanManageFlags.tfLoanDefault) !== 0;
  return ok ? tx : undefined;
}

/**
 * `LoanManage tfLoanDefault` by the broker owner (platform), under its account lock (XRPL-12). Guard first, on one
 * validated ledger: before `NextPaymentDueDate + GracePeriod` → `LoanManageTooSoonError` (a shared `TooSoonError`, with
 * `allowedAfter`); a non-owner, paid-off or unknown loan → `LoanManageRefusedError`; nothing is submitted in either case.
 * Idempotent: an already-defaulted loan returns the original default (`alreadyDefaulted: true`, looked up through
 * Loan.PreviousTxnID) without submitting. The outcome comes from the tx metadata: DefaultAmount, DefaultCovered (cover returned
 * to the vault) vs `expectedDefaultCovered`, CoverAvailable / DebtTotal / vault AssetsTotal, AssetsAvailable, LossUnrealized
 * and share price before → after.
 */
export async function defaultLoan(p: LoanManageParams & { projectId: string }): Promise<DefaultLoanResult> {
  const owner = resolveWallet(p.brokerOwner ?? "platform");
  const { tx, alreadyDefaulted } = await withAccountLock(owner.classicAddress, async () => {
    const state = await fetchLoanManageState(p.loanId);
    if (!p.skipGuard && state.loan && ((state.loan.Flags ?? 0) & LSF_LOAN_DEFAULT) !== 0) {
      const prior = await priorDefaultTx(state.loan, p.loanId);
      if (prior) return { tx: prior, alreadyDefaulted: true };
    }
    return { tx: await submitGuarded("default", p, owner, state), alreadyDefaulted: false };
  });
  const vaultNode = requireNode(tx.meta, "Vault");
  const outcome = parseDefaultOutcome(tx.meta, { loanId: p.loanId, sharesOutstanding: await sharesAt(vaultNode.FinalFields?.ShareMPTID, tx.ledgerIndex) });
  const at = txTime(tx);
  const event = toChainEvent(tx, {
    projectId: p.projectId,
    kind: "loan_default",
    actor: typeof tx.tx.Account === "string" ? tx.tx.Account : owner.classicAddress,
    amount: outcome.defaultAmount,
    ...(at ? { at } : {}),
  });
  return { tx, event, outcome, alreadyDefaulted };
}
