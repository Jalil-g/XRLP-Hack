import assert from "node:assert/strict";
import { test } from "node:test";
import type { VerifierPort } from "@xrlp/shared";
import type { VerifierPort as LegacyCorePort } from "../../core/src/ports.ts";
import { evaluateRelease } from "../../core/src/release-policy.ts";
import { createCore } from "../../core/src/factory.ts";
import { ClaudeVerifierAdapter } from "../src/index.ts";
import { FIX, FIXTURES_DIR, project, SCENARIOS } from "../fixtures/scenarios.ts";
import { projectInput } from "../fixtures/project-scenarios.ts";

test("adapter satisfies actual shared and legacy core ports, and real core release gate passes/fails the fixtures", async () => {
  const adapter = new ClaudeVerifierAdapter({ mode: "mock", dataDir: FIXTURES_DIR, now: () => FIX.times.now });
  const port: VerifierPort = adapter;
  const legacy: LegacyCorePort = adapter;
  const core = createCore({ inMemory: true, verifier: legacy });
  assert.equal(core.verifier, adapter);
  for (const scenario of SCENARIOS) {
    const input = await scenario.input();
    const policy = adapter.policyFor(input.project, input.builder, input.milestone); // 3-arg overload on the adapter (core's port is v2 now)
    assert.equal(policy.riskTier, input.builder.riskTier);
    const verdict = await adapter.verifyMilestone(input);
    assert.equal(verdict.decision, scenario.expect, verdict.summary);
    assert.equal(port.verdictHash(verdict).length, 64);
    const gate = evaluateRelease({ milestoneId: input.milestone.id, verdict, policy: port.policyFor(input.project, input.milestone), audits: input.audits!, assignedInspectors: input.assignedInspectors! });
    // Before project verification, two-argument policy is conservative; install verified risk below.
    if (scenario.key !== "A") assert.notEqual(gate.outcome, "pass");
  }
  const verified = await adapter.verifyProject(projectInput());
  assert.equal(verified.decision, "pass");
  const input = await SCENARIOS[0]!.input();
  const policy = port.policyFor(input.project, input.milestone);
  const verdict = await adapter.verifyMilestone({ ...input, policy });
  const gate = evaluateRelease({ milestoneId: input.milestone.id, verdict, policy, audits: input.audits!, assignedInspectors: input.assignedInspectors! });
  assert.equal(gate.outcome, "pass");
});

test("server assignment resolver wins over supplied audits and legacy missing context cannot pass", async () => {
  const input = await SCENARIOS[0]!.input();
  const adapter = new ClaudeVerifierAdapter({ mode: "mock", assignedInspectors: () => ["different-trusted-inspector"] });
  assert.equal((await adapter.verifyMilestone(input)).decision, "fail");
  const legacy = await new ClaudeVerifierAdapter({ mode: "mock" }).verifyMilestone({ ...input, audits: undefined, assignedInspectors: undefined });
  assert.equal(legacy.decision, "fail");
});

test("judge exceptions fail closed at the real adapter boundary", async () => {
  const input = await SCENARIOS[0]!.input();
  const adapter = new ClaudeVerifierAdapter({ mode: "live", judge: { judgeMilestone: async () => { throw new Error("synthetic transport failure"); } } });
  const result = await adapter.verifyMilestone(input);
  assert.equal(result.decision, "needs_human");
  assert.equal(result.confidence, 0);
  assert.equal(adapter.policyFor(project, input.milestone).riskTier, "high");
});
