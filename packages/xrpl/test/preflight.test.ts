import assert from "node:assert/strict";
import { test } from "node:test";
import { generateMilestoneCondition } from "../src/condition.ts";
import {
  UNSAFE_RELEASE,
  UnsafeReleaseError,
  assertPreflightOk,
  escrowFinishFee,
  evaluatePreflight,
  hasHeadroom,
  unsafeReleaseError,
  type PreflightSnapshot,
} from "../src/preflight.ts";

const ISSUER = "rIssuer";
const SPV = "rSpv";
const BUILDER = "rBuilder";
const SUBMITTER = "rRelease";
const NOW = { ledgerIndex: 1000, closeTime: 800_000_000 };
const { condition, fulfillment } = generateMilestoneCondition();

function snap(over: Partial<PreflightSnapshot> = {}, req: Partial<PreflightSnapshot["request"]> = {}): PreflightSnapshot {
  return {
    request: { owner: SPV, offerSequence: 7, destination: BUILDER, condition, fulfillment, submitter: SUBMITTER, ...req },
    escrow: {
      Account: SPV,
      Destination: BUILDER,
      Amount: { currency: "524C555344000000000000000000000000000000", issuer: ISSUER, value: "1000" },
      Condition: condition,
      CancelAfter: NOW.closeTime + 3600,
    },
    destinationAccount: { address: BUILDER, balance: "100000000", flags: 0 },
    trustline: { balance: "0", limit: "1000000000", peer_authorized: false },
    issuerAccount: { address: ISSUER, balance: "100000000", flags: 0x00800000 | 0x40000000 },
    submitterAccount: { address: SUBMITTER, balance: "100000000", flags: 0 },
    baseFeeDrops: 10,
    ...over,
  };
}

const reasons = (s: PreflightSnapshot) => evaluatePreflight(s, NOW).failures.map((f) => f.reason);

test("happy path: ok, fee sized for the fulfillment, LLS = validated + offset", () => {
  const r = evaluatePreflight(snap(), NOW);
  assert.equal(r.ok, true, JSON.stringify(r.failures));
  assert.equal(r.code, undefined);
  assert.equal(r.details.conditionChecked, true);
  // 36-byte fulfillment -> 10 × (33 + 3)
  assert.equal(r.details.recommendedFee, "360");
  assert.equal(r.details.lastLedgerSequence, 1020);
  assert.equal(r.details.secondsToCancelAfter, 3600);
});

test("escrow_not_found (finished / cancelled)", () => {
  const r = evaluatePreflight(snap({ escrow: null }), NOW);
  assert.equal(r.ok, false);
  assert.equal(r.reason, "escrow_not_found");
  assert.equal(r.code, UNSAFE_RELEASE);
});

test("expired_or_too_close: past CancelAfter, inside margin, and just outside margin", () => {
  const at = (cancelAfter: number, req = {}) => evaluatePreflight(snap({ escrow: { ...snap().escrow!, CancelAfter: cancelAfter } }, req), NOW);
  assert.equal(at(NOW.closeTime - 5).reason, "expired_or_too_close");
  assert.equal(at(NOW.closeTime).reason, "expired_or_too_close");
  assert.equal(at(NOW.closeTime + 119).reason, "expired_or_too_close"); // default margin 120
  assert.equal(at(NOW.closeTime + 120).ok, true);
  // margin is at least lastLedgerOffset × 5s
  assert.equal(at(NOW.closeTime + 99, { marginS: 30, lastLedgerOffset: 20 }).reason, "expired_or_too_close");
  assert.equal(at(NOW.closeTime + 100, { marginS: 30, lastLedgerOffset: 10 }).ok, true);
});

test("finish_too_early: FinishAfter must be strictly before ledger now", () => {
  const at = (finishAfter: number) => reasons(snap({ escrow: { ...snap().escrow!, FinishAfter: finishAfter } }));
  assert.deepEqual(at(NOW.closeTime), ["finish_too_early"]);
  assert.deepEqual(at(NOW.closeTime - 1), []);
});

test("no_trustline / trustline_limit / frozen / not_authorized", () => {
  assert.deepEqual(reasons(snap({ trustline: null })), ["no_trustline"]);
  assert.deepEqual(reasons(snap({ trustline: undefined })), ["no_trustline"]);
  assert.deepEqual(reasons(snap({ trustline: { balance: "500", limit: "1499.99" } })), ["trustline_limit"]);
  assert.deepEqual(reasons(snap({ trustline: { balance: "500", limit: "1500" } })), []);
  assert.deepEqual(reasons(snap({ trustline: { balance: "0", limit: "1e9", freeze_peer: true } })), ["frozen"]);
  assert.deepEqual(reasons(snap({ trustline: { balance: "0", limit: "1e9", deep_freeze: true } })), ["frozen"]);
  assert.deepEqual(reasons(snap({ issuerAccount: { address: ISSUER, balance: "1", flags: 0x00400000 } })), ["frozen"]);
  assert.deepEqual(reasons(snap({ trustline: null, issuerAccount: { address: ISSUER, balance: "1", flags: 0x00400000 } })), ["no_trustline", "frozen"]);
  const requireAuth = { address: ISSUER, balance: "1", flags: 0x00040000 };
  assert.deepEqual(reasons(snap({ issuerAccount: requireAuth })), ["not_authorized"]);
  assert.deepEqual(reasons(snap({ issuerAccount: requireAuth, trustline: { balance: "0", limit: "1e9", peer_authorized: true } })), []);
});

test("destination_not_found / deposit_auth (submitter preauthorized or is the destination)", () => {
  assert.deepEqual(reasons(snap({ destinationAccount: null })), ["destination_not_found"]);
  const da = { address: BUILDER, balance: "1", flags: 0x01000000 };
  assert.deepEqual(reasons(snap({ destinationAccount: da })), ["deposit_auth"]);
  assert.deepEqual(reasons(snap({ destinationAccount: da, submitterPreauthorized: true })), []);
  assert.deepEqual(reasons(snap({ destinationAccount: da, submitterAccount: { address: BUILDER, balance: "1000", flags: da.flags } }, { submitter: BUILDER })), []);
});

test("condition_mismatch is judged against the ON-LEDGER condition, not the caller's", () => {
  const other = generateMilestoneCondition();
  // Caller passes a self-consistent pair that is NOT the escrow's -> refused.
  assert.deepEqual(reasons(snap({}, { condition: other.condition, fulfillment: other.fulfillment })), ["condition_mismatch", "condition_mismatch"]);
  // Caller omits the condition, fulfillment wrong -> refused.
  assert.deepEqual(reasons(snap({}, { condition: undefined, fulfillment: other.fulfillment })), ["condition_mismatch"]);
  // Lowercase hex is fine.
  assert.deepEqual(reasons(snap({}, { condition: condition.toLowerCase(), fulfillment: fulfillment.toLowerCase() })), []);
  // Escrow has no Condition but a fulfillment would be sent -> refused.
  const { Condition: _drop, ...noCond } = snap().escrow!;
  assert.deepEqual(reasons(snap({ escrow: noCond })), ["condition_mismatch"]);
  // Readiness check without a fulfillment: ok, but conditionChecked=false and fee assumes a 36-byte fulfillment.
  const r = evaluatePreflight(snap({}, { condition: undefined, fulfillment: undefined }), NOW);
  assert.equal(r.ok, true);
  assert.equal(r.details.conditionChecked, false);
  assert.equal(r.details.recommendedFee, "360");
});

test("destination_mismatch", () => {
  assert.deepEqual(reasons(snap({}, { destination: "rSomeoneElse" })), ["destination_mismatch"]);
});

test("submitter_not_found / submitter_unfunded; no submitter = not checked", () => {
  assert.deepEqual(reasons(snap({ submitterAccount: null })), ["submitter_not_found"]);
  assert.deepEqual(reasons(snap({ submitterAccount: { address: SUBMITTER, balance: "359", flags: 0 } })), ["submitter_unfunded"]);
  assert.deepEqual(reasons(snap({ submitterAccount: { address: SUBMITTER, balance: "360", flags: 0 } })), []);
  assert.deepEqual(reasons(snap({ submitterAccount: undefined }, { submitter: undefined })), []);
});

test("unsupported_amount (MPT); XRP escrows skip trust-line checks", () => {
  assert.deepEqual(reasons(snap({ escrow: { ...snap().escrow!, Amount: { mpt_issuance_id: "00", value: "1" } } })), ["unsupported_amount"]);
  assert.deepEqual(reasons(snap({ escrow: { ...snap().escrow!, Amount: "1000000" }, trustline: null })), []);
});

test("first reason is the most fundamental; all failures are listed", () => {
  const r = evaluatePreflight(snap({ trustline: null, submitterAccount: null, escrow: { ...snap().escrow!, CancelAfter: NOW.closeTime - 1 } }), NOW);
  assert.equal(r.reason, "expired_or_too_close");
  assert.deepEqual(r.failures.map((f) => f.reason), ["expired_or_too_close", "no_trustline", "submitter_not_found"]);
});

test("unsafe_release mapping helpers", () => {
  const r = evaluatePreflight(snap({ trustline: null }), NOW);
  assert.deepEqual(unsafeReleaseError(r).error.code, "unsafe_release");
  assert.equal(unsafeReleaseError(r).error.reason, "no_trustline");
  assert.throws(() => assertPreflightOk(r), (e: unknown) => e instanceof UnsafeReleaseError && e.code === "unsafe_release" && e.reason === "no_trustline");
  assert.doesNotThrow(() => assertPreflightOk(evaluatePreflight(snap(), NOW)));
});

test("hasHeadroom is exact on IOU decimals; escrowFinishFee formula", () => {
  assert.equal(hasHeadroom("0.3", "0.1", "0.2"), true); // float would say 0.19999999999999998 < 0.2
  assert.equal(hasHeadroom("1e3", "999.999", "0.001"), true);
  assert.equal(hasHeadroom("1e3", "999.999", "0.0011"), false);
  assert.equal(hasHeadroom("100", "-50", "150"), true);
  assert.equal(escrowFinishFee(1, 36), 36);
  assert.equal(escrowFinishFee(12, 36), 432);
  assert.equal(escrowFinishFee(10), 10);
});
