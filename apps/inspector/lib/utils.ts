// Copied from apps/web/lib/utils.ts (no cross-app imports); trimmed to what the inspector app uses.
import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({ extend: { classGroups: { "font-size": [{ text: ["display", "title", "heading", "body", "small", "caption"] }] } } });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const BRAND = {
  name: "Drawproof",
  app: "Inspector",
  tagline: "You are the eyes on site: your signed audit is a required check before any milestone money moves.",
  network: "XRPL Devnet",
};

// ---------- money (decimal strings — never floats for balances) ----------

const usd0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** "120000.00" → "120,000 RLUSD". */
export function formatRlusd(amount: string) {
  return `${usd0.format(Number(amount))} RLUSD`;
}

// ---------- identifiers ----------

export function shortAddress(addr: string, head = 6, tail = 4) {
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function shortHash(hash: string) {
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

export const explorerTxUrl = (hash: string) => `https://devnet.xrpl.org/transactions/${hash}`;
export const explorerAccountUrl = (address: string) => `https://devnet.xrpl.org/accounts/${address}`;

// ---------- time ----------

const dateTimeFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: "UTC",
});

export function formatDateTime(iso: string) {
  return `${dateTimeFmt.format(new Date(iso))} UTC`;
}
