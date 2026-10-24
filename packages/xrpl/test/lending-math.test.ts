import assert from "node:assert/strict";
import { test } from "node:test";
import {
  COVER_RATE_LIQUIDATION,
  COVER_RATE_MINIMUM,
  defaultCoverDeposit,
  expectedInterest,
  fromMicro,
  loanScheduleFromTerms,
  managementFeeOn,
  MANAGEMENT_FEE_RATE,
  minimumCover,
  originationFeeFor,
  toMicro,
  validateBrokerRates,
  validateVaultDates,
  vaultDatesFor,
} from "../src/lending-math.ts";

test("micro round-trip", () => {
  assert.equal(toMicro("1234.5"), 1_234_500_000n);
  assert.equal(fromMicro(1_234_500_000n), "1234.5");
  assert.equal(fromMicro(toMicro("0.000001")), "0.000001");
  assert.equal(fromMicro(toMicro("30000")), "30000");
  assert.throws(() => toMicro("1.0000001"));
  assert.throws(() => toMicro("-1"));
});

test("broker rate defaults are valid and non-zero", () => {
  assert.equal(COVER_RATE_MINIMUM, 10_000);
  assert.equal(COVER_RATE_LIQUIDATION, 100_000);
  assert.ok(MANAGEMENT_FEE_RATE > 0);
  validateBrokerRates({ coverRateMinimum: COVER_RATE_MINIMUM, coverRateLiquidation: COVER_RATE_LIQUIDATION, managementFeeRate: MANAGEMENT_FEE_RATE });
  validateBrokerRates({ coverRateMinimum: 0, coverRateLiquidation: 0, managementFeeRate: 0 });
});

test("cover rates must be both zero or both non-zero; ranges enforced", () => {
  assert.throws(() => validateBrokerRates({ coverRateMinimum: 10_000, coverRateLiquidation: 0, managementFeeRate: 0 }), /both zero or both non-zero/);
  assert.throws(() => validateBrokerRates({ coverRateMinimum: 0, coverRateLiquidation: 100_000, managementFeeRate: 0 }), /both zero or both non-zero/);
  assert.throws(() => validateBrokerRates({ coverRateMinimum: 100_001, coverRateLiquidation: 1, managementFeeRate: 0 }), /CoverRateMinimum/);
  assert.throws(() => validateBrokerRates({ coverRateMinimum: 1, coverRateLiquidation: 1, managementFeeRate: 10_001 }), /ManagementFeeRate/);
  assert.throws(() => validateBrokerRates({ coverRateMinimum: 1.5, coverRateLiquidation: 1, managementFeeRate: 0 }), /integer/);
});

test("expected interest matches the XRPL-01 devnet loan (1000 @ 10%, 2 x 120s -> TVO 1000.00057)", () => {
  const i = expectedInterest({ principal: "1000", interestRate: 10_000, paymentTotal: 2, paymentIntervalS: 120 });
  assert.ok(Math.abs(i - 0.00057) < 0.000005, `interest ${i}`);
  assert.equal(expectedInterest({ principal: "1000", interestRate: 0, paymentTotal: 2, paymentIntervalS: 120 }), 0);
});

test("expected interest for realistic terms (30000 @ 10%, 2 x 15 days) is amortized, < simple interest", () => {
  const i = expectedInterest({ principal: "30000", interestRate: 10_000, paymentTotal: 2, paymentIntervalS: 15 * 86_400 });
  const simple = 30_000 * 0.1 * (30 / 365);
  assert.ok(i > simple * 0.7 && i < simple, `interest ${i} vs simple ${simple}`);
});

test("minimum cover = ceil((debt + principal + interest) x CoverRateMinimum)", () => {
  assert.equal(minimumCover({ principal: "1000", interest: 0.00057 }), "100.000057");
  assert.equal(minimumCover({ principal: "1000", interest: 0 }), "100");
  assert.equal(minimumCover({ principal: "1000", interest: 0, existingDebt: "500" }), "150");
  assert.equal(minimumCover({ principal: "1000", interest: 0.0000001 }), "100.000001"); // rounds up
  assert.equal(minimumCover({ principal: "1000", interest: 50, coverRateMinimum: 0 }), "0");
});

test("default cover deposit = max(10% principal, minimum + 10% headroom)", () => {
  // minimum 100.000057 -> + 10% headroom (rounded up) = 110.000063
  assert.equal(defaultCoverDeposit({ principal: "1000", interest: 0.00057 }), "110.000063");
  // rates off -> floor of 10% of principal still applies (cover stays mandatory)
  assert.equal(defaultCoverDeposit({ principal: "1000", interest: 10, coverRateMinimum: 0 }), "100");
  const p = "30000";
  const i = expectedInterest({ principal: p, interestRate: 10_000, paymentTotal: 2, paymentIntervalS: 15 * 86_400 });
  const d = Number(defaultCoverDeposit({ principal: p, interest: i }));
  assert.ok(d >= Number(minimumCover({ principal: p, interest: i })) * 1.1 - 1e-6);
  assert.ok(d >= 3000);
});

test("origination fee in bps of principal, rounded down to 6 dp", () => {
  assert.equal(originationFeeFor("30000"), "450"); // default 150 bps
  assert.equal(originationFeeFor("1000", 100), "10");
  assert.equal(originationFeeFor("0.000099", 100), "0"); // floors
  assert.equal(originationFeeFor("1000", 0), "0");
  assert.throws(() => originationFeeFor("1000", 10_001));
});

test("management fee on interest", () => {
  assert.equal(managementFeeOn(100, 10_000), 10);
  assert.equal(managementFeeOn(100, 1_000), 1);
});

test("loan schedule from terms", () => {
  assert.deepEqual(loanScheduleFromTerms({ termDays: 30, paymentIntervalDays: 15 }), { paymentTotal: 2, paymentIntervalS: 1_296_000 });
  assert.deepEqual(loanScheduleFromTerms({ termDays: 10, paymentIntervalDays: 30 }), { paymentTotal: 1, paymentIntervalS: 2_592_000 });
});

test("vault dates: Redemption = Subscription + interval x total + 60 + buffer", () => {
  const sub = 800_000_000;
  const d = vaultDatesFor({ subscriptionDate: sub, paymentTotal: 2, paymentIntervalS: 15 * 86_400 });
  assert.equal(d.subscriptionDate, sub);
  assert.equal(d.redemptionDate, sub + 30 * 86_400 + 60 + 2 * 86_400);
  const demo = vaultDatesFor({ subscriptionDate: sub, paymentTotal: 4, paymentIntervalS: 300, bufferS: 90 });
  assert.equal(demo.redemptionDate, sub + 1200 + 60 + 90);
});

test("vault date validation", () => {
  const sub = 800_000_000;
  assert.throws(() => validateVaultDates({ subscriptionDate: sub, redemptionDate: sub + 179 }), /180s/);
  validateVaultDates({ subscriptionDate: sub, redemptionDate: sub + 180 });
  // schedule must fit: sub + 2x120 + 60 + 60 = sub + 360
  validateVaultDates({ subscriptionDate: sub, redemptionDate: sub + 360, paymentTotal: 2, paymentIntervalS: 120 });
  assert.throws(() => validateVaultDates({ subscriptionDate: sub, redemptionDate: sub + 359, paymentTotal: 2, paymentIntervalS: 120 }), /too early/);
  assert.throws(() => validateVaultDates({ subscriptionDate: sub, redemptionDate: sub + 400, paymentTotal: 2, paymentIntervalS: 120, minLoanSetWindowS: 120 }), /too early/);
  assert.throws(() => validateVaultDates({ subscriptionDate: sub + 0.5, redemptionDate: sub + 400 }), /integer/);
});
