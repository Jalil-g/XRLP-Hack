// XRPL-06: pure validation + planning for closeLoanAndCreateEscrows. No network, no wallets (test/loan-close.test.ts).
// Everything that could make an EscrowCreate fail is checked here, BEFORE the LoanSet, so a bad input never leaves the
// principal sitting liquid in the SPV.
import { LedgerError } from "@xrlp/shared";
import { isoTimeToRippleTime, rippleTimeToISOTime } from "xrpl";
import { normalizeCondition, PREIMAGE_CONDITION_RE } from "./condition.ts";
import { LOANSET_REDEMPTION_MARGIN_S, toMicro } from "./lending-math.ts";

/** XLS-66 `PaymentInterval` floor (seconds). */
export const MIN_PAYMENT_INTERVAL_S = 60;
/** XLS-66 `InterestRate` ceiling in 1/10 bps (100%). */
export const MAX_INTEREST_RATE = 100_000;
/**
 * Every escrow's CancelAfter must be at least this far past ledger "now" at planning time: LoanSet + N EscrowCreates
 * take one ledger each (~4-6s on devnet), and an EscrowCreate with CancelAfter already past fails tecNO_PERMISSION.
 */
export const MIN_ESCROW_LIFETIME_S = 60;

/** Conditions in any accepted shape: by milestone index, by milestone id, or a list of pairs. */
export type CloseConditions = string[] | Record<string, string> | { milestoneId: string; condition: string }[];

export interface ClosePlanInput {
  milestones: { id: string; amount: string; cancelAfter?: string }[];
  conditions: CloseConditions;
  /** ISO, by milestone index. Overrides milestone.cancelAfter and defaultCancelAfter. */
  cancelAfters?: string[];
  /** Ripple seconds. Default: maturity − paymentIntervalS (see DEFAULT below). */
  defaultCancelAfter?: number;
  /** Latest validated ledger close time (Ripple seconds), read right before planning. */
  now: number;
  paymentTotal: number;
  paymentIntervalS: number;
  /** Annual, 1/10 bps. */
  interestRate: number;
  /** Vault.RedemptionDate (Ripple seconds), if any: LoanSet needs start + interval × total + 60 ≤ it. */
  redemptionDate?: number;
  /** Conditions of escrows the SPV already owns (account_objects). A reused condition is rejected. */
  existingConditions?: string[];
  minEscrowLifetimeS?: number;
}

export interface PlannedEscrow {
  milestoneId: string;
  index: number;
  amount: string;
  /** Uppercase hex. */
  condition: string;
  /** Ripple seconds. */
  cancelAfter: number;
}

export interface ClosePlan {
  paymentTotal: number;
  paymentIntervalS: number;
  interestRate: number;
  /**
   * Lower bound of loan maturity: now + interval × total. The real LoanSet starts a few seconds later, so its maturity
   * is ≥ this; every CancelAfter < this is also < the real maturity.
   */
  maturity: number;
  escrows: PlannedEscrow[];
}

/** Bad close input. Nothing was submitted. `issues` lists every problem found (not just the first). */
export class CloseValidationError extends Error {
  readonly code = "validation" as const;
  constructor(readonly issues: string[]) {
    super(`closeLoanAndCreateEscrows: invalid input, nothing submitted:\n  - ${issues.join("\n  - ")}`);
    this.name = "CloseValidationError";
  }
}

/**
 * Validate everything and compute the escrows to create, or throw CloseValidationError. Checks:
 * PaymentTotal ≥ 2 (int), PaymentInterval ≥ 60s (int), 0 < InterestRate ≤ 100%, loan fits before RedemptionDate,
 * one well-formed PREIMAGE-SHA-256 condition per milestone (no extras), no duplicate within the call or with the SPV's
 * open escrows, amounts > 0, now + MIN_ESCROW_LIFETIME_S < CancelAfter < maturity.
 */
export function planLoanClose(p: ClosePlanInput): ClosePlan {
  const issues: string[] = [];
  const { paymentTotal, paymentIntervalS, interestRate, now } = p;

  if (!Number.isInteger(paymentTotal) || paymentTotal < 2) issues.push(`PaymentTotal must be an integer ≥ 2, got ${paymentTotal}`);
  if (!Number.isInteger(paymentIntervalS) || paymentIntervalS < MIN_PAYMENT_INTERVAL_S) {
    issues.push(`PaymentInterval must be an integer ≥ ${MIN_PAYMENT_INTERVAL_S}s, got ${paymentIntervalS}`);
  }
  if (!Number.isInteger(interestRate) || interestRate <= 0 || interestRate > MAX_INTEREST_RATE) {
    issues.push(`InterestRate must be an integer in (0, ${MAX_INTEREST_RATE}] (1/10 bps; 0 risks tecPRECISION_LOSS), got ${interestRate}`);
  }
  const maturity = now + paymentIntervalS * paymentTotal;
  if (p.redemptionDate != null && maturity + LOANSET_REDEMPTION_MARGIN_S > p.redemptionDate) {
    issues.push(`loan does not fit the vault: now + ${paymentIntervalS}s × ${paymentTotal} + ${LOANSET_REDEMPTION_MARGIN_S}s = ${iso(maturity + LOANSET_REDEMPTION_MARGIN_S)} > RedemptionDate ${iso(p.redemptionDate)} (LoanSet would fail tecNO_PERMISSION)`);
  }

  const ms = p.milestones;
  if (!ms.length) issues.push("project has no milestones");
  const ids = ms.map((m) => m.id);
  for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) issues.push(`duplicate milestone id ${id}`);

  const conds = conditionsByIndex(ms, p.conditions, issues);
  if (p.cancelAfters && p.cancelAfters.length !== ms.length) {
    issues.push(`cancelAfters has ${p.cancelAfters.length} entries for ${ms.length} milestones (index = project.milestones[i])`);
  }

  const existing = new Set((p.existingConditions ?? []).map(normalizeCondition));
  const seen = new Map<string, string>();
  const minCancel = now + (p.minEscrowLifetimeS ?? MIN_ESCROW_LIFETIME_S);
  // Default: one payment interval before maturity, so a refunded escrow can still pay the last installment on time.
  const defaultCancel = p.defaultCancelAfter ?? maturity - paymentIntervalS;
  const escrows: PlannedEscrow[] = [];

  ms.forEach((m, index) => {
    const label = `milestone ${m.id} (#${index})`;
    let amount = m.amount;
    try {
      if (toMicro(m.amount) <= 0n) issues.push(`${label}: amount must be > 0, got ${m.amount}`);
    } catch (e) {
      issues.push(`${label}: ${(e as Error).message}`);
      amount = "0";
    }

    const raw = conds[index];
    const condition = raw == null ? "" : normalizeCondition(raw);
    if (raw == null) issues.push(`${label}: missing condition`);
    else if (!PREIMAGE_CONDITION_RE.test(condition)) {
      issues.push(`${label}: condition is not a 32-byte PREIMAGE-SHA-256 condition (A0258020<64 hex>810120, 78 hex chars): ${JSON.stringify(raw.slice(0, 90))}`);
    } else if (seen.has(condition)) issues.push(`${label}: duplicate condition (same as milestone ${seen.get(condition)})`);
    else if (existing.has(condition)) issues.push(`${label}: condition already used by an open escrow of this SPV`);
    if (condition) seen.set(condition, m.id);

    const isoCancel = p.cancelAfters?.[index] ?? m.cancelAfter;
    let cancelAfter = defaultCancel;
    if (isoCancel != null) {
      const t = Date.parse(isoCancel);
      if (Number.isNaN(t)) issues.push(`${label}: CancelAfter is not an ISO timestamp: ${JSON.stringify(isoCancel)}`);
      else cancelAfter = isoTimeToRippleTime(new Date(t).toISOString());
    }
    if (cancelAfter >= maturity) {
      issues.push(`${label}: CancelAfter ${iso(cancelAfter)} must be before loan maturity ${iso(maturity)} (now + ${paymentIntervalS}s × ${paymentTotal})`);
    }
    if (cancelAfter <= minCancel) {
      issues.push(`${label}: CancelAfter ${iso(cancelAfter)} must be more than ${minCancel - now}s after ledger now ${iso(now)}`);
    }
    escrows.push({ milestoneId: m.id, index, amount, condition, cancelAfter });
  });

  if (issues.length) throw new CloseValidationError(issues);
  return { paymentTotal, paymentIntervalS, interestRate, maturity, escrows };
}

/** Normalize any accepted conditions shape to an array aligned with `milestones`; extras/misalignment → issues. */
function conditionsByIndex(milestones: { id: string }[], c: CloseConditions, issues: string[]): (string | undefined)[] {
  if (Array.isArray(c) && c.every((x) => typeof x === "string")) {
    const arr = c as string[];
    if (arr.length !== milestones.length) issues.push(`conditions has ${arr.length} entries for ${milestones.length} milestones (index = project.milestones[i])`);
    return milestones.map((_, i) => arr[i]);
  }
  const byId: Record<string, string> = {};
  if (Array.isArray(c)) {
    for (const x of c as unknown[]) {
      if (typeof x !== "object" || x == null || typeof (x as { milestoneId?: unknown }).milestoneId !== "string") {
        issues.push(`conditions: mixed or malformed entry ${JSON.stringify(x)}`);
        continue;
      }
      const { milestoneId, condition } = x as { milestoneId: string; condition: string };
      if (milestoneId in byId) issues.push(`conditions: milestone ${milestoneId} given twice`);
      byId[milestoneId] = condition;
    }
  } else Object.assign(byId, c);
  const known = new Set(milestones.map((m) => m.id));
  for (const id of Object.keys(byId)) if (!known.has(id)) issues.push(`conditions: unknown milestone ${id}`);
  return milestones.map((m) => byId[m.id]);
}

const iso = (t: number) => rippleTimeToISOTime(t);

/** One escrow created before the failure (enough to finish/cancel it). */
export interface CreatedEscrowRef {
  milestoneId: string;
  owner: string;
  offerSequence: number;
  condition: string;
  cancelAfter: string; // ISO
  createTx: string;
}

/**
 * LoanSet succeeded but an EscrowCreate failed: the loan exists and the SPV holds the not-yet-escrowed principal.
 * Carries what the caller needs to recover (create the `pending` escrows, or repay): loanId + the escrows that exist.
 */
export class CloseLoanPartialError extends LedgerError {
  constructor(
    readonly loanId: string,
    readonly loanSetTx: string,
    readonly created: CreatedEscrowRef[],
    /** Milestone ids without an escrow, in project order (the failed one first). */
    readonly pending: string[],
    /** The EscrowCreate error (usually an XrplTxError). */
    readonly failure: unknown,
  ) {
    const why = failure instanceof Error ? failure.message : String(failure);
    const r = failure as { engineResult?: string; hash?: string };
    super(
      "ledger_error",
      `LoanSet ${loanSetTx} succeeded (loan ${loanId}) but EscrowCreate for milestone ${pending[0]} failed: ${why}. ` +
        `Created: [${created.map((e) => `${e.milestoneId}@${e.offerSequence}`).join(", ") || "none"}]; pending: [${pending.join(", ")}]`,
      { ...(r?.engineResult ? { txResult: r.engineResult } : {}), ...(r?.hash ? { txHash: r.hash } : {}) },
    );
    this.name = "CloseLoanPartialError";
  }
}
