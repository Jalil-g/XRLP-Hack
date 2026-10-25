import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach tailwind-merge our type scale (app/globals.css), or it treats text-caption etc. as colors and drops one of the two.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["display", "title", "heading", "body", "small", "caption"] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const BRAND = {
  name: "Drawproof",
  line: "Construction money that moves only when the building does.",
  pitch: "Investors fund verified projects, and the money moves only when each stage passes its tests.",
};

// ---------- money (decimal strings, integer cents internally — never floats for balances) ----------

export function toCents(amount: string | undefined | null): number {
  if (!amount) return 0;
  const [whole = "0", frac = ""] = amount.split(".");
  return Number(whole) * 100 + Number((frac + "00").slice(0, 2));
}

export function fromCents(cents: number): string {
  const c = Math.max(0, Math.round(cents));
  return `${Math.floor(c / 100)}.${String(c % 100).padStart(2, "0")}`;
}

const usd0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const usd2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** "120000.00" → "120,000" (or "120,000.00" with cents, or "120K" compact). */
export function formatAmount(amount: string | number, opts: { cents?: boolean; compact?: boolean } = {}) {
  const n = typeof amount === "number" ? amount : toCents(amount) / 100;
  if (opts.compact) return compact.format(n);
  // One rule everywhere: whole amounts without decimals, fractional amounts at full cent precision.
  return opts.cents || !Number.isInteger(n) ? usd2.format(n) : usd0.format(n);
}

export function formatRlusd(amount: string | number, opts: { cents?: boolean; compact?: boolean } = {}) {
  return `${formatAmount(amount, opts)} RLUSD`;
}

/** Vault share-MPT scale: core counts shares in raw MPT units, one whole share = 10^6 units (packages/xrpl reads.ts, decisions.md XRPL-09). */
export const SHARE_SCALE = 6;

/** Raw share-MPT units (PortfolioPosition.shares, VaultSnapshot.sharesOutstanding) → whole shares, for display. */
export function sharesFromUnits(units: string): number {
  return Number(units) / 10 ** SHARE_SCALE;
}

export function formatPct(value: number, digits = 0) {
  return `${value.toFixed(digits)}%`;
}

export function formatBps(bps: number) {
  return `${(bps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

// ---------- identifiers ----------

export function shortAddress(addr: string, head = 6, tail = 4) {
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function shortHash(hash: string) {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export const explorerAccountUrl = (address: string) => `https://devnet.xrpl.org/accounts/${address}`;

// ---------- time ----------

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

export function formatDate(iso: string) {
  return dateFmt.format(new Date(iso));
}

export function formatDateTime(iso: string) {
  return `${dateTimeFmt.format(new Date(iso))} UTC`;
}

export function relativeTime(iso: string, now = Date.now()) {
  const diff = (now - new Date(iso).getTime()) / 1000;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? "ago" : "from now";
  if (abs < 45) return diff >= 0 ? "just now" : "in a moment";
  if (abs < 3600) return `${Math.round(abs / 60)}m ${suffix}`;
  if (abs < 86400) return `${Math.round(abs / 3600)}h ${suffix}`;
  return `${Math.round(abs / 86400)}d ${suffix}`;
}
