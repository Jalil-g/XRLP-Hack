import assert from "node:assert/strict";
import { test } from "node:test";
import {
  conditionFromPreimage,
  fulfillmentFromPreimage,
  fulfillmentMatches,
  generateMilestoneCondition,
} from "../src/condition.ts";
import { normalizeRlusd } from "../src/events.ts";

test("empty-preimage vector (xrpl.org EscrowCreate docs)", () => {
  const empty = new Uint8Array(0);
  assert.equal(fulfillmentFromPreimage(empty), "A0028000");
  assert.equal(
    conditionFromPreimage(empty),
    "A0258020E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855810100",
  );
});

test("generated pairs have the standard 32-byte shape and match", () => {
  const { condition, fulfillment } = generateMilestoneCondition();
  assert.match(condition, /^A0258020[0-9A-F]{64}810120$/);
  assert.match(fulfillment, /^A0228020[0-9A-F]{64}$/);
  assert.ok(fulfillmentMatches(condition, fulfillment));
});

test("pairs are unique and do not cross-match", () => {
  const a = generateMilestoneCondition();
  const b = generateMilestoneCondition();
  assert.notEqual(a.condition, b.condition);
  assert.equal(fulfillmentMatches(a.condition, b.fulfillment), false);
  assert.equal(fulfillmentMatches(a.condition, "deadbeef"), false);
});

test("normalizeRlusd trims to <= 6 decimals", () => {
  assert.equal(normalizeRlusd("15000.02140411055498"), "15000.021404");
  assert.equal(normalizeRlusd("9000"), "9000");
  assert.equal(normalizeRlusd("1.500000"), "1.5");
});
