// Id helpers + deterministic fake XRPL identifiers (used by fakes, seed data and tests).
import { createHash, randomUUID } from "node:crypto";

export const sha256Hex = (s: string | Buffer): string => createHash("sha256").update(s).digest("hex");

export const newId = (prefix: string): string => `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

// XRPL's base58 alphabet (starts with 'r'):
const XRPL_ALPHABET = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";

/** A syntactically valid (regex-level) XRPL classic address derived from `seed`. Not checksummed. */
export function fakeAddress(seed: string): string {
  const bytes = createHash("sha256").update(`addr:${seed}`).digest();
  let out = "r";
  for (let i = 0; out.length < 34; i++) out += XRPL_ALPHABET[bytes[i % bytes.length]! % 58]!;
  return out;
}

/** 64-char uppercase hex, like an XRPL tx hash / ledger object id. */
export const fakeHash = (seed: string): string => sha256Hex(`hash:${seed}`).toUpperCase();
