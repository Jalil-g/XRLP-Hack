// TEST/SPIKE ONLY: stand-in for core's release service (CORE-12), which owns condition generation in the product.
// The close path (closeLoanAndCreateEscrows) never generates preimages; it only takes conditions passed in.
import { randomBytes } from "node:crypto";
import { conditionFromPreimage, fulfillmentFromPreimage } from "../../src/condition.ts";

export interface TestConditionPair {
  /** Public PREIMAGE-SHA-256 condition (goes on-chain). */
  condition: string;
  /** Secret fulfillment (in the product: held by core's release service, encrypted at rest). */
  fulfillment: string;
}

/** One fresh 32-byte-preimage pair. Tests and devnet spikes only. */
export function testConditionPair(): TestConditionPair {
  const preimage = randomBytes(32);
  return { condition: conditionFromPreimage(preimage), fulfillment: fulfillmentFromPreimage(preimage) };
}

/** `n` fresh pairs, e.g. one per milestone. */
export function testConditionPairs(n: number): TestConditionPair[] {
  return Array.from({ length: n }, testConditionPair);
}
