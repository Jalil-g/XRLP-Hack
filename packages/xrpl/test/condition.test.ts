import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertPreimageSha256Condition,
  conditionFromPreimage,
  describeConditionInput,
  fulfillmentFromPreimage,
  fulfillmentMatches,
  isPreimageSha256Condition,
} from "../src/condition.ts";
import { normalizeRlusd } from "../src/events.ts";
import { testConditionPair as generateMilestoneCondition } from "./support/conditions.ts";

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

test("condition format: only 32-byte PREIMAGE-SHA-256 (78 hex chars), case-insensitive", () => {
  const { condition, fulfillment } = generateMilestoneCondition();
  assert.equal(condition.length, 78);
  assert.ok(isPreimageSha256Condition(condition));
  assert.ok(isPreimageSha256Condition(condition.toLowerCase()));
  assert.equal(assertPreimageSha256Condition(condition.toLowerCase()), condition);
  // empty-preimage condition (cost 0) is valid DER but not our 32-byte shape
  assert.equal(isPreimageSha256Condition(conditionFromPreimage(new Uint8Array(0))), false);
  assert.equal(isPreimageSha256Condition(fulfillment), false);
  assert.equal(isPreimageSha256Condition(condition.slice(0, -2)), false);
  assert.equal(isPreimageSha256Condition(condition.replace(/^A0/, "A1")), false);
  assert.equal(isPreimageSha256Condition(condition.slice(0, 10) + "ZZ" + condition.slice(12)), false);
  assert.throws(() => assertPreimageSha256Condition("ABCD", "m1"), /m1: not a 32-byte PREIMAGE-SHA-256 condition/);
});

test("M2: a bad condition is described, never echoed (a fulfillment or raw preimage passed by mistake stays secret)", () => {
  const { fulfillment, condition } = generateMilestoneCondition();
  const preimage = fulfillment.slice(8);
  for (const raw of [fulfillment, fulfillment.toLowerCase(), preimage, `${condition}00`, `  ${fulfillment}  `]) {
    assert.throws(
      () => assertPreimageSha256Condition(raw, "EscrowCreate.Condition"),
      (e: unknown) => e instanceof Error && !e.message.toUpperCase().includes(preimage.toUpperCase()) && /value not echoed/.test(e.message),
    );
  }
  assert.match(describeConditionInput(fulfillment), /FULFILLMENT, which is the secret/);
  assert.match(describeConditionInput(preimage), /64 hex chars, a raw preimage or a hash/);
  assert.equal(describeConditionInput(`${condition}00`), "80 chars, starting A0258020 (value not echoed)");
  assert.equal(describeConditionInput("deadbeef"), "8 chars (value not echoed)");
  assert.equal(describeConditionInput(42), "a number");
});
