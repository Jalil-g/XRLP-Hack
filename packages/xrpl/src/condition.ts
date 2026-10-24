// PREIMAGE-SHA-256 crypto-conditions (RFC draft-thomas-crypto-conditions), DER-encoded by hand.
// Pure functions: no network, no persistence. The INSPECTOR side calls generateMilestoneCondition();
// only `condition` is handed to the SPV's EscrowCreate. The platform never stores `fulfillment`.
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export interface MilestoneCondition {
  /** Hex DER condition — goes on-chain in EscrowCreate.Condition. Public. */
  condition: string;
  /** Hex DER fulfillment — SECRET until release; whoever holds it can finish the escrow. */
  fulfillment: string;
}

const PREIMAGE_LEN = 32;

/** Encode a fulfillment for a raw preimage: A0 len 80 len <preimage>. */
export function fulfillmentFromPreimage(preimage: Uint8Array): string {
  if (preimage.length > 127) throw new Error("preimage too long for short-form DER");
  const inner = Buffer.concat([Buffer.from([0x80, preimage.length]), Buffer.from(preimage)]);
  return Buffer.concat([Buffer.from([0xa0, inner.length]), inner]).toString("hex").toUpperCase();
}

/** Encode the condition for a preimage: A0 25 80 20 <sha256> 81 01 <cost=len>. */
export function conditionFromPreimage(preimage: Uint8Array): string {
  if (preimage.length > 127) throw new Error("preimage too long");
  const fp = createHash("sha256").update(preimage).digest();
  const inner = Buffer.concat([Buffer.from([0x80, 0x20]), fp, Buffer.from([0x81, 0x01, preimage.length])]);
  return Buffer.concat([Buffer.from([0xa0, inner.length]), inner]).toString("hex").toUpperCase();
}

/** Extract the preimage from a PREIMAGE-SHA-256 fulfillment hex. */
export function preimageFromFulfillment(fulfillmentHex: string): Buffer {
  const b = Buffer.from(fulfillmentHex, "hex");
  if (b[0] !== 0xa0 || b[2] !== 0x80) throw new Error("not a PREIMAGE-SHA-256 fulfillment");
  const len = b[3]!;
  if (b[1] !== len + 2 || b.length !== len + 4) throw new Error("malformed fulfillment length");
  return b.subarray(4, 4 + len);
}

/** Fresh, unique condition/fulfillment pair (32 random bytes). Call once per escrow — never reuse. */
export function generateMilestoneCondition(): MilestoneCondition {
  const preimage = randomBytes(PREIMAGE_LEN);
  return { condition: conditionFromPreimage(preimage), fulfillment: fulfillmentFromPreimage(preimage) };
}

/** True iff `fulfillment` satisfies `condition`. Check before submitting EscrowFinish. */
export function fulfillmentMatches(condition: string, fulfillment: string): boolean {
  try {
    const expected = Buffer.from(conditionFromPreimage(preimageFromFulfillment(fulfillment)), "hex");
    const actual = Buffer.from(condition, "hex");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
