"use client";
// Poll a read every `intervalMs` (INS-02: the queue polls 5s). One request in flight at a time, paused while the tab is hidden,
// re-run immediately when it becomes visible again. A failed poll keeps the last good data and reports the error, so a core
// restart mid-demo shows "stale" instead of blanking the screen.
import { useCallback, useEffect, useRef, useState } from "react";

export type Poll<T> = {
  data: T | null;
  error?: string;
  /** Epoch ms of the last successful response. */
  updatedAt?: number;
  /** Fetch now (e.g. after submitting an audit) instead of waiting for the next tick. */
  refresh(): void;
};

export function usePoll<T>(load: (() => Promise<T>) | null, intervalMs: number): Poll<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string>();
  const [updatedAt, setUpdatedAt] = useState<number>();
  const tick = useRef<() => void>(() => {});

  useEffect(() => {
    setData(null);
    setError(undefined);
    setUpdatedAt(undefined);
    if (!load) return;
    let live = true;
    let inFlight = false;
    const run = () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      load()
        .then((next) => {
          if (!live) return;
          setData(next);
          setError(undefined);
          setUpdatedAt(Date.now());
        })
        .catch((err: Error) => live && setError(err.message))
        .finally(() => {
          inFlight = false;
        });
    };
    tick.current = run;
    run();
    const timer = setInterval(run, intervalMs);
    document.addEventListener("visibilitychange", run);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", run);
    };
  }, [load, intervalMs]);

  const refresh = useCallback(() => tick.current(), []);
  return { data, error, updatedAt, refresh };
}
