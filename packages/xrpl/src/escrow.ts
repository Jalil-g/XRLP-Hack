// Milestone escrows: IOU (RLUSD) escrows owned by the SPV, payable only to the builder,
// gated by a PREIMAGE-SHA-256 condition, refundable to the SPV after CancelAfter.
import { randomBytes } from "node:crypto";
import { explorerTxUrl, TooSoonError } from "@xrlp/shared";
import type { Wallet } from "xrpl";
import { getClient, isNotFound, signAndSubmit, XrplTxError, type TxResult } from "./client.ts";
import { fulfillmentFromPreimage, fulfillmentMatches } from "./condition.ts";
import { assertPreflightOk, preflightFinish, UnsafeReleaseError, type LedgerNow, type PreflightReason, type PreflightResult } from "./preflight.ts";
import { rlusdAmount } from "./rlusd.ts";
import { multisignAndSubmit } from "./spv.ts";

export interface CreateEscrowParams {
  spv: string;
  builder: string;
  issuer: string;
  amount: string;
  /** Hex PREIMAGE-SHA-256 condition from the inspector (generateMilestoneCondition). */
  condition: string;
  /** Ripple-epoch seconds. Required for token escrows. */
  cancelAfter: number;
  /** SPV signers reaching quorum: any 3 of {platform, builder, inspector, trustee}. */
  signers?: Wallet[];
  /** Fallback: SPV master key (only before the SPV is locked). */
  singleKey?: Wallet;
}

export interface CreatedEscrow {
  tx: TxResult;
  owner: string;
  /** Sequence of the EscrowCreate — needed for finish/cancel. */
  offerSequence: number;
}

export async function createMilestoneEscrow(p: CreateEscrowParams): Promise<CreatedEscrow> {
  const ec = {
    TransactionType: "EscrowCreate" as const,
    Account: p.spv,
    Destination: p.builder,
    Amount: rlusdAmount(p.issuer, p.amount),
    Condition: p.condition,
    CancelAfter: p.cancelAfter,
  };
  const tx = p.singleKey ? await signAndSubmit(p.singleKey, ec) : await multisignAndSubmit(ec, p.signers ?? []);
  const seq = Number(tx.tx.Sequence);
  return { tx, owner: p.spv, offerSequence: seq };
}

/** LastLedgerSequence headroom (ledgers) for EscrowFinish (API.md "Submission semantics"). Preflight's CancelAfter margin = max(120s, this x 5s). */
export const FINISH_LLS_MARGIN = 60;

export interface FinishEscrowParams {
  submitter: Wallet;
  owner: string;
  offerSequence: number;
  condition: string;
  fulfillment: string;
  /** Negative spikes only: skip preflightFinish (a failed finish publishes the preimage). */
  skipPreflight?: boolean;
  /** Expected escrow Destination (the builder); preflight refuses on mismatch. */
  destination?: string;
  /** LastLedgerSequence = validated + this. Default FINISH_LLS_MARGIN (60). */
  lastLedgerMargin?: number;
  /** Minimum seconds to CancelAfter (preflight `marginS`, default 120). */
  marginS?: number;
}

/**
 * EscrowFinish — anyone may submit; the fulfillment is the gate. `submitter` (releaseService) pays the fee.
 * Runs preflightFinish first (throws UnsafeReleaseError, nothing submitted) unless `skipPreflight`, and uses its Fee
 * (sized for the fulfillment) and LastLedgerSequence. If the submit fails `retriable` (nothing applied), preflight is
 * re-run and the finish rebuilt once.
 */
export async function finishEscrow(p: FinishEscrowParams): Promise<TxResult> {
  if (!fulfillmentMatches(p.condition, p.fulfillment)) throw new Error("fulfillment does not match escrow condition");
  const margin = p.lastLedgerMargin ?? FINISH_LLS_MARGIN;
  const attempt = async () => {
    const pf = p.skipPreflight
      ? undefined
      : await preflightFinish({
          owner: p.owner,
          offerSequence: p.offerSequence,
          condition: p.condition,
          fulfillment: p.fulfillment,
          submitter: p.submitter.classicAddress,
          lastLedgerOffset: margin,
          ...(p.destination ? { destination: p.destination } : {}),
          ...(p.marginS !== undefined ? { marginS: p.marginS } : {}),
        });
    if (pf) assertPreflightOk(pf);
    return signAndSubmit(
      p.submitter,
      {
        ...(pf ? { Fee: pf.details.recommendedFee, LastLedgerSequence: pf.details.lastLedgerSequence } : {}),
        TransactionType: "EscrowFinish",
        Account: p.submitter.classicAddress,
        Owner: p.owner,
        OfferSequence: p.offerSequence,
        Condition: p.condition,
        Fulfillment: p.fulfillment,
      },
      { lastLedgerMargin: margin },
    );
  };
  try {
    return await attempt();
  } catch (e) {
    if (!(e instanceof XrplTxError) || !e.retriable) throw e;
    return attempt();
  }
}

/**
 * EscrowCancel — anyone may submit after CancelAfter; funds return to the owner (SPV). Checks CancelAfter against the
 * validated ledger's close time first and throws shared `TooSoonError` without submitting if it has not passed
 * (an on-ledger `tecNO_PERMISSION` is mapped to `TooSoonError` too). `skipTimeCheck` only for negative spikes.
 */
export async function cancelEscrow(p: { submitter: Wallet; owner: string; offerSequence: number; skipTimeCheck?: boolean }): Promise<TxResult> {
  if (!p.skipTimeCheck) {
    const { escrow, now } = await getEscrowAtLedger(p.owner, p.offerSequence);
    const r = cancelReadiness(escrow, now.closeTime);
    if (!r.ok) {
      if (r.reason === "too_soon") throw new TooSoonError(`EscrowCancel ${p.owner}#${p.offerSequence}: ${r.message} (nothing submitted)`);
      throw new XrplTxError("EscrowCancel", r.reason === "escrow_not_found" ? "tecNO_TARGET" : "tecNO_PERMISSION", undefined, {
        detail: `local check, nothing submitted: ${r.message}`,
      });
    }
  }
  try {
    return await signAndSubmit(p.submitter, {
      TransactionType: "EscrowCancel",
      Account: p.submitter.classicAddress,
      Owner: p.owner,
      OfferSequence: p.offerSequence,
    });
  } catch (e) {
    if (e instanceof XrplTxError && e.engineResult === "tecNO_PERMISSION" && e.hash) {
      throw new TooSoonError(`EscrowCancel ${p.owner}#${p.offerSequence}: CancelAfter not passed on-ledger (${e.explorerUrl})`, { txResult: e.engineResult, txHash: e.hash });
    }
    throw e;
  }
}

export interface EscrowEntry {
  index: string;
  Account: string;
  Destination: string;
  Amount: unknown;
  Condition?: string;
  CancelAfter?: number;
  PreviousTxnID: string;
}

export async function listEscrows(owner: string): Promise<EscrowEntry[]> {
  const client = await getClient();
  const res = await client.request({ command: "account_objects", account: owner, type: "escrow", ledger_index: "validated" });
  return res.result.account_objects as unknown as EscrowEntry[];
}

// ---------------------------------------------------------------- XRPL-07 helpers

/** Escrow fields the cancel/finish checks need. `null` = not on the ledger (finished, cancelled, or never created). */
export interface EscrowTiming {
  CancelAfter?: number;
  FinishAfter?: number;
  Condition?: string;
  Amount?: unknown;
  Destination?: string;
}

/** The escrow and "now" read from ONE validated ledger. */
export async function getEscrowAtLedger(owner: string, offerSequence: number): Promise<{ escrow: EscrowTiming | null; now: LedgerNow }> {
  const client = await getClient();
  const led = await client.request({ command: "ledger", ledger_index: "validated" });
  const now: LedgerNow = { ledgerIndex: Number(led.result.ledger_index), closeTime: led.result.ledger.close_time };
  try {
    const r = await client.request({ command: "ledger_entry", escrow: { owner, seq: offerSequence }, ledger_index: now.ledgerIndex });
    return { escrow: r.result.node as unknown as EscrowTiming, now };
  } catch (e) {
    if (isNotFound(e)) return { escrow: null, now };
    throw e;
  }
}

export type CancelReadiness =
  | { ok: true; secondsPast: number }
  | { ok: false; reason: "escrow_not_found" | "no_cancel_after" | "too_soon"; message: string; secondsLeft?: number };

/** Pure: can EscrowCancel succeed at ledger time `nowRipple`? The ledger allows it once close time > CancelAfter. */
export function cancelReadiness(escrow: EscrowTiming | null, nowRipple: number): CancelReadiness {
  if (!escrow) return { ok: false, reason: "escrow_not_found", message: "escrow not found in the validated ledger (already finished or cancelled?)" };
  if (escrow.CancelAfter === undefined) return { ok: false, reason: "no_cancel_after", message: "escrow has no CancelAfter, it can never be cancelled" };
  if (nowRipple > escrow.CancelAfter) return { ok: true, secondsPast: nowRipple - escrow.CancelAfter };
  const secondsLeft = escrow.CancelAfter - nowRipple + 1;
  return { ok: false, reason: "too_soon", secondsLeft, message: `CancelAfter ${escrow.CancelAfter} not passed (ledger now ${nowRipple}, ${secondsLeft}s to go)` };
}

/** Pure: the escrowed amount from a finish/cancel tx's metadata (DeletedNode Escrow). IOU value or XRP drops. */
export function escrowAmountFromMeta(meta: Record<string, unknown>): string | undefined {
  const nodes = (meta.AffectedNodes ?? []) as Array<Record<string, { LedgerEntryType?: string; FinalFields?: { Amount?: unknown } }>>;
  for (const n of nodes) {
    const d = n.DeletedNode;
    if (d?.LedgerEntryType !== "Escrow") continue;
    const a = d.FinalFields?.Amount;
    if (typeof a === "string") return a;
    if (a && typeof a === "object" && "value" in a) return String((a as { value: unknown }).value);
  }
  return undefined;
}

/** Preflight failures that also stop a WRONG-fulfillment finish from producing tecCRYPTOCONDITION_ERROR. */
const WRONG_FINISH_BLOCKERS: ReadonlySet<PreflightReason> = new Set([
  "escrow_not_found",
  "finish_too_early",
  "frozen",
  "not_authorized",
  "unsupported_amount",
  "submitter_not_found",
  "submitter_unfunded",
]);
/** Seconds to CancelAfter below which the try could land after it (tecNO_PERMISSION instead of the demo result). */
export const WRONG_FINISH_MIN_CANCEL_S = 30;

/**
 * Pure: why a wrong-fulfillment demo finish should NOT be sent (empty = go). Ignores the condition check (that is the
 * point) and trust-line issues (the ledger checks the condition first), but refuses a missing/expired escrow.
 */
export function wrongFinishBlockers(pf: PreflightResult): { reason: PreflightReason; message: string }[] {
  const out = pf.failures.filter((f) => WRONG_FINISH_BLOCKERS.has(f.reason));
  const left = pf.details.secondsToCancelAfter;
  if (pf.details.escrow && left !== undefined && left < WRONG_FINISH_MIN_CANCEL_S) {
    out.push({ reason: "expired_or_too_close", message: left <= 0 ? `CancelAfter passed ${-left}s ago` : `only ${left}s to CancelAfter` });
  }
  return out;
}

/** A well-formed PREIMAGE-SHA-256 fulfillment (fresh 32 random bytes) that does NOT satisfy `condition`. */
export function wrongFulfillmentFor(condition: string): string {
  for (;;) {
    const f = fulfillmentFromPreimage(randomBytes(32));
    if (!fulfillmentMatches(condition, f)) return f;
  }
}

/**
 * Demo "try to steal": EscrowFinish with a random WRONG fulfillment. Skips preflight's condition check but still
 * refuses (UnsafeReleaseError, nothing submitted) if the escrow is gone/expired. Resolves with the on-ledger tec
 * TxResult (expected `tecCRYPTOCONDITION_ERROR`); throws if the tx did not reach the ledger.
 */
export async function finishWithWrongFulfillment(p: { submitter: Wallet; owner: string; offerSequence: number; condition: string }): Promise<TxResult> {
  const pf = await preflightFinish({ owner: p.owner, offerSequence: p.offerSequence, submitter: p.submitter.classicAddress });
  const blockers = wrongFinishBlockers(pf);
  if (blockers.length) {
    throw new UnsafeReleaseError({ ...pf, ok: false, reason: blockers[0]!.reason, message: blockers[0]!.message, code: "unsafe_release", failures: blockers });
  }
  const onLedger = pf.details.escrow?.Condition ?? p.condition;
  const fulfillment = wrongFulfillmentFor(onLedger);
  try {
    const tx = await signAndSubmit(p.submitter, {
      Fee: pf.details.recommendedFee,
      LastLedgerSequence: pf.details.lastLedgerSequence,
      TransactionType: "EscrowFinish",
      Account: p.submitter.classicAddress,
      Owner: p.owner,
      OfferSequence: p.offerSequence,
      Condition: p.condition,
      Fulfillment: fulfillment,
    });
    throw new Error(`EscrowFinish with a wrong fulfillment SUCCEEDED (${tx.explorerUrl}) — this must never happen`);
  } catch (e) {
    if (!(e instanceof XrplTxError) || !e.onLedger) throw e;
    return fetchValidatedTx(e.hash!);
  }
}

/** `tx` by hash as a TxResult (for tec results, which submit paths throw as XrplTxError). */
export async function fetchValidatedTx(hash: string): Promise<TxResult> {
  const client = await getClient();
  const r = (await client.request({ command: "tx", transaction: hash })).result as unknown as Record<string, unknown>;
  if (!r.validated) throw new Error(`tx ${hash} is not validated`);
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
