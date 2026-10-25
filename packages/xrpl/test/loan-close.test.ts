import assert from "node:assert/strict";
import { test } from "node:test";
import { isoTimeToRippleTime, rippleTimeToISOTime } from "xrpl";
import { LedgerError } from "@xrlp/shared";
import { CloseLoanPartialError, CloseValidationError, MIN_ESCROW_LIFETIME_S, planLoanClose, type ClosePlanInput } from "../src/loan-close.ts";
import { XrplTxError } from "../src/errors.ts";
import { testConditionPairs } from "./support/conditions.ts";

const NOW = isoTimeToRippleTime("2026-10-25T12:00:00.000Z");
const INTERVAL = 300;
const TOTAL = 4; // maturity = NOW + 1200
const [c1, c2, c3] = testConditionPairs(3).map((p) => p.condition) as [string, string, string];
const iso = (offsetS: number) => rippleTimeToISOTime(NOW + offsetS);

const base = (o: Partial<ClosePlanInput> = {}): ClosePlanInput => ({
  milestones: [
    { id: "m1", amount: "4000" },
    { id: "m2", amount: "3000" },
    { id: "m3", amount: "3000" },
  ],
  conditions: [c1, c2, c3],
  now: NOW,
  paymentTotal: TOTAL,
  paymentIntervalS: INTERVAL,
  interestRate: 10_000,
  ...o,
});

/** Run planLoanClose, expect CloseValidationError, return its issues. */
function issues(input: ClosePlanInput): string[] {
  try {
    planLoanClose(input);
  } catch (e) {
    assert.ok(e instanceof CloseValidationError, `expected CloseValidationError, got ${e}`);
    assert.equal(e.code, "validation");
    return e.issues;
  }
  assert.fail("expected CloseValidationError");
}

test("valid plan: string[] conditions by index, default CancelAfter = maturity − one interval", () => {
  const plan = planLoanClose(base());
  assert.equal(plan.maturity, NOW + INTERVAL * TOTAL);
  assert.deepEqual(plan.escrows.map((e) => e.milestoneId), ["m1", "m2", "m3"]);
  assert.deepEqual(plan.escrows.map((e) => e.condition), [c1, c2, c3]);
  for (const e of plan.escrows) assert.equal(e.cancelAfter, plan.maturity - INTERVAL);
});

test("conditions as Record or {milestoneId, condition}[] map to the same plan; lowercase is normalized", () => {
  const byIndex = planLoanClose(base()).escrows.map((e) => e.condition);
  const rec = planLoanClose(base({ conditions: { m3: c3, m1: c1.toLowerCase(), m2: c2 } })).escrows.map((e) => e.condition);
  const pairs = planLoanClose(base({ conditions: [{ milestoneId: "m2", condition: c2 }, { milestoneId: "m1", condition: c1 }, { milestoneId: "m3", condition: c3 }] }))
    .escrows.map((e) => e.condition);
  assert.deepEqual(rec, byIndex);
  assert.deepEqual(pairs, byIndex);
});

test("cancelAfters[i] overrides milestone.cancelAfter, which overrides defaultCancelAfter", () => {
  const plan = planLoanClose(
    base({
      milestones: [
        { id: "m1", amount: "4000", cancelAfter: iso(600) },
        { id: "m2", amount: "3000", cancelAfter: iso(600) },
        { id: "m3", amount: "3000" },
      ],
      cancelAfters: [iso(150), undefined as unknown as string, iso(1000)], // hole → milestone.cancelAfter
      defaultCancelAfter: NOW + 700,
    }),
  );
  assert.deepEqual(plan.escrows.map((e) => e.cancelAfter), [NOW + 150, NOW + 600, NOW + 1000]);
});

test("duplicate condition within the call is rejected", () => {
  const out = issues(base({ conditions: [c1, c2, c1] }));
  assert.equal(out.length, 1);
  assert.match(out[0]!, /m3.*duplicate condition \(same as milestone m1\)/);
  // case-insensitive
  assert.match(issues(base({ conditions: [c1, c1.toLowerCase(), c3] }))[0]!, /m2.*duplicate condition/);
});

test("condition already used by an open escrow of the SPV is rejected", () => {
  const out = issues(base({ existingConditions: [c2.toLowerCase()] }));
  assert.deepEqual(out.length, 1);
  assert.match(out[0]!, /m2.*already used by an open escrow/);
});

test("bad condition format: fulfillment, short, empty-preimage condition, garbage, missing", () => {
  const empty = "A0258020E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855810100";
  const out = issues(base({ conditions: [c1.slice(0, 76), empty, "A0228020" + "00".repeat(32)] }));
  assert.equal(out.length, 3);
  for (const s of out) assert.match(s, /not a 32-byte PREIMAGE-SHA-256 condition/);
  assert.match(issues(base({ conditions: [c1, c2] })).join("\n"), /conditions has 2 entries for 3 milestones[\s\S]*m3.*missing condition/);
  assert.match(issues(base({ conditions: { m1: c1, m2: c2, m3: c3, m4: c1.replace(/^(.{8})./, "$1F") } })).join("\n"), /unknown milestone m4/);
});

test("CancelAfter at or after loan maturity is rejected", () => {
  const out = issues(base({ cancelAfters: [iso(300), iso(1200), iso(5000)] }));
  assert.equal(out.length, 2);
  assert.match(out[0]!, /m2.*must be before loan maturity/);
  assert.match(out[1]!, /m3.*must be before loan maturity/);
  // a defaultCancelAfter past maturity hits every milestone without its own
  assert.equal(issues(base({ defaultCancelAfter: NOW + 30 * 86_400 })).length, 3);
});

test("CancelAfter too close to now (or past) is rejected", () => {
  const out = issues(base({ cancelAfters: [iso(MIN_ESCROW_LIFETIME_S), iso(-10), iso(MIN_ESCROW_LIFETIME_S + 1)] }));
  assert.equal(out.length, 2);
  for (const s of out) assert.match(s, /must be more than 60s after ledger now/);
  assert.match(issues(base({ cancelAfters: ["tomorrow", iso(300), iso(300)] }))[0]!, /not an ISO timestamp/);
  assert.match(issues(base({ cancelAfters: [iso(300)] }))[0]!, /cancelAfters has 1 entries for 3 milestones/);
});

test("PaymentTotal < 2 is rejected", () => {
  assert.match(issues(base({ paymentTotal: 1, cancelAfters: [iso(100), iso(100), iso(100)] })).join("\n"), /PaymentTotal must be an integer ≥ 2, got 1/);
  assert.match(issues(base({ paymentTotal: 2.5 })).join("\n"), /PaymentTotal must be an integer ≥ 2/);
});

test("InterestRate 0 (or > 100%) is rejected", () => {
  assert.match(issues(base({ interestRate: 0 })).join("\n"), /InterestRate must be an integer in \(0, 100000\]/);
  assert.match(issues(base({ interestRate: 100_001 })).join("\n"), /InterestRate/);
});

test("PaymentInterval < 60s, loan past RedemptionDate, zero amounts, duplicate milestone ids", () => {
  assert.match(issues(base({ paymentIntervalS: 30, paymentTotal: 10 })).join("\n"), /PaymentInterval must be an integer ≥ 60s/);
  assert.match(issues(base({ redemptionDate: NOW + INTERVAL * TOTAL + 59 })).join("\n"), /does not fit the vault/);
  assert.doesNotThrow(() => planLoanClose(base({ redemptionDate: NOW + INTERVAL * TOTAL + 60 })));
  const out = issues(
    base({
      milestones: [
        { id: "m1", amount: "0" },
        { id: "m1", amount: "1.1234567" },
        { id: "m3", amount: "3000" },
      ],
      conditions: [c1, c2, c3],
    }),
  );
  assert.match(out.join("\n"), /duplicate milestone id m1/);
  assert.match(out.join("\n"), /amount must be > 0/);
  assert.match(out.join("\n"), /<= 6 decimals/);
});

test("all issues are reported at once", () => {
  const out = issues(base({ paymentTotal: 1, interestRate: 0, conditions: [c1, c1, "x"] }));
  assert.ok(out.length >= 5, out.join("\n"));
});

test("CloseLoanPartialError carries loanId, created escrows, pending milestones and the tx result", () => {
  const cause = new XrplTxError("EscrowCreate", "tecUNFUNDED", "AB".repeat(32));
  const created = [{ milestoneId: "m1", owner: "rSPV", offerSequence: 7, condition: c1, cancelAfter: iso(900), createTx: "CD".repeat(32) }];
  const e = new CloseLoanPartialError("LOAN1", "EF".repeat(32), created, ["m2", "m3"], cause);
  assert.ok(e instanceof LedgerError);
  assert.equal(e.code, "ledger_error");
  assert.equal(e.txResult, "tecUNFUNDED");
  assert.equal(e.txHash, "AB".repeat(32));
  assert.equal(e.loanId, "LOAN1");
  assert.deepEqual(e.created, created);
  assert.deepEqual(e.pending, ["m2", "m3"]);
  assert.match(e.message, /loan LOAN1.*milestone m2 failed.*Created: \[m1@7\]; pending: \[m2, m3\]/);
});
