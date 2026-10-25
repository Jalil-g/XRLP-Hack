import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ChainEvent,
  CreateProjectInput,
  InspectorAssignment,
  InspectorAudit,
  LEGACY_MILESTONE_STATUSES,
  LedgerError,
  LOCKED_MILESTONE_V2,
  MILESTONE_CHECKS,
  MILESTONE_STATUSES_V2,
  MILESTONE_TRANSITIONS_V2,
  Milestone,
  MilestoneStatus,
  PROJECT_TRANSITIONS_V2,
  ProjectStatus,
  ProjectVerification,
  ReleasePolicy,
  TooSoonError,
  canMilestoneTransitionV2,
  canProjectTransitionV2,
} from "../src/index.ts";

const ADDR = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const NOW = "2026-10-24T20:00:00.000Z";

test("v1 milestone/project data still parses (additive contract)", () => {
  for (const s of ["ai_reviewed", "inspected", "rejected"]) assert.equal(MilestoneStatus.parse(s), s);
  for (const s of ["draft", "terms_locked", "funding", "funded", "escrowed", "repaying", "completed", "stalled"]) {
    assert.equal(ProjectStatus.parse(s), s);
  }
  const v1 = { id: "m1", index: 0, templateKey: "foundation", title: "Foundation", amount: "9000", requiredInspectors: 1, status: "ai_reviewed" };
  assert.equal(Milestone.parse(v1).status, "ai_reviewed");
});

test("v2 statuses parse; legacy set is disjoint from v2", () => {
  for (const s of MILESTONE_STATUSES_V2) assert.equal(MilestoneStatus.parse(s), s);
  for (const s of ["verifying", "verified", "rejected"]) assert.equal(ProjectStatus.parse(s), s);
  for (const s of LEGACY_MILESTONE_STATUSES) assert.ok(!(MILESTONE_STATUSES_V2 as readonly string[]).includes(s));
});

test("v2 state machines are closed and match docs/03 §State machines", () => {
  for (const [from, tos] of Object.entries(MILESTONE_TRANSITIONS_V2)) {
    for (const to of tos) assert.ok(to in MILESTONE_TRANSITIONS_V2, `${from} -> ${to}`);
  }
  for (const [from, tos] of Object.entries(PROJECT_TRANSITIONS_V2)) {
    for (const to of tos) assert.ok(to in PROJECT_TRANSITIONS_V2, `${from} -> ${to}`);
  }
  // release only from verified; verified only after audit or operator decision
  const intoReleased = Object.entries(MILESTONE_TRANSITIONS_V2).filter(([, t]) => t.includes("released")).map(([f]) => f);
  assert.deepEqual(intoReleased, ["verified"]);
  assert.ok(canMilestoneTransitionV2("audited", "verified"));
  assert.ok(canMilestoneTransitionV2("needs_human", "verified"));
  assert.ok(!canMilestoneTransitionV2("evidence_submitted", "verified"));
  assert.ok(canMilestoneTransitionV2("failed", "evidence_submitted"));
  assert.deepEqual(MILESTONE_TRANSITIONS_V2.released, []);
  assert.deepEqual(MILESTONE_TRANSITIONS_V2.refunded, []);
  assert.ok(!LOCKED_MILESTONE_V2.includes("released"));
  // project: verification gate before funding; escrowed only from funded
  assert.ok(canProjectTransitionV2("draft", "verifying"));
  assert.ok(!canProjectTransitionV2("draft", "terms_locked"));
  assert.ok(canProjectTransitionV2("verified", "terms_locked"));
  assert.ok(!canProjectTransitionV2("funding", "escrowed"));
  assert.ok(canProjectTransitionV2("funded", "escrowed"));
});

test("check ids are unique and include the inspector audit", () => {
  assert.equal(new Set(MILESTONE_CHECKS).size, MILESTONE_CHECKS.length);
  assert.ok(MILESTONE_CHECKS.includes("inspector_audit_present"));
  assert.ok(MILESTONE_CHECKS.includes("no_duplicate_photo"));
});

test("v2 contract objects parse", () => {
  InspectorAudit.parse({
    milestoneId: "m1",
    inspector: ADDR,
    evidenceBundleHash: "ab".repeat(32),
    checklist: [{ sovCode: "foundation", status: "done" }],
    photos: [],
    notes: "Footings poured, anchor bolts set.",
    at: NOW,
  });
  ProjectVerification.parse({
    identity: [{ check: "license_valid", result: "pass", reason: "MOCK registry: active" }],
    feasibility: [],
    capability: [],
    decision: "pass",
    riskTier: "medium",
    summary: "ok",
    model: "mock",
    createdAt: NOW,
  });
  InspectorAssignment.parse({ inspectors: [ADDR], scores: { [ADDR]: 0.9 }, reasons: ["closest licensed inspector"] });
  const policy = ReleasePolicy.parse({ riskTier: "low", requiredChecks: ["inspector_audit_present"], minConfidence: 0.8, requiredAudits: 1 });
  assert.deepEqual(policy.optionalChecks, []);
  assert.throws(() => ReleasePolicy.parse({ riskTier: "low", requiredChecks: [], minConfidence: 0.8, requiredAudits: 3 }));
  CreateProjectInput.parse({
    name: "Maple St duplex",
    type: "residential_new",
    builderId: "b1",
    siteAddress: "12 Maple St",
    siteGeo: { lat: 40.67, lng: -73.94, radiusM: 150 },
    description: "Two-family new build",
    terms: { principal: "120000", interestRateBps: 1000, termDays: 180, paymentIntervalDays: 30, fundingDeadline: NOW },
    sov: [{ code: "foundation", title: "Foundation", amount: "30000", trade: "concrete", evidence: [{ kind: "photo", description: "slab", minCount: 3 }], visualCriteria: ["cured slab"] }],
    documents: [{ kind: "license", filename: "license.pdf" }],
  });
  assert.throws(() => CreateProjectInput.parse({ name: "x" }));
  const ev = ChainEvent.parse({
    projectId: "p1",
    milestoneId: "m2",
    kind: "release_refused",
    txHash: "AB".repeat(32),
    explorerUrl: "https://devnet.xrpl.org/transactions/" + "AB".repeat(32),
    result: "tecCRYPTOCONDITION_ERROR",
    at: NOW,
  });
  assert.equal(ev.result, "tecCRYPTOCONDITION_ERROR");
});

test("ledger errors carry a code and are catchable by base class", () => {
  const e = new TooSoonError("LoanSet before SubscriptionDate", { txResult: "tecTOO_SOON" });
  assert.ok(e instanceof LedgerError);
  assert.equal(e.code, "too_soon");
  assert.equal(e.txResult, "tecTOO_SOON");
  assert.equal(new LedgerError("unsafe_release", "no trust line").code, "unsafe_release");
});

test("v2.1 (#133): new event kinds parse; ledger error codes not_found / validation", () => {
  for (const kind of ["release_attested", "loan_impaired", "builder_payment"] as const) {
    const ev = ChainEvent.parse({ projectId: "p1", kind, txHash: "CD".repeat(32), explorerUrl: "https://devnet.xrpl.org/transactions/" + "CD".repeat(32), at: NOW });
    assert.equal(ev.kind, kind);
  }
  assert.equal(new LedgerError("not_found", "no loan").code, "not_found");
  assert.equal(new LedgerError("validation", "below one periodic payment").code, "validation");
});
