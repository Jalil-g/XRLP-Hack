// RLUSD math on integer micro-units (6 decimals). Never use floats for money.
import type { Rlusd } from "@xrlp/shared";
import { DomainError } from "./errors.ts";

const SCALE = 1_000_000n;
const RLUSD_RE = /^\d+(\.\d{1,6})?$/;

export function toMicro(amount: Rlusd | string): bigint {
  if (!RLUSD_RE.test(amount)) throw new DomainError("VALIDATION", `Invalid RLUSD amount "${amount}"`);
  const [whole = "0", frac = ""] = amount.split(".");
  return BigInt(whole) * SCALE + BigInt(frac.padEnd(6, "0"));
}

/** Formats micro-units as an Rlusd string with at least 2 decimals, e.g. 25000000000n -> "25000.00". */
export function fromMicro(micro: bigint): Rlusd {
  if (micro < 0n) throw new DomainError("VALIDATION", `Negative RLUSD amount ${micro}`);
  const whole = micro / SCALE;
  let frac = (micro % SCALE).toString().padStart(6, "0").replace(/0+$/, "");
  if (frac.length < 2) frac = frac.padEnd(2, "0");
  return `${whole}.${frac}`;
}

export const addR = (...xs: Rlusd[]): Rlusd => fromMicro(xs.reduce((a, x) => a + toMicro(x), 0n));
export const sumMicro = (xs: Rlusd[]): bigint => xs.reduce((a, x) => a + toMicro(x), 0n);
export const minMicro = (a: bigint, b: bigint): bigint => (a < b ? a : b);
export const maxMicro = (a: bigint, b: bigint): bigint => (a > b ? a : b);

/** Splits `total` by float shares; rounding remainder goes to the last bucket so parts sum exactly. */
export function splitByShares(total: Rlusd, shares: number[]): Rlusd[] {
  const t = toMicro(total);
  const parts = shares.map((s) => (t * BigInt(Math.round(s * 1_000_000))) / 1_000_000n);
  // round each part down to whole cents for nicer display
  for (let i = 0; i < parts.length; i++) parts[i] = (parts[i]! / 10_000n) * 10_000n;
  const assigned = parts.slice(0, -1).reduce((a, x) => a + x, 0n);
  parts[parts.length - 1] = t - assigned;
  return parts.map(fromMicro);
}

/** Simple (non-compounding) interest owed over the full term. */
export function totalOwedMicro(principal: Rlusd, interestRateBps: number, termDays: number): bigint {
  const p = toMicro(principal);
  return p + (p * BigInt(interestRateBps) * BigInt(termDays)) / (10_000n * 365n);
}

/** Percentage 0..100 with one decimal, for display. */
export function pct(part: bigint, whole: bigint): number {
  if (whole === 0n) return 0;
  return Number((part * 1000n) / whole) / 10;
}
