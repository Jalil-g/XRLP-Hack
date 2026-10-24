// PREIMAGE-SHA-256 crypto-conditions (RFC draft-thomas-crypto-conditions), as used by XRPL Escrow.
// Core only ever sees CONDITIONS at rest; fulfillments pass through in-memory at release time.
import { createHash, randomBytes } from "node:crypto";

/** Inspector-side: fresh 32-byte preimage -> { condition, fulfillment } (uppercase hex). Keep `fulfillment` secret. */
export function generateMilestoneCondition(): { condition: string; fulfillment: string } {
  const preimage = randomBytes(32);
  const fulfillment = `A0228020${preimage.toString("hex")}`.toUpperCase();
  return { condition: conditionFromFulfillment(fulfillment), fulfillment };
}

/** Derive the condition for a PREIMAGE-SHA-256 fulfillment (32-byte preimage). Throws on malformed input. */
export function conditionFromFulfillment(fulfillment: string): string {
  const hex = fulfillment.toUpperCase();
  if (!/^A0228020[0-9A-F]{64}$/.test(hex)) throw new Error("Malformed PREIMAGE-SHA-256 fulfillment");
  const preimage = Buffer.from(hex.slice(8), "hex");
  const fingerprint = createHash("sha256").update(preimage).digest("hex");
  return `A0258020${fingerprint}810120`.toUpperCase();
}

export function fulfillmentMatches(condition: string, fulfillment: string): boolean {
  try {
    return conditionFromFulfillment(fulfillment) === condition.toUpperCase();
  } catch {
    return false;
  }
}

export const isCondition = (s: string): boolean => /^A0258020[0-9A-F]{64}810120$/i.test(s);
