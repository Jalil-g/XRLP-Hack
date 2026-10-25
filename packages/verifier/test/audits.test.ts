import assert from "node:assert/strict";
import { test } from "node:test";
import type { InspectorAudit } from "@xrlp/shared";
import { verifyMilestone } from "../src/index.ts";
import { SCENARIOS } from "../fixtures/scenarios.ts";

const auditCheck = async (mutate: (a: InspectorAudit) => InspectorAudit) => {
  const input = await SCENARIOS[0]!.input();
  return verifyMilestone({ ...input, audits: [mutate(structuredClone(input.audits![0]!))], mode: "mock" });
};

for (const [name, mutate] of [
  ["unassigned signer", (a: InspectorAudit) => ({ ...a, inspector: "r9cZA1mLK5R5Am25ArfXFmqgNwjZgnfk59" })],
  ["wrong milestone", (a: InspectorAudit) => ({ ...a, milestoneId: "another" })],
  ["stale evidence bundle", (a: InspectorAudit) => ({ ...a, evidenceBundleHash: "0".repeat(64) })],
  ["no tx", (a: InspectorAudit) => ({ ...a, txHash: undefined })],
  ["malformed tx", (a: InspectorAudit) => ({ ...a, txHash: "not-attested" })],
] as const) {
  test(`audit gate rejects ${name}`, async () => {
    const verdict = await auditCheck(mutate);
    assert.equal(verdict.decision, "fail");
    assert.equal(verdict.checks.find((c) => c.check === "inspector_audit_present")!.result, "fail");
  });
}

for (const [name, mutate, expected] of [
  ["missing line", (a: InspectorAudit) => ({ ...a, checklist: a.checklist.slice(1) }), "fail"],
  ["duplicate line", (a: InspectorAudit) => ({ ...a, checklist: [...a.checklist, a.checklist[0]!] }), "fail"],
  ["unrelated line", (a: InspectorAudit) => ({ ...a, checklist: [...a.checklist, { sovCode: "other", status: "done" as const }] }), "fail"],
  ["not done", (a: InspectorAudit) => ({ ...a, checklist: a.checklist.map((line) => ({ ...line, status: "not_done" as const })) }), "fail"],
  ["partial", (a: InspectorAudit) => ({ ...a, checklist: a.checklist.map((line) => ({ ...line, status: "partial" as const })) }), "warn"],
] as const) {
  test(`audit checklist handles ${name}`, async () => {
    const verdict = await auditCheck(mutate);
    assert.equal(verdict.checks.find((c) => c.check === "audit_checklist_complete")!.result, expected);
    assert.notEqual(verdict.decision, "pass");
  });
}

test("audits cannot supply their own trusted assignment or count the same inspector twice", async () => {
  const input = await SCENARIOS[0]!.input();
  const missing = await verifyMilestone({ ...input, assignedInspectors: undefined, mode: "mock" });
  assert.equal(missing.decision, "fail");
  const duplicate = await verifyMilestone({ ...input, audits: [input.audits![0]!, input.audits![0]!], builder: { ...input.builder, riskTier: "high" }, mode: "mock" });
  assert.equal(duplicate.decision, "fail");
  const second = { ...input.audits![0]!, inspector: input.assignedInspectors![1]!, txHash: "B".repeat(64) };
  const valid = await verifyMilestone({ ...input, audits: [input.audits![0]!, second], builder: { ...input.builder, riskTier: "high" }, mode: "mock" });
  assert.equal(valid.checks.find((c) => c.check === "inspector_audit_present")!.result, "pass");
});

test("cross-project duplicates cannot hide behind a colliding evidence ID", async () => {
  const input = await SCENARIOS[0]!.input();
  const verdict = await verifyMilestone({ ...input, priorEvidence: [{ evidence: input.evidence[0]!, projectId: "other", milestoneId: "other" }], mode: "mock" });
  assert.equal(verdict.checks.find((c) => c.check === "no_duplicate_photo")!.result, "fail");
});

test("missing or unknown SoV context does not pass the checklist gate", async () => {
  const input = await SCENARIOS[0]!.input();
  const verdict = await verifyMilestone({ ...input, milestone: { ...input.milestone, sovCodes: [] }, mode: "mock" });
  assert.equal(verdict.decision, "needs_human");
});
