// XRPL-10 pure helpers for XrplLedgerAdapter (src/adapter.ts): package results -> shared LedgerPort shapes, error
// mapping, SPV signer choice, close-input validation, repay mode. No network: unit-tested offline (test/adapter.test.ts).
import { LedgerError, TooSoonError, type ChainEventKind, type ErrorCode, type EscrowSnapshot, type TxResult as PortTxResult } from "@xrlp/shared";
import { isoTimeToRippleTime, rippleTimeToISOTime } from "xrpl";
import type { TxResult } from "./client.ts";
import { XrplTxError } from "./errors.ts";
import { UnsafeReleaseError } from "./preflight.ts";
import type { EscrowView } from "./reads.ts";

// ---------------------------------------------------------------- tx results

/** Our validated TxResult -> shared TxResult (+ suggested ChainEvent kind, + ledger close time when rippled sent it). */
export function toPortTx(tx: TxResult, kind?: ChainEventKind): PortTxResult {
  const date = tx.tx?.date;
  return {
    hash: tx.hash,
    explorerUrl: tx.explorerUrl,
    result: tx.result,
    ...(kind ? { kind } : {}),
    ...(typeof date === "number" ? { at: rippleTimeToISOTime(date) } : {}),
  };
}

/** A tec* failure that is on-ledger, as a shared TxResult (for calls documented to resolve with the tec result). */
export function tecToPortTx(e: XrplTxError, kind?: ChainEventKind): PortTxResult | undefined {
  if (!e.onLedger || !e.hash) return undefined;
  return { hash: e.hash, explorerUrl: e.explorerUrl!, result: e.engineResult, ...(kind ? { kind } : {}) };
}

// ---------------------------------------------------------------- errors

/**
 * Shared `LedgerError` whose `apiCode` is the full API ErrorCode (docs/05-api.md §1). `code` stays inside the shared
 * contract's union (`too_soon | ledger_error | unsafe_release`); `not_found` / `validation` ride on `apiCode` only.
 * TODO(#53): widen shared LedgerError.code to include not_found / validation, then drop `apiCode`.
 */
export class XrplLedgerError extends LedgerError {
  readonly apiCode: ErrorCode;
  /** PreflightReason for unsafe_release, rippled engine result otherwise. */
  readonly reason?: string;
  constructor(apiCode: ErrorCode, message: string, opts: { txResult?: string; txHash?: string; reason?: string; cause?: unknown } = {}) {
    super(apiCode === "too_soon" || apiCode === "unsafe_release" ? apiCode : "ledger_error", message, opts);
    this.name = "XrplLedgerError";
    this.apiCode = apiCode;
    if (opts.reason) this.reason = opts.reason;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

/** API ErrorCode of anything the adapter may throw (shared LedgerError, XrplLedgerError, or a raw package error). */
export function apiCodeOf(e: unknown): ErrorCode {
  if (e instanceof XrplLedgerError) return e.apiCode;
  if (e instanceof LedgerError) return e.code;
  return apiCodeOf(toLedgerError(e));
}

const NOT_FOUND_RESULTS = new Set(["tecNO_ENTRY", "tecNO_TARGET", "tecNO_DST", "tecOBJECT_NOT_FOUND"]);
const NOT_FOUND_RPC = new Set(["entryNotFound", "actNotFound", "txnNotFound", "objectNotFound"]);
/** Plain `Error`s this package throws for bad input before any tx (lending-math, api.ts, compliance.ts, attest.ts). */
const VALIDATION_MESSAGE =
  /must be|must fit|missing condition|missing spv|not in the future|protocol minimum|too early for|duplicate|invalid|malformed|no demo wallet|does not match escrow condition|not a PREIMAGE|attest memo|expected .* got/i;

/**
 * Map any error from this package to a shared LedgerError (TooSoonError for tecTOO_SOON). Shared LedgerErrors pass through
 * unchanged. txHash/txResult preserved. Never loses the original: it is the `cause`.
 */
export function toLedgerError(e: unknown, context?: string): LedgerError {
  if (e instanceof LedgerError) return e;
  const where = context ? `${context}: ` : "";
  if (e instanceof UnsafeReleaseError) {
    return new XrplLedgerError("unsafe_release", `${where}${e.message}`, { reason: e.reason, cause: e });
  }
  if (e instanceof XrplTxError) {
    const r = e.engineResult;
    const opts = { txResult: r, ...(e.hash ? { txHash: e.hash } : {}), cause: e };
    if (r === "tecTOO_SOON") return new TooSoonError(`${where}${e.message}`, opts);
    if (NOT_FOUND_RESULTS.has(r)) return new XrplLedgerError("not_found", `${where}${e.message}`, opts);
    if (r.startsWith("tem")) return new XrplLedgerError("validation", `${where}${e.message}`, opts);
    return new XrplLedgerError("ledger_error", `${where}${e.message}`, opts);
  }
  const rpc = (e as { data?: { error?: string } })?.data?.error;
  const msg = e instanceof Error ? e.message : String(e);
  if (rpc && NOT_FOUND_RPC.has(rpc)) return new XrplLedgerError("not_found", `${where}${msg}`, { txResult: rpc, cause: e });
  if (rpc) return new XrplLedgerError("ledger_error", `${where}${msg}`, { txResult: rpc, cause: e });
  if (VALIDATION_MESSAGE.test(msg)) return new XrplLedgerError("validation", `${where}${msg}`, { cause: e });
  return new XrplLedgerError("ledger_error", `${where}${msg}`, { cause: e });
}

// ---------------------------------------------------------------- SPV signers

/**
 * Pick SPV multisig signers we hold keys for, reaching `quorum` from the ON-LEDGER signer list. `prefer` first (e.g. the
 * project's builder, platform, trustee), then the rest in list order. Throws if the keys we hold cannot reach quorum.
 */
export function pickQuorumSigners<W extends { classicAddress: string }>(
  list: { quorum: number; signers: { account: string; weight: number }[] },
  held: (address: string) => W | undefined,
  prefer: string[] = [],
): W[] {
  const rank = (a: string) => {
    const i = prefer.indexOf(a);
    return i < 0 ? prefer.length : i;
  };
  const ordered = [...list.signers].map((s, i) => ({ ...s, i })).sort((a, b) => rank(a.account) - rank(b.account) || a.i - b.i);
  const out: W[] = [];
  let weight = 0;
  for (const s of ordered) {
    if (weight >= list.quorum) break;
    const w = held(s.account);
    if (!w) continue;
    out.push(w);
    weight += s.weight;
  }
  if (weight < list.quorum) {
    throw new XrplLedgerError(
      "validation",
      `SPV quorum ${list.quorum} not reachable with held keys (have weight ${weight} from ${out.map((w) => w.classicAddress).join(", ") || "none"}; list ${list.signers.map((s) => s.account).join(", ")})`,
    );
  }
  return out;
}

// ---------------------------------------------------------------- close inputs

export interface CloseInputCheck {
  milestoneCount: number;
  conditions: string[];
  cancelAfters: string[];
  /** Ripple-epoch seconds of the validated ledger. */
  nowRipple: number;
  /**
   * Earliest possible loan maturity (Ripple s) = max(now, SubscriptionDate) + PaymentTotal x PaymentInterval. LoanSet lands
   * after both, so CancelAfter < this is always < the real maturity.
   */
  maturityFloorRipple: number;
}

const CONDITION_RE = /^A0258020[0-9A-F]{64}810120$/i;

/**
 * Validate closeLoanAndCreateEscrows inputs before any tx: one condition + CancelAfter per milestone, PREIMAGE-SHA-256
 * (32-byte preimage) conditions, no duplicates, every CancelAfter in the future and before loan maturity.
 * Returns CancelAfters as Ripple seconds. Throws XrplLedgerError("validation").
 */
export function validateCloseInputs(p: CloseInputCheck): number[] {
  const bad = (m: string) => new XrplLedgerError("validation", `closeLoanAndCreateEscrows: ${m}`);
  if (p.milestoneCount === 0) throw bad("project has no milestones");
  if (p.conditions.length !== p.milestoneCount) throw bad(`${p.conditions.length} conditions for ${p.milestoneCount} milestones`);
  if (p.cancelAfters.length !== p.milestoneCount) throw bad(`${p.cancelAfters.length} cancelAfters for ${p.milestoneCount} milestones`);
  const seen = new Set<string>();
  p.conditions.forEach((c, i) => {
    if (!CONDITION_RE.test(c)) throw bad(`conditions[${i}] is not a PREIMAGE-SHA-256 condition (32-byte preimage)`);
    const k = c.toUpperCase();
    if (seen.has(k)) throw bad(`conditions[${i}] duplicates an earlier condition (every escrow needs its own preimage)`);
    seen.add(k);
  });
  return p.cancelAfters.map((iso, i) => {
    if (!Number.isFinite(Date.parse(iso))) throw bad(`cancelAfters[${i}] is not an ISO date: ${iso}`);
    const r = isoTimeToRippleTime(iso);
    if (r <= p.nowRipple) throw bad(`cancelAfters[${i}] ${iso} is not after ledger now ${rippleTimeToISOTime(p.nowRipple)}`);
    if (r >= p.maturityFloorRipple) throw bad(`cancelAfters[${i}] ${iso} is not before loan maturity (>= ${rippleTimeToISOTime(p.maturityFloorRipple)})`);
    return r;
  });
}

// ---------------------------------------------------------------- repay

/**
 * LoanPay mode for a repayment of `amount`: more than one periodic payment (+ service fee) -> "overpayment" (extra goes
 * to principal; loan has tfLoanOverpayment); otherwise "late" past NextPaymentDueDate, else "regular".
 */
export function repayMode(p: { amount: string; periodicPayment: string; serviceFee?: string; nextPaymentDueRipple?: number; nowRipple: number }): "regular" | "overpayment" | "late" {
  const periodic = Number(p.periodicPayment) + Number(p.serviceFee ?? "0");
  if (Number(p.amount) > periodic + 1e-6) return "overpayment";
  if (p.nextPaymentDueRipple != null && p.nowRipple > p.nextPaymentDueRipple) return "late";
  return "regular";
}

// ---------------------------------------------------------------- reads

/** reads.ts EscrowView -> shared EscrowSnapshot. */
export function toEscrowSnapshot(v: EscrowView, offerSequence: number): EscrowSnapshot {
  return {
    owner: v.owner,
    offerSequence: v.offerSequence ?? offerSequence,
    destination: v.destination,
    amount: v.amount,
    ...(v.condition ? { condition: v.condition } : {}),
    ...(v.cancelAfter ? { cancelAfter: v.cancelAfter } : {}),
  };
}
