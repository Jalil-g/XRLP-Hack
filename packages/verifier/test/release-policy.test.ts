import assert from "node:assert/strict";
import { test } from "node:test";
import { ReleasePolicy } from "@xrlp/shared";
import { releasePolicyFor } from "../src/index.ts";
import { project } from "../fixtures/scenarios.ts";

for (const type of ["residential_new", "residential_renovation", "commercial_small"] as const) {
  for (const [tier, confidence] of [["low", 0.7], ["medium", 0.8], ["high", 0.9]] as const) {
    test(`release policy ${type}/${tier} is typed, deterministic and retains audit gates`, () => {
      const p = { ...project, type };
      const before = JSON.stringify(p);
      const result = releasePolicyFor(p, project.milestones[0]!, tier);
      ReleasePolicy.parse(result);
      assert.equal(result.minConfidence, confidence);
      assert.equal(result.requiredAudits, tier === "high" ? 2 : 1);
      for (const gate of ["inspector_audit_present", "audit_checklist_complete", "audit_matches_evidence", "no_duplicate_photo", "stage_visually_consistent"]) assert.ok(result.requiredChecks.includes(gate));
      assert.deepEqual(releasePolicyFor(p, project.milestones[0]!, tier), result);
      assert.equal(JSON.stringify(p), before);
    });
  }
}

test("two-audit threshold is inclusive and unknown risk remains conservative", () => {
  const m = project.milestones[0]!;
  assert.equal(releasePolicyFor(project, { ...m, amount: "49999.99" }, "medium").requiredAudits, 1);
  assert.equal(releasePolicyFor(project, { ...m, amount: "50000" }, "medium").requiredAudits, 2);
  assert.equal(releasePolicyFor(project, { ...m, amount: "50000" }, "medium").minConfidence, 0.85);
  assert.equal(releasePolicyFor(project, m).riskTier, "high");
});

test("known SoV evidence determines document/invoice optionality; unknown context does not weaken it", () => {
  const m = project.milestones[0]!;
  const p = { ...project, sov: [{ code: "PHOTO", title: "Photos", amount: m.amount, trade: "concrete", evidence: [{ kind: "photo" as const, minCount: 1, description: "Photo" }], visualCriteria: ["Foundation"] }] };
  const result = releasePolicyFor(p, { ...m, sovCodes: ["PHOTO"] }, "medium");
  assert.ok(result.optionalChecks.includes("invoice_matches_budget"));
  assert.ok(!result.requiredChecks.includes("invoice_matches_budget"));
  const unknown = releasePolicyFor(p, { ...m, sovCodes: ["UNKNOWN"] }, "medium");
  assert.ok(unknown.requiredChecks.includes("invoice_matches_budget"));
});
