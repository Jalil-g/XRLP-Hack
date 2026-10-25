// XRPL-14 · Pre-reveal safety. An EscrowFinish carrying the right fulfillment that FAILS on-ledger
// (tecNO_LINE, tecNO_PERMISSION after CancelAfter, ...) still publishes the preimage while the escrow
// stays open. So before any finish we read the VALIDATED ledger and refuse unless the finish is
// expected to succeed. Preflight never submits anything.
//
// Split: `evaluatePreflight(snapshot, now)` is pure (unit-tested offline); `fetchPreflightSnapshot`
// is the thin network layer; `preflightFinish` = fetch + evaluate.
import { LedgerError, type ErrorCode } from "@xrlp/shared";
import { getClient, isNotFound } from "./client.ts";
import { fulfillmentMatches } from "./condition.ts";
import { fetchAccountLines, fetchAccountRoot, fetchEscrowNode, fetchLedgerNow, findTrustLine } from "./reads.ts";

/** Shared `ErrorCode` for "pre-reveal safety refused to submit a finish". */
export const UNSAFE_RELEASE = "unsafe_release" as const satisfies ErrorCode;

export type PreflightReason =
  | "escrow_not_found" // already finished / cancelled, or wrong owner+seq
  | "destination_mismatch" // escrow pays someone other than the expected destination
  | "condition_mismatch" // caller's condition/fulfillment does not match the ON-LEDGER condition
  | "finish_too_early" // FinishAfter not yet passed
  | "expired_or_too_close" // CancelAfter passed, or inside the safety margin
  | "unsupported_amount" // MPT escrow: not handled
  | "destination_not_found"
  | "deposit_auth" // destination has lsfDepositAuth and the submitter is not preauthorized
  | "no_trustline"
  | "trustline_limit" // limit - balance < amount
  | "not_authorized" // issuer RequireAuth and the line is not authorized
  | "frozen" // issuer global freeze, or the line is (deep) frozen
  | "submitter_not_found"
  | "submitter_unfunded"; // submitter cannot pay the fee

export interface PreflightFailure {
  reason: PreflightReason;
  message: string;
}

/** Ledger "now": the latest validated ledger, never the local clock. */
export interface LedgerNow {
  ledgerIndex: number;
  /** Ripple-epoch seconds (close_time of the validated ledger). */
  closeTime: number;
}

export type EscrowAmount = string | { currency: string; issuer: string; value: string } | { mpt_issuance_id: string; value: string };

/** Raw on-ledger Escrow fields preflight judges (not the shared `EscrowSnapshot`, see reads.ts `getEscrowSnapshot`). */
export interface PreflightEscrow {
  Account: string;
  Destination: string;
  Amount: EscrowAmount;
  Condition?: string;
  CancelAfter?: number;
  FinishAfter?: number;
}

/** @deprecated Renamed to `PreflightEscrow` (avoids clashing with the shared `EscrowSnapshot`). */
export type EscrowSnapshot = PreflightEscrow;

export interface AccountSnapshot {
  address: string;
  /** Balance in drops. */
  balance: string;
  flags: number;
}

/** Destination's side of the RLUSD line (account_lines from the destination, peer = issuer). */
export interface TrustlineSnapshot {
  balance: string;
  limit: string;
  freeze?: boolean;
  freeze_peer?: boolean;
  deep_freeze?: boolean;
  deep_freeze_peer?: boolean;
  peer_authorized?: boolean;
}

export interface PreflightRequest {
  owner: string;
  offerSequence: number;
  /** Expected destination (e.g. the builder). Checked against the escrow's on-ledger Destination. */
  destination?: string;
  /** Condition the caller intends to put in EscrowFinish. Must equal the on-ledger one. */
  condition?: string;
  /** Fulfillment the caller intends to reveal. Checked against the ON-LEDGER condition. */
  fulfillment?: string;
  /** Account that will submit (and pay for) the EscrowFinish. */
  submitter?: string | { classicAddress: string };
  /** Minimum seconds between ledger now and CancelAfter. Default 120. */
  marginS?: number;
  /** LastLedgerSequence = validated index + this. Default 20. */
  lastLedgerOffset?: number;
}

/** Everything evaluatePreflight needs. `null` = fetched and absent; `undefined` = not applicable. */
export interface PreflightSnapshot {
  request: PreflightRequest;
  escrow: PreflightEscrow | null;
  destinationAccount?: AccountSnapshot | null;
  trustline?: TrustlineSnapshot | null;
  issuerAccount?: AccountSnapshot | null;
  submitterAccount?: AccountSnapshot | null;
  /** deposit_authorized(submitter -> destination), only fetched when the destination has lsfDepositAuth. */
  submitterPreauthorized?: boolean;
  /** Load-scaled base fee in drops (`fee` command). */
  baseFeeDrops: number;
}

export interface PreflightDetails {
  ledgerIndex: number;
  ledgerCloseTime: number;
  owner: string;
  offerSequence: number;
  escrow?: PreflightEscrow;
  /** CancelAfter - ledger now (negative = expired). */
  secondsToCancelAfter?: number;
  /** max(marginS, lastLedgerOffset × MAX_CLOSE_INTERVAL_S). */
  effectiveMarginS: number;
  /** True only when a fulfillment was given and checked against the on-ledger condition. */
  conditionChecked: boolean;
  trustline?: TrustlineSnapshot | null;
  /** Use these in the EscrowFinish (drops, string). */
  recommendedFee: string;
  lastLedgerSequence: number;
}

export interface PreflightResult {
  ok: boolean;
  /** First (most fundamental) failure. */
  reason?: PreflightReason;
  message?: string;
  code?: typeof UNSAFE_RELEASE;
  failures: PreflightFailure[];
  details: PreflightDetails;
}

export const DEFAULT_MARGIN_S = 120;
export const DEFAULT_LAST_LEDGER_OFFSET = 20;
/** Devnet closes every ~3-4s; budget 5s per ledger so a tx that sits until LLS still lands before CancelAfter. */
export const MAX_CLOSE_INTERVAL_S = 5;
/** Standard fulfillment for a 32-byte preimage (A0228020‖P) is 36 bytes. */
const DEFAULT_FULFILLMENT_BYTES = 36;

const LSF_REQUIRE_AUTH = 0x00040000;
const LSF_GLOBAL_FREEZE = 0x00400000;
const LSF_DEPOSIT_AUTH = 0x01000000;

const addressOf = (s: PreflightRequest["submitter"]): string | undefined => (typeof s === "string" ? s : s?.classicAddress);

/** EscrowFinish cost: base × (33 + ⌈fulfillment bytes / 16⌉); plain base fee without a fulfillment. */
export function escrowFinishFee(baseFeeDrops: number, fulfillmentBytes?: number): number {
  if (!fulfillmentBytes) return baseFeeDrops;
  return baseFeeDrops * (33 + Math.ceil(fulfillmentBytes / 16));
}

// --- exact decimal compare for IOU values (no float rounding on limits/balances) -------------------
interface Dec {
  m: bigint;
  e: number;
}
function parseDec(s: string): Dec {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s.trim());
  if (!match || (match[2] === "" && !match[3])) throw new Error(`not a decimal: ${s}`);
  const [, sign, int = "", frac = "", exp = "0"] = match;
  return { m: BigInt(`${sign === "-" ? "-" : ""}${int + frac || "0"}`), e: Number(exp) - frac.length };
}
function scaled(d: Dec, e: number): bigint {
  return d.m * 10n ** BigInt(d.e - e);
}
/** limit − balance ≥ amount, exactly. */
export function hasHeadroom(limit: string, balance: string, amount: string): boolean {
  const [l, b, a] = [parseDec(limit), parseDec(balance), parseDec(amount)];
  const e = Math.min(l.e, b.e, a.e);
  return scaled(l, e) - scaled(b, e) >= scaled(a, e);
}

/** Pure decision. `now` must come from the validated ledger. */
export function evaluatePreflight(snap: PreflightSnapshot, now: LedgerNow): PreflightResult {
  const req = snap.request;
  const marginS = req.marginS ?? DEFAULT_MARGIN_S;
  const lastLedgerOffset = req.lastLedgerOffset ?? DEFAULT_LAST_LEDGER_OFFSET;
  const effectiveMarginS = Math.max(marginS, lastLedgerOffset * MAX_CLOSE_INTERVAL_S);
  const submitter = addressOf(req.submitter);
  const failures: PreflightFailure[] = [];
  const fail = (reason: PreflightReason, message: string) => failures.push({ reason, message });

  const esc = snap.escrow;
  const fulfillmentBytes = req.fulfillment ? req.fulfillment.length / 2 : esc?.Condition ? DEFAULT_FULFILLMENT_BYTES : undefined;
  const fee = escrowFinishFee(snap.baseFeeDrops, fulfillmentBytes);
  const details: PreflightDetails = {
    ledgerIndex: now.ledgerIndex,
    ledgerCloseTime: now.closeTime,
    owner: req.owner,
    offerSequence: req.offerSequence,
    effectiveMarginS,
    conditionChecked: false,
    recommendedFee: String(fee),
    lastLedgerSequence: now.ledgerIndex + lastLedgerOffset,
  };

  if (!esc) {
    fail("escrow_not_found", `no escrow ${req.owner}#${req.offerSequence} in validated ledger ${now.ledgerIndex} (already finished or cancelled?)`);
  } else {
    details.escrow = esc;

    // 1. Destination is who the caller expects.
    if (req.destination && req.destination !== esc.Destination) {
      fail("destination_mismatch", `escrow pays ${esc.Destination}, expected ${req.destination}`);
    }

    // 2. Condition/fulfillment vs the ON-LEDGER condition (never trust the caller's copy).
    const onLedger = esc.Condition?.toUpperCase();
    if (!onLedger) {
      if (req.condition || req.fulfillment) fail("condition_mismatch", "escrow has no Condition; an EscrowFinish with a fulfillment would fail");
    } else {
      if (req.condition && req.condition.toUpperCase() !== onLedger) fail("condition_mismatch", "caller's condition differs from the on-ledger escrow Condition");
      if (req.fulfillment) {
        details.conditionChecked = true;
        if (!fulfillmentMatches(onLedger, req.fulfillment)) fail("condition_mismatch", "fulfillment does not match the on-ledger escrow Condition");
      }
    }

    // 3. Timing, from ledger close time.
    if (esc.FinishAfter !== undefined && !(now.closeTime > esc.FinishAfter)) {
      fail("finish_too_early", `FinishAfter ${esc.FinishAfter} not passed (ledger now ${now.closeTime}, ${esc.FinishAfter - now.closeTime + 1}s to go)`);
    }
    if (esc.CancelAfter !== undefined) {
      const left = esc.CancelAfter - now.closeTime;
      details.secondsToCancelAfter = left;
      if (left < effectiveMarginS) {
        fail("expired_or_too_close", left <= 0 ? `CancelAfter passed ${-left}s ago` : `only ${left}s to CancelAfter (< ${effectiveMarginS}s margin)`);
      }
    }

    // 4. Destination can receive.
    const dest = snap.destinationAccount;
    if (dest === null) {
      fail("destination_not_found", `destination ${esc.Destination} does not exist`);
    } else if (dest) {
      if (dest.flags & LSF_DEPOSIT_AUTH && submitter !== esc.Destination && !snap.submitterPreauthorized) {
        fail("deposit_auth", `destination has DepositAuth and ${submitter ?? "the submitter"} is not preauthorized`);
      }
    }
    const amt = esc.Amount;
    if (typeof amt === "object" && "mpt_issuance_id" in amt) {
      fail("unsupported_amount", "MPT escrows are not supported by preflight");
    } else if (typeof amt === "object" && dest !== null && amt.issuer !== esc.Destination) {
      const line = snap.trustline;
      details.trustline = line ?? null;
      const issuerFrozen = !!snap.issuerAccount && (snap.issuerAccount.flags & LSF_GLOBAL_FREEZE) !== 0;
      if (!line) {
        fail("no_trustline", `destination has no ${amt.currency} trust line to ${amt.issuer}`);
      } else {
        if (!hasHeadroom(line.limit, line.balance, amt.value)) {
          fail("trustline_limit", `trust line headroom ${line.limit} - ${line.balance} < ${amt.value}`);
        }
        if (snap.issuerAccount && snap.issuerAccount.flags & LSF_REQUIRE_AUTH && !line.peer_authorized) {
          fail("not_authorized", "issuer requires authorization and the destination's line is not authorized");
        }
      }
      if (issuerFrozen || line?.freeze || line?.freeze_peer || line?.deep_freeze || line?.deep_freeze_peer) {
        fail("frozen", issuerFrozen ? "issuer has a global freeze" : "destination's trust line is frozen");
      }
    }
  }

  // 5. Submitter can pay.
  if (submitter) {
    const s = snap.submitterAccount;
    if (s === null) fail("submitter_not_found", `submitter ${submitter} does not exist`);
    else if (s && BigInt(s.balance) < BigInt(fee)) fail("submitter_unfunded", `submitter balance ${s.balance} drops < fee ${fee}`);
  }

  const first = failures[0];
  return first
    ? { ok: false, reason: first.reason, message: first.message, code: UNSAFE_RELEASE, failures, details }
    : { ok: true, failures, details };
}

// --- refusal → ErrorCode ------------------------------------------------------------------------

/** Thrown when preflight refuses. A shared `LedgerError` with `code: "unsafe_release"`, so LedgerPort callers can catch it as is. */
export class UnsafeReleaseError extends LedgerError {
  declare readonly code: typeof UNSAFE_RELEASE;
  readonly reason: PreflightReason;
  constructor(readonly result: PreflightResult) {
    super(UNSAFE_RELEASE, `unsafe_release (${result.reason}): ${result.message}`);
    this.name = "UnsafeReleaseError";
    this.reason = result.reason!;
  }
}

/** HTTP error body for a refused preflight: `{ error: { code: "unsafe_release", message } }`. */
export function unsafeReleaseError(result: PreflightResult): { error: { code: typeof UNSAFE_RELEASE; message: string; reason?: PreflightReason } } {
  return { error: { code: UNSAFE_RELEASE, message: result.message ?? "pre-reveal safety refused the finish", ...(result.reason ? { reason: result.reason } : {}) } };
}

export function assertPreflightOk(result: PreflightResult): void {
  if (!result.ok) throw new UnsafeReleaseError(result);
}

// --- fetch layer ---------------------------------------------------------------------------------
// Ledger / escrow / account / trust-line reads come from reads.ts (XRPL-09), pinned to one validated ledger index.

async function orNull<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

async function accountAt(address: string, ledgerIndex: number): Promise<AccountSnapshot | null> {
  const a = await orNull(fetchAccountRoot(address, ledgerIndex));
  return a && { address, balance: a.Balance, flags: a.Flags };
}

/** Read every input from ONE validated ledger, so the decision is consistent. Submits nothing. */
export async function fetchPreflightSnapshot(req: PreflightRequest): Promise<{ snapshot: PreflightSnapshot; now: LedgerNow }> {
  const client = await getClient();
  const now: LedgerNow = await fetchLedgerNow();
  const at = now.ledgerIndex;
  const submitter = addressOf(req.submitter);

  const [escrow, feeRes, submitterAccount] = await Promise.all([
    orNull<PreflightEscrow | null>(fetchEscrowNode(req.owner, req.offerSequence, at)),
    client.request({ command: "fee" }),
    submitter ? accountAt(submitter, at) : Promise.resolve(undefined),
  ]);
  const d = feeRes.result.drops;
  const baseFeeDrops = Math.max(Number(d.base_fee), Number(d.open_ledger_fee));
  const snapshot: PreflightSnapshot = { request: req, escrow, baseFeeDrops, ...(submitterAccount !== undefined ? { submitterAccount } : {}) };
  if (!escrow) return { snapshot, now };

  const dest = escrow.Destination;
  const amt = escrow.Amount;
  const iou = typeof amt === "object" && "issuer" in amt ? amt : undefined;
  const [destinationAccount, issuerAccount, lines] = await Promise.all([
    accountAt(dest, at),
    iou ? accountAt(iou.issuer, at) : Promise.resolve(undefined),
    iou ? orNull(fetchAccountLines(dest, iou.issuer, at)) : Promise.resolve(undefined),
  ]);
  snapshot.destinationAccount = destinationAccount;
  if (issuerAccount !== undefined) snapshot.issuerAccount = issuerAccount;
  if (iou) {
    const line = lines ? findTrustLine(lines, iou.currency) : null;
    snapshot.trustline = line ? (line as TrustlineSnapshot) : null;
  }
  if (destinationAccount && destinationAccount.flags & LSF_DEPOSIT_AUTH && submitter && submitter !== dest) {
    const r = await client.request({ command: "deposit_authorized", source_account: submitter, destination_account: dest, ledger_index: at });
    snapshot.submitterPreauthorized = r.result.deposit_authorized;
  }
  return { snapshot, now };
}

/**
 * Pre-reveal safety check for EscrowFinish. Reads the validated ledger, never submits.
 * On `ok: true`, use `details.recommendedFee` and `details.lastLedgerSequence` in the finish.
 * On `ok: false`, do NOT submit (map to `unsafe_release` via `unsafeReleaseError` / `assertPreflightOk`).
 */
export async function preflightFinish(req: PreflightRequest): Promise<PreflightResult> {
  const { snapshot, now } = await fetchPreflightSnapshot(req);
  return evaluatePreflight(snapshot, now);
}
