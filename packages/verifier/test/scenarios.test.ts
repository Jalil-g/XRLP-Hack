// End-to-end in mock mode: fixtures -> verifyMilestone -> shared Verdict.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { Verdict } from "@xrlp/shared";
import { verifyBuilder, verifyMilestone, verifyMilestoneDetailed, type MilestoneJudge } from "../src/index.ts";
import { unavailableJudgement } from "../src/llm/types.ts";
import { evidenceBundleHash } from "../src/audit.ts";
import { builder, builderOnboardingInput, FIXTURES_DIR, SCENARIOS } from "../fixtures/scenarios.ts";

for (const s of SCENARIOS) {
  test(`scenario ${s.key}: ${s.title} -> ${s.expect}`, { skip: s.pending && `needs ${s.pending}` }, async () => {
    const v = await verifyMilestone({ ...(await s.input()), mode: "mock" });
    assert.doesNotThrow(() => Verdict.parse(v));
    assert.equal(v.decision, s.expect, v.summary);
    assert.equal(v.model, "mock");
  });
}

test("scenario B flags exactly the copied photo by pHash alone (its EXIF date is fresh)", async () => {
  const v = await verifyMilestone({ ...(await SCENARIOS[1]!.input()), mode: "mock" });
  const dup = v.checks.find((c) => c.check === "no_duplicate_photo")!;
  const fresh = v.checks.find((c) => c.check === "photo_fresh")!;
  assert.equal(dup.result, "fail");
  assert.deepEqual(dup.evidenceIds, ["ev_IMG_5121"]);
  assert.match(dup.reason, /Oak Ave/);
  assert.equal(fresh.result, "pass");
});

for (const s of SCENARIOS) {
  test(`scenario ${s.key} matches the manifest: failing and warning checks`, async () => {
    const v = await verifyMilestone({ ...(await s.input()), mode: "mock" });
    const by = (r: string) => v.checks.filter((c) => c.result === r).map((c) => c.check);
    // audit checks arrive with VER-03; the manifest already lists them
    const known = (names: string[]) => names.filter((n) => v.checks.some((c) => c.check === n));
    for (const f of known(s.failingChecks)) assert.ok(by("fail").includes(f), `${f} should fail: ${v.summary}`);
    for (const w of known(s.warnChecks)) assert.ok(by("warn").includes(w), `${w} should warn`);
  });
}

test("manifest.json mirrors the scenarios", async () => {
  const m = JSON.parse(await readFile(join(FIXTURES_DIR, "manifest.json"), "utf8"));
  assert.equal(m.scenarios.length, SCENARIOS.length);
  for (const s of SCENARIOS) {
    const e = m.scenarios.find((x: { key: string }) => x.key === s.key);
    assert.deepEqual(e.evidence, s.evidencePaths);
    assert.equal(e.expect, s.expect);
    assert.deepEqual(e.failingChecks, s.failingChecks);
    assert.equal(e.audit, s.auditPath);
  }
});

test("inspector audits are bound to the exact evidence bundle they cover", async () => {
  for (const s of SCENARIOS.filter((x) => x.auditPath)) {
    const [audit] = await s.audits();
    const bundle = (await s.input()).evidence;
    assert.equal(audit!.evidenceBundleHash, evidenceBundleHash(bundle), `scenario ${s.key}`);
    assert.match(audit!.txHash!, /^[0-9A-F]{64}$/);
  }
  const [foundation, framing] = [await SCENARIOS[0]!.audits(), await SCENARIOS[1]!.audits()];
  assert.ok(foundation[0]!.checklist.every((l) => l.status === "done"));
  assert.deepEqual(framing[0]!.checklist.filter((l) => l.status !== "done").map((l) => l.sovCode), ["FR-03"]);
  assert.deepEqual(await SCENARIOS[4]!.audits(), [], "scenario E has no audit");
});

test("changing one evidence file breaks the audit binding", async () => {
  const s = SCENARIOS[0]!;
  const [audit] = await s.audits();
  const bundle = (await s.input()).evidence.slice(1);
  assert.notEqual(audit!.evidenceBundleHash, evidenceBundleHash(bundle));
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
