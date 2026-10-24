// Map tx results to the shared ChainEvent audit-trail shape.
import type { ChainEvent } from "@xrlp/shared";
import type { TxResult } from "./client.ts";

export type ChainEventKind = ChainEvent["kind"];

export function toChainEvent(
  tx: TxResult,
  e: { projectId: string; kind: ChainEventKind; milestoneId?: string; actor?: string; amount?: string },
): ChainEvent {
  return {
    projectId: e.projectId,
    kind: e.kind,
    txHash: tx.hash,
    explorerUrl: tx.explorerUrl,
    at: new Date().toISOString(),
    ...(e.milestoneId ? { milestoneId: e.milestoneId } : {}),
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
