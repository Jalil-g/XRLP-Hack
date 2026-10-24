import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CheckResult, InspectorAudit, ReleasePolicy, Verdict } from "@xrlp/shared";
import { evaluateRelease, type ReleaseInput } from "../src/release-policy.ts";

const M = "p1:m1";
const INSPECTOR = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const INSPECTOR_2 = "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe";
const STRANGER = "rLHzPsX6oXkzU2qL12kHCH8G8cnZv1rBJh";
const NOW = "2026-10-24T20:00:00.000Z";

const REQUIRED = ["required_evidence_present", "no_duplicate_photo", "photo_fresh", "inspector_audit_present", "stage_visually_consistent"];
const policy = (over: Partial<ReleasePolicy> = {}): ReleasePolicy => ({
  riskTier: "medium",
  requiredChecks: REQUIRED,
  optionalChecks: [],
  minConfidence: 0.8,
  requiredAudits: 1,
  ...over,
});
const pass = (check: string): CheckResult => ({ check, result: "pass", reason: "ok", evidenceIds: [] });
const verdict = (over: Partial<Verdict> = {}, checks: CheckResult[] = REQUIRED.map(pass)): Verdict => ({
  milestoneId: M,
  decision: "pass",
  confidence: 0.93,
  summary: "",
  checks,
  policy: { projectType: "residential_new", riskTier: "medium", requiredInspectors: 1 },
  model: "mock",
  createdAt: NOW,
  ...over,
});
const audit = (inspector = INSPECTOR, txHash = "AUDITTX", milestoneId = M): InspectorAudit => ({
  milestoneId,
  inspector,
  evidenceBundleHash: "ab",
  checklist: [{ sovCode: "foundation", status: "done" }],
  photos: [],
  notes: "",
  txHash,
  at: NOW,
});
const input = (over: Partial<ReleaseInput> = {}): ReleaseInput => ({
  milestoneId: M,
  verdict: verdict(),
  policy: policy(),
  audits: [audit()],
  assignedInspectors: [INSPECTOR],
  ...over,
});

describe("evaluateRelease (the milestone test suite)", () => {
  it("all green -> pass", () => {
    const r = evaluateRelease(input());
    assert.equal(r.outcome, "pass");
    assert.deepEqual(r.reasons, []);
    assert.equal(r.required.find((c) => c.check === "inspector_audit_present")?.result, "pass");
  });

  it("one red required check -> fail, with the failing check named", () => {
    const checks = REQUIRED.map(pass);
    checks[1] = { check: "no_duplicate_photo", result: "fail", reason: "matches Oak Ave photo", evidenceIds: ["e2"] };
    const r = evaluateRelease(input({ verdict: verdict({ decision: "fail" }, checks) }));
    assert.equal(r.outcome, "fail");
    assert.match(r.reasons.join(), /no_duplicate_photo: matches Oak Ave photo/);
  });

  it("missing audit -> fail even if the verifier says the audit check passed", () => {
    const r = evaluateRelease(input({ audits: [] }));
    assert.equal(r.outcome, "fail");
    assert.match(r.reasons.join(), /no inspector audit on record/);
  });

  it("audit not attested on-chain -> fail", () => {
    const r = evaluateRelease(input({ audits: [{ ...audit(), txHash: undefined }] }));
    assert.equal(r.outcome, "fail");
    assert.match(r.reasons.join(), /not attested/);
  });

  it("audit by an unassigned inspector -> fail", () => {
    const r = evaluateRelease(input({ audits: [audit(STRANGER)] }));
    assert.equal(r.outcome, "fail");
    assert.match(r.reasons.join(), /unassigned inspector/);
  });

  it("audit for another milestone does not count", () => {
    const r = evaluateRelease(input({ audits: [audit(INSPECTOR, "TX", "p1:m2")] }));
    assert.equal(r.outcome, "fail");
  });

  it("two-audit policy with one audit -> fail; with two distinct assigned inspectors -> pass", () => {
    const p = policy({ requiredAudits: 2 });
    const assigned = [INSPECTOR, INSPECTOR_2];
    assert.equal(evaluateRelease(input({ policy: p, assignedInspectors: assigned })).outcome, "fail");
    assert.equal(evaluateRelease(input({ policy: p, assignedInspectors: assigned, audits: [audit(), audit()] })).outcome, "fail");
    assert.equal(evaluateRelease(input({ policy: p, assignedInspectors: assigned, audits: [audit(), audit(INSPECTOR_2)] })).outcome, "pass");
  });

  it("low confidence -> needs_human", () => {
    const r = evaluateRelease(input({ verdict: verdict({ confidence: 0.6 }) }));
    assert.equal(r.outcome, "needs_human");
    assert.match(r.reasons.join(), /confidence 0.6 below 0.8/);
  });

  it("required check warn / missing -> needs_human", () => {
    const checks = REQUIRED.filter((c) => c !== "stage_visually_consistent").map(pass);
    checks[0] = { check: "required_evidence_present", result: "warn", reason: "GPS missing", evidenceIds: [] };
    const r = evaluateRelease(input({ verdict: verdict({}, checks) }));
    assert.equal(r.outcome, "needs_human");
    assert.match(r.reasons.join(), /stage_visually_consistent: skipped/);
  });

  it("verifier decision needs_human with all checks green -> needs_human (never auto-release)", () => {
    assert.equal(evaluateRelease(input({ verdict: verdict({ decision: "needs_human" }) })).outcome, "needs_human");
  });

  it("operator decision resolves needs_human only when attested", () => {
    const v = verdict({ confidence: 0.6 });
    assert.equal(evaluateRelease(input({ verdict: v, operatorDecision: { decision: "approve", reason: "site visit ok" } })).outcome, "needs_human");
    const ok = evaluateRelease(input({ verdict: v, operatorDecision: { decision: "approve", reason: "site visit ok", txHash: "DEC" } }));
    assert.equal(ok.outcome, "pass");
    assert.equal(ok.overridden, true);
    const no = evaluateRelease(input({ verdict: v, operatorDecision: { decision: "reject", reason: "photos unclear", txHash: "DEC" } }));
    assert.equal(no.outcome, "fail");
  });

  it("operator approval can never override a failed check", () => {
    const r = evaluateRelease(input({ audits: [], operatorDecision: { decision: "approve", reason: "trust me", txHash: "DEC" } }));
    assert.equal(r.outcome, "fail");
    assert.equal(r.overridden, false);
  });

  it("no verdict yet -> pending", () => {
    assert.equal(evaluateRelease(input({ verdict: undefined })).outcome, "pending");
  });

  it("checks not in the policy are optional and never block", () => {
    const checks = [...REQUIRED.map(pass), { check: "lien_waiver_matches_invoices", result: "fail" as const, reason: "stretch", evidenceIds: [] }];
    const r = evaluateRelease(input({ verdict: verdict({}, checks) }));
    assert.equal(r.outcome, "pass");
    assert.equal(r.optional[0]?.check, "lien_waiver_matches_invoices");
  });

  it("rejects a verdict for a different milestone", () => {
    assert.throws(() => evaluateRelease(input({ verdict: verdict({ milestoneId: "p1:m9" }) })));
  });
});
