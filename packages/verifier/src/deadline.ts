/** Bound asynchronous model work even when an injected client ignores its own timeout. */
export async function withDeadline<T>(run: (signal: AbortSignal) => Promise<T>, milliseconds = 20_000): Promise<T> {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > 60_000) throw new Error("Timeout must be within 1..60000 ms.");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => run(controller.signal)),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("Verifier deadline exceeded.")); }, milliseconds); }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}
