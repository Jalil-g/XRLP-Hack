// Map tx results to the shared ChainEvent audit-trail shape.
import type { ChainEvent, ChainEventKind } from "@xrlp/shared";
import type { TxResult } from "./client.ts";

export type { ChainEventKind };

/** The tx fields toChainEvent reads: a local `TxResult` or a shared LedgerPort `TxResult` both fit. */
export type ChainEventTx = Pick<TxResult, "hash" | "explorerUrl"> & { result?: string };

/**
 * `ChainEvent` for one validated tx. `result` (the engine result) is set only when it isn't tesSUCCESS (shared: tec*
 * results are recorded on-ledger, e.g. a try-steal `release_refused` with tecCRYPTOCONDITION_ERROR); it defaults to
 * `tx.result`. `at` defaults to now.
 */
export function toChainEvent(
  tx: ChainEventTx,
  e: { projectId: string; kind: ChainEventKind; milestoneId?: string; actor?: string; amount?: string; result?: string; at?: string },
): ChainEvent {
  const result = e.result ?? tx.result;
  return {
    projectId: e.projectId,
    kind: e.kind,
    txHash: tx.hash,
    explorerUrl: tx.explorerUrl,
    at: e.at ?? new Date().toISOString(),
    ...(e.milestoneId ? { milestoneId: e.milestoneId } : {}),
    ...(result && result !== "tesSUCCESS" ? { result } : {}),
    ...(e.actor ? { actor: e.actor } : {}),
    ...(e.amount ? { amount: normalizeRlusd(e.amount) } : {}),
  };
}

/** Shared Rlusd regex allows max 6 decimals. */
export function normalizeRlusd(v: string): string {
  const [i, f = ""] = v.split(".");
  const frac = f.slice(0, 6).replace(/0+$/, "");
  return frac ? `${i}.${frac}` : (i ?? "0");
}
