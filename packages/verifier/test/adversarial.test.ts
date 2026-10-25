import assert from "node:assert/strict";
import { test } from "node:test";
import { MockJudge, verifyMilestone, verifyProject } from "../src/index.ts";
import { projectInput } from "../fixtures/project-scenarios.ts";
import { SCENARIOS } from "../fixtures/scenarios.ts";
import { adversarialInput } from "../fixtures/adversarial-scenarios.ts";
import { milestoneTemplate } from "../src/template.ts";

for (const key of ["image-approved", "audit-instructions", "missing-exif", "wrong-gps", "corrupt-image", "document-instructions"]) {
  test(`adversarial ${key} never auto-passes`, async () => {
    const result = await verifyMilestone({ ...(await adversarialInput(`adversarial-${key}`)), mode: "mock" });
    assert.notEqual(result.decision, "pass");
  });
}

test("locked SoV evidence requirements and visual criteria drive verification, not an unrelated template", async () => {
  const input = await SCENARIOS[0]!.input();
  const lines = structuredClone(input.project.sov!);
  lines[0]!.evidence = [{ kind: "photo", minCount: 4, description: "Four required locked-SoV views" }];
  lines[0]!.visualCriteria = ["specific locked-SoV criterion"];
  input.project = { ...input.project, sov: lines }; input.sov = lines;
  assert.ok(milestoneTemplate(input)!.visualCriteria.includes("specific locked-SoV criterion"));
  const result = await verifyMilestone({ ...input, mode: "mock" }, { judge: new MockJudge() });
  assert.equal(result.checks.find((c) => c.check === "required_evidence_present")!.result, "fail");
  input.sov = structuredClone(lines);
  input.sov[0]!.evidence[0]!.minCount = 1;
  assert.equal(milestoneTemplate(input), undefined, "caller cannot weaken stored SoV");
});

test("a hung project judge also returns needs_human within the configured boundary", async () => {
  const result = await verifyProject({ ...projectInput(), mode: "live" }, { timeoutMs: 15, judge: async () => new Promise(() => {}) });
  assert.equal(result.decision, "needs_human");
});
