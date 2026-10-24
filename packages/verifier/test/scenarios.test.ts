// End-to-end in mock mode: fixtures -> verifyMilestone -> shared Verdict.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Verdict } from "@xrlp/shared";
import { verifyBuilder, verifyMilestone, verifyMilestoneDetailed, type MilestoneJudge } from "../src/index.ts";
import { unavailableJudgement } from "../src/llm/types.ts";
import { builder, builderOnboardingInput, SCENARIOS } from "../fixtures/scenarios.ts";

for (const s of SCENARIOS) {
  test(`scenario ${s.key}: ${s.title} -> ${s.expect}`, async () => {
    const v = await verifyMilestone({ ...(await s.input()), mode: "mock" });
    assert.doesNotThrow(() => Verdict.parse(v));
    assert.equal(v.decision, s.expect, v.summary);
    assert.equal(v.model, "mock");
  });
}

test("scenario B flags exactly the reused photo, for both reuse and stale date", async () => {
  const v = await verifyMilestone({ ...(await SCENARIOS[1]!.input()), mode: "mock" });
  const dup = v.checks.find((c) => c.check === "no_duplicate_photo")!;
  const fresh = v.checks.find((c) => c.check === "photo_fresh")!;
  assert.equal(dup.result, "fail");
  assert.deepEqual(dup.evidenceIds, ["ev_framing-04-reused"]);
  assert.match(dup.reason, /Oak Ave/);
  assert.equal(fresh.result, "fail");
  assert.deepEqual(fresh.evidenceIds, ["ev_framing-04-reused"]);
});

test("detailed result returns recomputed meta to persist for future dedupe", async () => {
  const r = await verifyMilestoneDetailed({ ...(await SCENARIOS[0]!.input()), mode: "mock" });
  const photos = r.evidence.filter((e) => e.evidence.kind === "photo");
  assert.ok(photos.every((p) => p.meta.perceptualHash && p.sha256));
});

test("AI unavailable (e.g. no key / refusal) never auto-passes: honest submission -> needs_human", async () => {
  const down: MilestoneJudge = { judgeMilestone: async (i) => unavailableJudgement("API error 401", "claude-opus-5-5", i) };
  const v = await verifyMilestone({ ...(await SCENARIOS[0]!.input()) }, { judge: down });
  assert.equal(v.decision, "needs_human");
  assert.match(v.summary, /AI review unavailable/);
});

test("high-risk builder on scenario A needs two inspectors", async () => {
  const input = await SCENARIOS[0]!.input();
  const v = await verifyMilestone({ ...input, builder: { ...builder, riskTier: "high" }, mode: "mock" });
  assert.equal(v.policy.requiredInspectors, 2);
  assert.equal(v.policy.riskTier, "high");
});

test("verifyBuilder: fixture builder passes against MOCK registry; bad license fails", async () => {
  const ok = await verifyBuilder(await builderOnboardingInput());
  assert.equal(ok.decision, "pass", ok.summary);
  assert.equal(ok.registryIsMock, true);
  const bad = await verifyBuilder({ ...(await builderOnboardingInput()), builder: { ...builder, licenseNumber: "NYC-GC-118200" } });
  assert.equal(bad.decision, "fail");
  assert.match(bad.summary, /expired/);
});
