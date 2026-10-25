// XRPL-07 pure logic: LoanPay mode/amount planning, cancel + withdraw timing (injected ledger time),
// wrong-fulfillment gating, escrow amount from metadata. No network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { LoanPayFlags } from "xrpl";
import { fulfillmentMatches } from "../src/condition.ts";
import { testConditionPair } from "./support/conditions.ts";
import { cancelReadiness, escrowAmountFromMeta, wrongFinishBlockers, wrongFulfillmentFor } from "../src/escrow.ts";
import { ceilMicro, LoanPayAmountError, loanPayFlags, LSF_LOAN_OVERPAYMENT, planLoanPayment } from "../src/loan.ts";
import { evaluatePreflight, type PreflightSnapshot } from "../src/preflight.ts";
import { withdrawPhaseCheck, VAULT_KIND_CLOSED_ENDED, type VaultLedgerEntry } from "../src/vault.ts";

const NOW = 800_000_000;
// Shape of a devnet Loan after LoanSet (proof-devnet-2026-10-24: 30000 over 4 payments).
const LOAN = {
  PeriodicPayment: "7500.017836764691587",
  LoanServiceFee: undefined,
  TotalValueOutstanding: "30000.071347058766348",
  PaymentRemaining: 4,
  NextPaymentDueDate: NOW + 300,
  Flags: LSF_LOAN_OVERPAYMENT,
};

test("ceilMicro rounds ledger decimals up to 6 dp", () => {
  assert.equal(ceilMicro("7500.017836764691587"), 7_500_017_837n);
  assert.equal(ceilMicro("7500.017836"), 7_500_017_836n);
  assert.equal(ceilMicro("1e-7"), 1n);
  assert.equal(ceilMicro("2E3"), 2_000_000_000n);
  assert.equal(ceilMicro(undefined), 0n);
});

test("planLoanPayment: default = one periodic payment, regular, rounded up", () => {
  const p = planLoanPayment({ loan: LOAN, nowRipple: NOW });
  assert.deepEqual([p.amount, p.mode, p.minimum, p.late, p.overpaymentAllowed], ["7500.017837", "regular", "7500.017837", false, true]);
  assert.equal(p.outstanding, "30000.071348");
});

test("planLoanPayment: service fee is part of the minimum", () => {
  const p = planLoanPayment({ loan: { ...LOAN, LoanServiceFee: "1.5" }, nowRipple: NOW });
  assert.equal(p.minimum, "7501.517837");
});

test("planLoanPayment: escrow_refund above one periodic payment -> overpayment", () => {
  const p = planLoanPayment({ loan: LOAN, nowRipple: NOW, amount: "9000", source: "escrow_refund" });
  assert.equal(p.mode, "overpayment");
});

test("planLoanPayment: builder source stays regular even above one periodic payment", () => {
  assert.equal(planLoanPayment({ loan: LOAN, nowRipple: NOW, amount: "9000", source: "builder" }).mode, "regular");
});

test("planLoanPayment: refund equal to one periodic payment -> regular", () => {
  assert.equal(planLoanPayment({ loan: LOAN, nowRipple: NOW, amount: "7500.017837", source: "escrow_refund" }).mode, "regular");
});

test("planLoanPayment: past NextPaymentDueDate -> late (even for a refund)", () => {
  const p = planLoanPayment({ loan: LOAN, nowRipple: LOAN.NextPaymentDueDate + 1, amount: "9000", source: "escrow_refund" });
  assert.deepEqual([p.mode, p.late], ["late", true]);
  assert.equal(planLoanPayment({ loan: LOAN, nowRipple: LOAN.NextPaymentDueDate }).mode, "regular"); // due second itself is on time
});

test("planLoanPayment: loan without lsfLoanOverpayment -> refund pays regular; explicit overpayment refused", () => {
  const loan = { ...LOAN, Flags: 0 };
  assert.equal(planLoanPayment({ loan, nowRipple: NOW, amount: "9000", source: "escrow_refund" }).mode, "regular");
  assert.throws(() => planLoanPayment({ loan, nowRipple: NOW, amount: "9000", mode: "overpayment" }), LoanPayAmountError);
});

test("planLoanPayment: explicit mode wins", () => {
  assert.equal(planLoanPayment({ loan: LOAN, nowRipple: NOW, amount: "9000", mode: "overpayment" }).mode, "overpayment");
});

test("planLoanPayment: below one periodic payment -> LoanPayAmountError (code validation), unless skipAmountCheck", () => {
  assert.throws(
    () => planLoanPayment({ loan: LOAN, nowRipple: NOW, amount: "1000", mode: "overpayment" }),
    (e: unknown) => e instanceof LoanPayAmountError && e.code === "validation" && e.minimum === "7500.017837" && /tecINSUFFICIENT_PAYMENT/.test(e.message),
  );
  assert.throws(() => planLoanPayment({ loan: LOAN, nowRipple: NOW, amount: "7500.017836" }), LoanPayAmountError);
  assert.equal(planLoanPayment({ loan: LOAN, nowRipple: NOW, amount: "1000", mode: "overpayment", skipAmountCheck: true }).amount, "1000");
});

test("planLoanPayment: above everything outstanding -> refused (except mode full)", () => {
  assert.throws(() => planLoanPayment({ loan: LOAN, nowRipple: NOW, amount: "30001", source: "escrow_refund" }), LoanPayAmountError);
  assert.equal(planLoanPayment({ loan: LOAN, nowRipple: NOW, amount: "30001", mode: "full" }).mode, "full");
});

test("planLoanPayment: last payment smaller than PeriodicPayment -> minimum = outstanding", () => {
  const loan = { ...LOAN, PaymentRemaining: 1, TotalValueOutstanding: "500.25" };
  const p = planLoanPayment({ loan, nowRipple: NOW });
  assert.deepEqual([p.amount, p.minimum], ["500.25", "500.25"]);
});

test("planLoanPayment: paid-off loan and non-positive / >6dp amounts are refused", () => {
  assert.throws(() => planLoanPayment({ loan: { ...LOAN, PaymentRemaining: 0, TotalValueOutstanding: "0" }, nowRipple: NOW }), /fully repaid/);
  assert.throws(() => planLoanPayment({ loan: LOAN, nowRipple: NOW, amount: "0" }), LoanPayAmountError);
  assert.throws(() => planLoanPayment({ loan: LOAN, nowRipple: NOW, amount: "9000.0000001" }), /6 decimals/);
});

test("loanPayFlags maps modes to LoanPay flags", () => {
  assert.equal(loanPayFlags("regular"), 0);
  assert.equal(loanPayFlags(), 0);
  assert.equal(loanPayFlags("overpayment"), LoanPayFlags.tfLoanOverpayment);
  assert.equal(loanPayFlags("full"), LoanPayFlags.tfLoanFullPayment);
  assert.equal(loanPayFlags("late"), LoanPayFlags.tfLoanLatePayment);
});

test("cancelReadiness: ledger close time must be strictly after CancelAfter", () => {
  const esc = { CancelAfter: NOW };
  assert.deepEqual(cancelReadiness(esc, NOW - 10), { ok: false, reason: "too_soon", secondsLeft: 11, message: `CancelAfter ${NOW} not passed (ledger now ${NOW - 10}, 11s to go)` });
  const at = cancelReadiness(esc, NOW);
  assert.equal(at.ok, false);
  assert.deepEqual(cancelReadiness(esc, NOW + 1), { ok: true, secondsPast: 1 });
  assert.equal((cancelReadiness(null, NOW) as { reason: string }).reason, "escrow_not_found");
  assert.equal((cancelReadiness({}, NOW) as { reason: string }).reason, "no_cancel_after");
});

const vault = (o: Partial<VaultLedgerEntry> = {}): VaultLedgerEntry => ({
  index: "V1",
  Owner: "rOwner",
  Account: "rPseudo",
  Asset: { currency: "RLUSD", issuer: "rIssuer" },
  ShareMPTID: "00",
  VaultKind: VAULT_KIND_CLOSED_ENDED,
  SubscriptionDate: NOW,
  RedemptionDate: NOW + 600,
  ...o,
});

test("withdrawPhaseCheck: blocked only in the Investment phase (ledger time)", () => {
  assert.deepEqual(withdrawPhaseCheck(vault(), NOW), { ok: true, phase: "subscription" });
  const inv = withdrawPhaseCheck(vault(), NOW + 1);
  assert.equal(inv.ok, false);
  assert.equal(!inv.ok && inv.secondsLeft, 599);
  assert.match(!inv.ok ? inv.message : "", /RedemptionDate/);
  assert.equal(withdrawPhaseCheck(vault(), NOW + 599).ok, false);
  assert.deepEqual(withdrawPhaseCheck(vault(), NOW + 600), { ok: true, phase: "redemption" });
  assert.deepEqual(withdrawPhaseCheck(vault({ VaultKind: 0 }), NOW + 1), { ok: true, phase: "open" });
});

test("escrowAmountFromMeta reads the DeletedNode Escrow amount", () => {
  const meta = {
    AffectedNodes: [
      { ModifiedNode: { LedgerEntryType: "AccountRoot", FinalFields: {} } },
      { DeletedNode: { LedgerEntryType: "Escrow", FinalFields: { Amount: { currency: "RLUSD", issuer: "rI", value: "4000" } } } },
    ],
  };
  assert.equal(escrowAmountFromMeta(meta), "4000");
  assert.equal(escrowAmountFromMeta({ AffectedNodes: [{ DeletedNode: { LedgerEntryType: "Escrow", FinalFields: { Amount: "1000000" } } }] }), "1000000");
  assert.equal(escrowAmountFromMeta({}), undefined);
});

test("wrongFulfillmentFor never satisfies the condition", () => {
  const { condition, fulfillment } = testConditionPair();
  for (let i = 0; i < 20; i++) {
    const wrong = wrongFulfillmentFor(condition);
    assert.equal(wrong.length, fulfillment.length);
    assert.equal(fulfillmentMatches(condition, wrong), false);
  }
});

const { condition } = testConditionPair();
function wrongSnap(o: Partial<PreflightSnapshot> = {}): PreflightSnapshot {
  return {
    request: { owner: "rSpv", offerSequence: 7, submitter: "rPlatform" },
    escrow: { Account: "rSpv", Destination: "rBuilder", Amount: { currency: "RLUSD", issuer: "rIssuer", value: "100" }, Condition: condition, CancelAfter: NOW + 3600 },
    destinationAccount: { address: "rBuilder", balance: "1000000", flags: 0 },
    trustline: null, // no trust line: irrelevant for a wrong-fulfillment try (condition is checked first)
    issuerAccount: { address: "rIssuer", balance: "1000000", flags: 0 },
    submitterAccount: { address: "rPlatform", balance: "1000000", flags: 0 },
    baseFeeDrops: 1,
    ...o,
  };
}
const nowL = { ledgerIndex: 100, closeTime: NOW };

test("wrongFinishBlockers: go when the escrow is open (trust line / condition ignored)", () => {
  assert.deepEqual(wrongFinishBlockers(evaluatePreflight(wrongSnap(), nowL)), []);
});

test("wrongFinishBlockers: refuse a missing escrow", () => {
  assert.deepEqual(wrongFinishBlockers(evaluatePreflight(wrongSnap({ escrow: null }), nowL)).map((b) => b.reason), ["escrow_not_found"]);
});

test("wrongFinishBlockers: refuse an expired / about-to-expire escrow", () => {
  const exp = wrongSnap({ escrow: { ...wrongSnap().escrow!, CancelAfter: NOW - 5 } });
  assert.deepEqual(wrongFinishBlockers(evaluatePreflight(exp, nowL)).map((b) => b.reason), ["expired_or_too_close"]);
  const close = wrongSnap({ escrow: { ...wrongSnap().escrow!, CancelAfter: NOW + 10 } });
  assert.deepEqual(wrongFinishBlockers(evaluatePreflight(close, nowL)).map((b) => b.reason), ["expired_or_too_close"]);
  // Inside preflight's 120 s release margin but > 30 s: a wrong try is still fine.
  const inside = wrongSnap({ escrow: { ...wrongSnap().escrow!, CancelAfter: NOW + 90 } });
  assert.deepEqual(wrongFinishBlockers(evaluatePreflight(inside, nowL)), []);
});

test("wrongFinishBlockers: refuse an unfunded submitter", () => {
  const s = wrongSnap({ submitterAccount: { address: "rPlatform", balance: "1", flags: 0 } });
  assert.deepEqual(wrongFinishBlockers(evaluatePreflight(s, nowL)).map((b) => b.reason), ["submitter_unfunded"]);
});
