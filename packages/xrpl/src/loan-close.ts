// XRPL-06: pure validation + planning for closeLoanAndCreateEscrows. No network, no wallets (test/loan-close.test.ts).
// Everything that could make an EscrowCreate fail is checked here, BEFORE the LoanSet, so a bad input never leaves the
// principal sitting liquid in the SPV.
// XRPL-13b: escrow mode (one all-or-nothing Batch vs one EscrowCreate per milestone), the format gate batch.ts runs
// before signing, the partial-close context, and the pure planner + ledger parsers behind resumeEscrowCreation.
import { LedgerError } from "@xrlp/shared";
import { isoTimeToRippleTime, isValidClassicAddress, rippleTimeToISOTime } from "xrpl";
import type { BatchOutcome } from "./batch.ts";
import { describeConditionInput, normalizeCondition, PREIMAGE_CONDITION_RE } from "./condition.ts";
import { LOANSET_REDEMPTION_MARGIN_S, toMicro } from "./lending-math.ts";
import { toPlainDecimal } from "./reads.ts";

/** XLS-66 `PaymentInterval` floor (seconds). */
export const MIN_PAYMENT_INTERVAL_S = 60;
/** XLS-66 `InterestRate` ceiling in 1/10 bps (100%). */
export const MAX_INTEREST_RATE = 100_000;
/**
 * Every escrow's CancelAfter must be at least this far past ledger "now" at planning time: LoanSet + N EscrowCreates
 * take one ledger each (~4-6s on devnet), and an EscrowCreate with CancelAfter already past fails tecNO_PERMISSION.
 */
export const MIN_ESCROW_LIFETIME_S = 60;

/**
 * How the milestone escrows are created after LoanSet (XRPL-13b):
 *  - "batch": ONE all-or-nothing XLS-56 Batch holding every EscrowCreate (outer = SPV). All escrows exist or none.
 *  - "sequential": one EscrowCreate per milestone, back to back (the XRPL-06 path).
 */
export type EscrowMode = "batch" | "sequential";
/** Escrows per all-or-nothing Batch: XLS-56 allows 2..8 inner txs (= batch.ts BATCH_MIN_INNER / BATCH_MAX_INNER). */
export const BATCH_ESCROWS_MIN = 2;
export const BATCH_ESCROWS_MAX = 8;

/** Default escrow mode: one Batch for 2..8 escrows, else one EscrowCreate per milestone. */
export function defaultEscrowMode(count: number): EscrowMode {
  return count >= BATCH_ESCROWS_MIN && count <= BATCH_ESCROWS_MAX ? "batch" : "sequential";
}

/** `requested` (or the default) for `count` escrows; pushes an issue if a Batch can't hold them. */
function escrowModeFor(count: number, requested: EscrowMode | undefined, issues: string[]): EscrowMode {
  if (requested === undefined) return defaultEscrowMode(count);
  if (requested !== "batch" && requested !== "sequential") {
    issues.push(`escrowMode must be "batch" or "sequential", got ${JSON.stringify(requested)}`);
    return defaultEscrowMode(count);
  }
  if (requested === "batch" && (count < BATCH_ESCROWS_MIN || count > BATCH_ESCROWS_MAX)) {
    issues.push(`escrowMode "batch" needs ${BATCH_ESCROWS_MIN}..${BATCH_ESCROWS_MAX} escrows (XLS-56 inner-tx limit), got ${count}; use "sequential"`);
  }
  return requested;
}

/** The escrow mode for `count` escrows, or CloseValidationError if `requested` is "batch" and a Batch can't hold them. */
export function resolveEscrowMode(count: number, requested?: EscrowMode, what?: string): EscrowMode {
  const issues: string[] = [];
  const mode = escrowModeFor(count, requested, issues);
  if (issues.length) throw new CloseValidationError(issues, what);
  return mode;
}

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
  /** Requested escrow mode. Default: "batch" for 2..8 milestones, else "sequential". */
  escrowMode?: EscrowMode;
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
  escrowMode: EscrowMode;
}

/** Bad close input. Nothing was submitted. `issues` lists every problem found (not just the first). */
export class CloseValidationError extends Error {
  readonly code = "validation" as const;
  constructor(
    readonly issues: string[],
    /** Message prefix: the call that refused. */
    what = "closeLoanAndCreateEscrows",
  ) {
    super(`${what}: invalid input, nothing submitted:\n  - ${issues.join("\n  - ")}`);
    this.name = "CloseValidationError";
  }
}

/** Why `raw` is not a usable 32-byte PREIMAGE-SHA-256 condition, or undefined. */
function conditionProblem(raw: unknown): string | undefined {
  if (raw == null) return "missing condition";
  if (typeof raw !== "string" || !PREIMAGE_CONDITION_RE.test(normalizeCondition(raw))) {
    return `condition is not a 32-byte PREIMAGE-SHA-256 condition (A0258020<64 hex>810120, 78 hex chars); got ${describeConditionInput(raw)}`;
  }
  return undefined;
}

/**
 * Pure (security review M5): why `destination` must not receive the milestone escrows. The destination is fixed at
 * EscrowCreate and every release pays it, so it is checked before the LoanSet: a classic address, not the SPV or the
 * RLUSD issuer, not another known role's key (`otherRoles`: role → address), and, when the SPV's on-ledger signer list
 * is given, one of its signers (the project's builder is one of the four). `exists: false` = no such account (tecNO_DST).
 */
export function escrowDestinationProblems(p: {
  destination: unknown;
  spv: string;
  issuer?: string;
  otherRoles?: Record<string, string>;
  spvSigners?: string[];
  exists?: boolean;
}): string[] {
  const d = p.destination;
  if (typeof d !== "string" || !isValidClassicAddress(d)) {
    return [`escrow destination is not a classic XRPL address (${typeof d === "string" ? `${d.length} chars` : typeof d}; value not echoed)`];
  }
  const issues: string[] = [];
  if (d === p.spv) issues.push(`escrow destination ${d} is the SPV itself`);
  if (p.issuer && d === p.issuer) issues.push(`escrow destination ${d} is the RLUSD issuer`);
  const role = Object.entries(p.otherRoles ?? {}).find(([, a]) => a === d)?.[0];
  if (role) issues.push(`escrow destination ${d} is the ${role} key, not the builder`);
  if (p.spvSigners && !p.spvSigners.includes(d)) issues.push(`escrow destination ${d} is not on the SPV's signer list (the project's builder is one of its signers)`);
  if (p.exists === false) issues.push(`escrow destination ${d} is not an account on the ledger (EscrowCreate would fail tecNO_DST after the LoanSet)`);
  return issues;
}

/** Why `amount` is not a positive RLUSD amount with ≤ 6 decimals, or undefined. */
function amountProblem(amount: unknown): string | undefined {
  try {
    if (typeof amount !== "string" || toMicro(amount) <= 0n) return `amount must be > 0, got ${amount}`;
  } catch (e) {
    return (e as Error).message;
  }
  return undefined;
}

/**
 * Validate everything and compute the escrows to create, or throw CloseValidationError. Checks:
 * PaymentTotal ≥ 2 (int), PaymentInterval ≥ 60s (int), 0 < InterestRate ≤ 100%, loan fits before RedemptionDate,
 * one well-formed PREIMAGE-SHA-256 condition per milestone (no extras), no duplicate within the call or with the SPV's
 * open escrows, amounts > 0, now + MIN_ESCROW_LIFETIME_S < CancelAfter < maturity, escrowMode fits the count.
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
  const escrowMode = escrowModeFor(ms.length, p.escrowMode, issues);

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
    const badAmount = amountProblem(m.amount);
    if (badAmount) issues.push(`${label}: ${badAmount}`);

    const raw = conds[index];
    const condition = typeof raw === "string" ? normalizeCondition(raw) : "";
    const badCondition = conditionProblem(raw);
    if (badCondition) issues.push(`${label}: ${badCondition}`);
    else if (seen.has(condition)) issues.push(`${label}: duplicate condition (same as milestone ${seen.get(condition)})`);
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
    escrows.push({ milestoneId: m.id, index, amount: m.amount, condition, cancelAfter });
  });

  if (issues.length) throw new CloseValidationError(issues);
  return { paymentTotal, paymentIntervalS, interestRate, maturity, escrows, escrowMode };
}

/**
 * Normalize any accepted conditions shape to an array aligned with `milestones`; extras/misalignment → issues.
 * Exported for resumeEscrowCreation (same shapes as closeLoanAndCreateEscrows' `conditions`).
 */
export function conditionsByIndex(milestones: { id: string }[], c: CloseConditions, issues: string[]): (string | undefined)[] {
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

// ---------------------------------------------------------------- format gate before signing (XRPL-13b)

/** One escrow about to be signed: what the SPV's EscrowCreate carries. CancelAfter in Ripple seconds. */
export interface EscrowSpec {
  milestoneId: string;
  amount: string;
  condition: string;
  cancelAfter: number;
}

export interface EscrowSpecChecks {
  /** Allowed number of escrows (e.g. 2..8 for one Batch). */
  min?: number;
  max?: number;
  /** Ledger now (Ripple s): when given, CancelAfter must also be > now + minLifetimeS. */
  now?: number;
  minLifetimeS?: number;
  /** Message prefix of the CloseValidationError. Default "escrows". */
  what?: string;
}

/**
 * Pure format gate for escrows right before they are signed. createEscrowsAtomic / closeLoanAtomic run it before ANY
 * submit (closeLoanAtomic before its LoanSet), so a malformed condition can never reach the ledger, Batch or not:
 * count in [min, max], unique milestone ids, amount > 0 with ≤ 6 decimals, 32-byte PREIMAGE-SHA-256 condition unique
 * within the set (case-insensitive), CancelAfter a positive integer (and > now + minLifetimeS when `now` is given).
 * Returns copies with conditions normalized (uppercase). Throws CloseValidationError listing every issue.
 */
export function validateEscrowSpecs<T extends EscrowSpec>(specs: T[], o: EscrowSpecChecks = {}): T[] {
  const issues: string[] = [];
  const n = specs.length;
  if ((o.min != null && n < o.min) || (o.max != null && n > o.max)) issues.push(`needs ${o.min ?? 0}..${o.max ?? "any"} escrows, got ${n}`);
  const ids = new Set<string>();
  const seen = new Map<string, string>();
  const minLifetime = o.minLifetimeS ?? MIN_ESCROW_LIFETIME_S;
  const out = specs.map((s, i) => {
    const label = `escrow ${s.milestoneId || "?"} (#${i})`;
    if (!s.milestoneId) issues.push(`${label}: milestoneId missing`);
    else if (ids.has(s.milestoneId)) issues.push(`${label}: duplicate milestoneId`);
    ids.add(s.milestoneId);
    const badAmount = amountProblem(s.amount);
    if (badAmount) issues.push(`${label}: ${badAmount}`);
    const badCondition = conditionProblem(s.condition);
    const condition = typeof s.condition === "string" ? normalizeCondition(s.condition) : "";
    if (badCondition) issues.push(`${label}: ${badCondition}`);
    else if (seen.has(condition)) issues.push(`${label}: duplicate condition (same as ${seen.get(condition)})`);
    if (condition) seen.set(condition, s.milestoneId);
    if (!Number.isInteger(s.cancelAfter) || s.cancelAfter <= 0) {
      issues.push(`${label}: CancelAfter must be Ripple-epoch seconds (a positive integer), got ${s.cancelAfter}`);
    } else if (o.now != null && s.cancelAfter <= o.now + minLifetime) {
      issues.push(`${label}: CancelAfter ${iso(s.cancelAfter)} must be more than ${minLifetime}s after ledger now ${iso(o.now)}`);
    }
    return { ...s, condition };
  });
  if (issues.length) throw new CloseValidationError(issues, o.what ?? "escrows");
  return out;
}

// ---------------------------------------------------------------- partial close

/** One escrow created before the failure (enough to finish/cancel it). */
export interface CreatedEscrowRef {
  milestoneId: string;
  owner: string;
  offerSequence: number;
  condition: string;
  cancelAfter: string; // ISO
  createTx: string;
}

/** What a failed close knew, so resumeEscrowCreation(err) can finish it without the original call's arguments. */
export interface ClosePartialContext {
  projectId?: string;
  spv: string;
  /** Escrow destination. */
  builder: string;
  issuer?: string;
  /** How the failed attempt created escrows. */
  escrowMode: EscrowMode;
  /** Every planned escrow, project order (normalized condition, CancelAfter in Ripple s). */
  planned: PlannedEscrow[];
  /** Lower bound of loan maturity used by the plan (Ripple s). */
  maturity?: number;
  originationFee?: string;
  /** The escrow Batch, when one was signed: its hash, LastLedgerSequence and what its inner txs showed. */
  batch?: { hash?: string; lastLedgerSequence?: number; ledgerIndex?: number; outcome: BatchOutcome };
  /**
   * The failed submit's outcome is unknown (connection lost, server history incomplete, unexpected error): one of
   * this close's txs may still validate, until `inFlightUntilLedger` when known. resumeEscrowCreation waits that out
   * (or one LastLedgerSequence margin) before it re-checks the ledger.
   */
  uncertain?: boolean;
  inFlightUntilLedger?: number;
}

/**
 * LoanSet succeeded but an EscrowCreate failed: the loan exists and the SPV holds the not-yet-escrowed principal.
 * Carries what the caller needs to recover (create the `pending` escrows, or repay): loanId + the escrows that exist.
 * `resumeEscrowCreation(err)` creates exactly the missing ones (needs `context`, which the close path always sets).
 */
export class CloseLoanPartialError extends LedgerError {
  constructor(
    readonly loanId: string,
    readonly loanSetTx: string,
    readonly created: CreatedEscrowRef[],
    /** Milestone ids without an escrow, in project order (the failed one first). */
    readonly pending: string[],
    /** The EscrowCreate / Batch error (usually an XrplTxError or BatchNotAppliedError). */
    readonly failure: unknown,
    /** XRPL-13b: the plan + escrow mode + Batch state, for resumeEscrowCreation. */
    readonly context?: ClosePartialContext,
  ) {
    const why = failure instanceof Error ? failure.message : String(failure);
    const r = failure as { engineResult?: string; hash?: string };
    const subject =
      context?.escrowMode === "batch" && created.length === 0 && pending.length > 1
        ? `the EscrowCreate Batch for milestones [${pending.join(", ")}] did not apply`
        : pending.length
          ? `EscrowCreate for milestone ${pending[0]} failed`
          : "a step after the last EscrowCreate failed";
    super(
      "ledger_error",
      `LoanSet ${loanSetTx} succeeded (loan ${loanId}) but ${subject}: ${why}. ` +
        `Created: [${created.map((e) => `${e.milestoneId}@${e.offerSequence}`).join(", ") || "none"}]; pending: [${pending.join(", ")}]` +
        (context ? ". Recover with resumeEscrowCreation(err)" : ""),
      { ...(r?.engineResult ? { txResult: r.engineResult } : {}), ...(r?.hash ? { txHash: r.hash } : {}) },
    );
    this.name = "CloseLoanPartialError";
  }
}

// ---------------------------------------------------------------- resume (XRPL-13b): ledger parsers + planner

/** An escrow the SPV owns or owned, as read from the ledger. */
export interface LedgerEscrow {
  offerSequence: number;
  /** Uppercase hex. */
  condition: string;
  destination: string;
  /** Decimal value (IOU) or `"<drops> drops"` (XRP). */
  amount: string;
  /** Ripple seconds. */
  cancelAfter?: number;
  /** The EscrowCreate (or Batch inner EscrowCreate) hash. */
  createTx?: string;
  /** true: still on the ledger (account_objects); false: created earlier, since finished or cancelled (account_tx). */
  open: boolean;
}

type Json = Record<string, unknown>;
const amountText = (a: unknown): string => (typeof a === "string" ? `${a} drops` : String((a as { value?: unknown } | null)?.value ?? ""));

/** Pure: raw Escrow nodes from `account_objects` (or escrow.ts `listEscrows`) → the open escrows `spv` owns. */
export function ledgerEscrowsFromNodes(nodes: unknown[], spv: string): LedgerEscrow[] {
  const out: LedgerEscrow[] = [];
  for (const raw of nodes) {
    const n = raw as Json;
    if (n.Account !== spv || typeof n.Condition !== "string" || typeof n.Sequence !== "number") continue;
    out.push({
      offerSequence: n.Sequence,
      condition: normalizeCondition(n.Condition),
      destination: String(n.Destination),
      amount: amountText(n.Amount),
      ...(typeof n.CancelAfter === "number" ? { cancelAfter: n.CancelAfter } : {}),
      ...(typeof n.PreviousTxnID === "string" ? { createTx: n.PreviousTxnID } : {}),
      open: true,
    });
  }
  return out;
}

/** One `account_tx` entry, normalized across API v1 (`tx`) / v2 (`tx_json`). */
export interface HistoryTx {
  hash: string;
  tx: Json;
  meta: Json;
  ledgerIndex?: number;
  /** ISO close time of the tx's ledger, when rippled returned it. */
  closeTime?: string;
}

/** Pure: normalize raw `account_tx` entries (validated only). */
export function historyTxs(entries: unknown[]): HistoryTx[] {
  const out: HistoryTx[] = [];
  for (const raw of entries) {
    const e = raw as Json;
    const tx = (e.tx_json ?? e.tx) as Json | undefined;
    const meta = e.meta as Json | undefined;
    const hash = (e.hash ?? tx?.hash) as string | undefined;
    if (!tx || !meta || typeof meta !== "object" || !hash || e.validated === false) continue;
    const ledgerIndex = Number(e.ledger_index ?? tx.ledger_index);
    const closeTime = typeof e.close_time_iso === "string" ? e.close_time_iso : typeof tx.date === "number" ? iso(tx.date) : undefined;
    out.push({ hash, tx, meta, ...(Number.isFinite(ledgerIndex) ? { ledgerIndex } : {}), ...(closeTime ? { closeTime } : {}) });
  }
  return out;
}

/**
 * Pure: every successful EscrowCreate from `spv` in its history (standalone or Batch inner; rolled-back inners never
 * appear), as `open: false` entries. The created Escrow node in the metadata wins over the tx fields.
 */
export function escrowCreatesFromHistory(entries: unknown[], spv: string): LedgerEscrow[] {
  const out: LedgerEscrow[] = [];
  for (const h of historyTxs(entries)) {
    if (h.tx.TransactionType !== "EscrowCreate" || h.tx.Account !== spv || h.meta.TransactionResult !== "tesSUCCESS") continue;
    const node = createdNodeFields(h.meta, "Escrow");
    const f = { ...h.tx, ...(node ?? {}) };
    const seq = typeof f.Sequence === "number" && f.Sequence > 0 ? f.Sequence : (f.TicketSequence as number | undefined);
    if (typeof f.Condition !== "string" || typeof seq !== "number") continue;
    out.push({
      offerSequence: seq,
      condition: normalizeCondition(f.Condition),
      destination: String(f.Destination),
      amount: amountText(f.Amount),
      ...(typeof f.CancelAfter === "number" ? { cancelAfter: f.CancelAfter } : {}),
      createTx: h.hash,
      open: false,
    });
  }
  return out;
}

/** Pure: the LoanSet in a history whose metadata created the Loan `loanId`. */
export function loanSetFromHistory(entries: unknown[], loanId: string): HistoryTx | undefined {
  return historyTxs(entries).find(
    (h) => h.tx.TransactionType === "LoanSet" && h.meta.TransactionResult === "tesSUCCESS" && createdNodeIndex(h.meta, "Loan") === loanId,
  );
}

/** Pure: open escrows (account_objects) + the SPV's EscrowCreate history, one entry per escrow (open wins). */
export function mergeLedgerEscrows(open: LedgerEscrow[], history: LedgerEscrow[]): LedgerEscrow[] {
  const bySeq = new Map(open.map((e) => [e.offerSequence, e]));
  for (const h of history) {
    const o = bySeq.get(h.offerSequence);
    if (o) bySeq.set(h.offerSequence, { ...o, createTx: h.createTx ?? o.createTx });
    else bySeq.set(h.offerSequence, h);
  }
  return [...bySeq.values()];
}

function createdNode(meta: Json, type: string): { LedgerIndex?: string; NewFields?: Json } | undefined {
  const nodes = (meta.AffectedNodes ?? []) as { CreatedNode?: { LedgerEntryType?: string; LedgerIndex?: string; NewFields?: Json } }[];
  return nodes.find((n) => n.CreatedNode?.LedgerEntryType === type)?.CreatedNode;
}
const createdNodeFields = (meta: Json, type: string) => createdNode(meta, type)?.NewFields;
const createdNodeIndex = (meta: Json, type: string) => createdNode(meta, type)?.LedgerIndex;

/** Pure: real loan maturity (Ripple s) from a Loan entry: NextPaymentDueDate + interval × (remaining − 1). */
export function loanMaturity(loan: { NextPaymentDueDate?: number; PaymentInterval?: number; PaymentRemaining?: number }): number | undefined {
  const { NextPaymentDueDate: next, PaymentInterval: interval, PaymentRemaining: remaining } = loan;
  if (next == null || interval == null || !remaining) return undefined;
  return next + interval * (remaining - 1);
}

/** One milestone resumeEscrowCreation must account for. condition/cancelAfter may be absent for one in `created`. */
export interface ResumeMilestone {
  milestoneId: string;
  index: number;
  amount: string;
  condition?: string;
  /** Ripple seconds. */
  cancelAfter?: number;
}

export interface ResumePlanInput {
  spv: string;
  builder: string;
  /** Every milestone of the close, project order. */
  milestones: ResumeMilestone[];
  /** Escrows the failed close reported as created (trusted: they were validated tesSUCCESS). */
  created: CreatedEscrowRef[];
  /** The SPV's open escrows + its EscrowCreate history (mergeLedgerEscrows). */
  ledgerEscrows: LedgerEscrow[];
  /** Ledger now (Ripple s). */
  now: number;
  /** Real loan maturity (Ripple s, loanMaturity); every new CancelAfter must be before it. */
  maturity?: number;
  minEscrowLifetimeS?: number;
}

export interface ResumeEscrowRef extends CreatedEscrowRef {
  amount: string;
  /** How we know it exists: the failed close's `created`, an open SPV escrow, or one already finished/cancelled. */
  source: "created" | "open" | "consumed";
}

export interface ResumePlan {
  /** Milestones whose escrow exists or existed: never re-created. Project order. */
  present: ResumeEscrowRef[];
  /** Escrows to create now, project order. */
  toCreate: PlannedEscrow[];
}

const sameAmount = (a: string, b: string): boolean => {
  try {
    return toPlainDecimal(a) === toPlainDecimal(b);
  } catch {
    return false;
  }
};

/**
 * Pure planner behind resumeEscrowCreation. A milestone is **present** (never re-created) when the failed close
 * reported it, or when the SPV has, or had, an escrow with its condition: open (account_objects), or already
 * finished / cancelled (EscrowCreate in the SPV's history: re-creating it with a possibly published fulfillment could
 * pay twice). Such an escrow must go to `builder` for the milestone's amount, else it is an issue. Everything else is
 * **toCreate** and must pass the close's checks: well-formed condition unique across the project,
 * amount > 0, now + MIN_ESCROW_LIFETIME_S < CancelAfter < maturity. Throws CloseValidationError listing every issue.
 */
export function planEscrowResume(p: ResumePlanInput): ResumePlan {
  const issues: string[] = [];
  const byCondition = new Map<string, LedgerEscrow>();
  for (const e of p.ledgerEscrows) {
    const c = normalizeCondition(e.condition);
    const cur = byCondition.get(c);
    if (!cur || (!cur.open && e.open)) byCondition.set(c, e);
  }
  const ids = new Set(p.milestones.map((m) => m.milestoneId));
  const claimed = new Map<string, CreatedEscrowRef>();
  for (const c of p.created) {
    if (!ids.has(c.milestoneId)) issues.push(`created: unknown milestone ${c.milestoneId}`);
    claimed.set(c.milestoneId, c);
  }
  const used = new Map<string, string>();
  const minCancel = p.now + (p.minEscrowLifetimeS ?? MIN_ESCROW_LIFETIME_S);
  const present: ResumeEscrowRef[] = [];
  const toCreate: PlannedEscrow[] = [];

  for (const m of p.milestones) {
    const label = `milestone ${m.milestoneId} (#${m.index})`;
    const claim = claimed.get(m.milestoneId);
    if (claim) {
      const c = normalizeCondition(claim.condition);
      if (used.has(c)) issues.push(`${label}: duplicate condition (same as milestone ${used.get(c)})`);
      used.set(c, m.milestoneId);
      present.push({ ...claim, condition: c, amount: m.amount, source: "created" });
      continue;
    }
    const badCondition = conditionProblem(m.condition);
    if (badCondition) {
      issues.push(`${label}: ${badCondition}`);
      continue;
    }
    const condition = normalizeCondition(m.condition!);
    if (used.has(condition)) {
      issues.push(`${label}: duplicate condition (same as milestone ${used.get(condition)})`);
      continue;
    }
    used.set(condition, m.milestoneId);

    const found = byCondition.get(condition);
    if (found) {
      const where = `escrow ${p.spv}/${found.offerSequence}${found.open ? "" : " (already finished or cancelled)"}`;
      if (found.destination !== p.builder) issues.push(`${label}: its condition is on ${where} to ${found.destination}, not the builder ${p.builder}`);
      else if (!sameAmount(found.amount, m.amount)) issues.push(`${label}: its condition is on ${where} for ${found.amount}, not ${m.amount}`);
      else {
        const cancelAfter = found.cancelAfter ?? m.cancelAfter;
        present.push({
          milestoneId: m.milestoneId,
          owner: p.spv,
          offerSequence: found.offerSequence,
          condition,
          cancelAfter: cancelAfter != null ? iso(cancelAfter) : "",
          createTx: found.createTx ?? "",
          amount: m.amount,
          source: found.open ? "open" : "consumed",
        });
      }
      continue;
    }

    const badAmount = amountProblem(m.amount);
    if (badAmount) issues.push(`${label}: ${badAmount}`);
    if (m.cancelAfter == null || !Number.isInteger(m.cancelAfter)) issues.push(`${label}: missing CancelAfter`);
    else {
      if (m.cancelAfter <= minCancel) issues.push(`${label}: CancelAfter ${iso(m.cancelAfter)} must be more than ${minCancel - p.now}s after ledger now ${iso(p.now)}`);
      if (p.maturity != null && m.cancelAfter >= p.maturity) issues.push(`${label}: CancelAfter ${iso(m.cancelAfter)} must be before loan maturity ${iso(p.maturity)}`);
    }
    toCreate.push({ milestoneId: m.milestoneId, index: m.index, amount: m.amount, condition, cancelAfter: m.cancelAfter ?? 0 });
  }

  if (issues.length) throw new CloseValidationError(issues, "resumeEscrowCreation");
  return { present, toCreate };
}
