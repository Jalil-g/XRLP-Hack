// CORE-06. Background keeper: KEEPER=1 runs CoreApi.keeperTick() every 30 s (KEEPER_INTERVAL_MS overrides) so expired
// escrows get EscrowCancel -> refund LoanPay and stuck releases get retried without anyone pressing route 22.
// Ticks never overlap: a tick that is still running when the timer fires is skipped, not queued.
import type { KeeperTickResult } from "./api-surface.ts";

export const DEFAULT_KEEPER_INTERVAL_MS = 30_000;

type Env = Record<string, string | undefined>;

/** KEEPER=1|true -> interval ms; anything else -> undefined (keeper off; route 22 still works). */
export function keeperIntervalFromEnv(env: Env): number | undefined {
  const on = (env.KEEPER ?? "0").trim().toLowerCase();
  if (on !== "1" && on !== "true") return undefined;
  const raw = env.KEEPER_INTERVAL_MS?.trim();
  if (!raw) return DEFAULT_KEEPER_INTERVAL_MS;
  const ms = Number(raw);
  if (!Number.isInteger(ms) || ms < 1000) throw new Error(`KEEPER_INTERVAL_MS must be an integer >= 1000, got "${raw}"`);
  return ms;
}

export interface Keeper {
  /** Runs one tick now unless one is already running (then resolves to undefined). */
  tickNow(): Promise<KeeperTickResult | undefined>;
  stop(): void;
}

export function startKeeper(
  api: { keeperTick(): Promise<KeeperTickResult> },
  opts: { intervalMs?: number; log?: (line: string) => void } = {},
): Keeper {
  const log = opts.log ?? ((line) => console.log(`[keeper] ${line}`));
  let running = false;
  const tickNow = async (): Promise<KeeperTickResult | undefined> => {
    if (running) return undefined;
    running = true;
    try {
      const r = await api.keeperTick();
      for (const e of r.events) log(`${e.kind} ${e.projectId}/${e.milestoneId ?? "-"} ${e.explorerUrl}`);
      for (const i of r.issues) log(`retry next tick: ${i.step} ${i.projectId}/${i.milestoneId} ${i.code}: ${i.message}`);
      return r;
    } catch (e) {
      log(`tick failed: ${(e as Error).message}`);
      return undefined;
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tickNow(), opts.intervalMs ?? DEFAULT_KEEPER_INTERVAL_MS);
  timer.unref();
  return { tickNow, stop: () => clearInterval(timer) };
}
