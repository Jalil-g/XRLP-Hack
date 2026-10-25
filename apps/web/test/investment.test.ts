import test from "node:test";
import assert from "node:assert/strict";
import { investmentAvailability } from "../lib/investment.ts";

const deadline = "2026-10-25T18:00:00.000Z";

test("investment stays available through the exact SubscriptionDate", () => {
  assert.deepEqual(investmentAvailability("funding", "subscription", deadline, Date.parse(deadline)), { available: true });
});

test("investment closes immediately after the SubscriptionDate", () => {
  const result = investmentAvailability("funding", "subscription", deadline, Date.parse(deadline) + 1);
  assert.equal(result.available, false);
  if (!result.available) {
    assert.equal(result.label, "Funding closed");
    assert.match(result.reason, /stopped accepting deposits/);
  }
});

test("investment is unavailable outside funding and subscription", () => {
  assert.equal(investmentAvailability("funded", "subscription", deadline).available, false);
  assert.equal(investmentAvailability("funding", "investment", deadline).available, false);
});

test("investment fails closed when the vault deadline is missing or invalid", () => {
  for (const value of [undefined, "not-a-date"]) {
    const result = investmentAvailability("funding", "subscription", value);
    assert.equal(result.available, false);
    if (!result.available) assert.equal(result.label, "Invest unavailable");
  }
});
