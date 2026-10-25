"use client";

// Orchestrates the release moment across the project page. While the checks suite is running or revealing its rows,
// it "holds" the stage: the hero and the rail keep showing the pre-release numbers. When the last row lands the hold
// lifts and every staged value tweens to the refreshed server value at once (escrow counts down, paid counts up, the
// lime segment fills). Auto-refresh re-renders with identical props, which never re-triggers anything.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export const RELEASE_MS = 1200;

type Stage = { hold: boolean; setHold: (owner: string, on: boolean) => void };
const StageContext = createContext<Stage | null>(null);

export function ReleaseStage({ children }: { children: React.ReactNode }) {
  const [owners, setOwners] = useState<ReadonlySet<string>>(new Set());
  // Stable setter: owners subscribe in effects, so its identity must never change.
  const setHold = useCallback((owner: string, on: boolean) =>
    setOwners((prev) => {
      if (prev.has(owner) === on) return prev;
      const next = new Set(prev);
      if (on) next.add(owner);
      else next.delete(owner);
      return next;
    }), []);
  const hold = owners.size > 0;
  const value = useMemo<Stage>(() => ({ hold, setHold }), [hold, setHold]);
  return <StageContext.Provider value={value}>{children}</StageContext.Provider>;
}

/** Hold the stage while `active`. Releases on unmount so a stuck owner can never freeze the page. */
export function useStageHold(owner: string, active: boolean) {
  const setHold = useContext(StageContext)?.setHold;
  useEffect(() => {
    setHold?.(owner, active);
  }, [setHold, owner, active]);
  useEffect(() => () => setHold?.(owner, false), [setHold, owner]);
}

/** The last value seen while the stage was not held. Outside a ReleaseStage it is the value itself. `key` decides equality. */
export function useStaged<T>(value: T, key: (v: T) => string = (v) => JSON.stringify(v)): T {
  const hold = useContext(StageContext)?.hold ?? false;
  const [shown, setShown] = useState(value);
  const k = key(value);
  const shownKey = key(shown);
  useEffect(() => {
    if (!hold && k !== shownKey) setShown(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by content, not identity
  }, [hold, k, shownKey]);
  return hold ? shown : k === shownKey ? shown : value;
}

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Tween a vector of numbers to `target` over RELEASE_MS. First render shows the target (no motion on load);
 * later changes animate from wherever the display currently is. Reduced motion jumps to the end state.
 * Returns the displayed values and whether a tween is in flight.
 */
export function useTween(target: number[], ms = RELEASE_MS): { values: number[]; moving: boolean } {
  const key = target.join(",");
  const [values, setValues] = useState(target);
  const [moving, setMoving] = useState(false);
  const current = useRef(target);
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => {
    const to = key.split(",").map(Number);
    const from = current.current;
    if (from.length === to.length && from.every((v, i) => v === to[i])) return;
    if (frame.current) cancelAnimationFrame(frame.current);
    if (reduced() || from.length !== to.length) {
      current.current = to;
      setValues(to);
      setMoving(false);
      return;
    }
    const start = performance.now();
    setMoving(true);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      const e = easeOut(t);
      // Whole-unit amounts tick in whole units so the count never flashes cents it does not have.
      const next = to.map((v, i) => {
        const raw = from[i]! + (v - from[i]!) * e;
        return v % 100 === 0 && from[i]! % 100 === 0 ? Math.round(raw / 100) * 100 : Math.round(raw);
      });
      current.current = next;
      setValues(next);
      if (t < 1) frame.current = requestAnimationFrame(step);
      else {
        frame.current = undefined;
        setMoving(false);
      }
    };
    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    };
  }, [key, ms]);

  return { values, moving };
}
