import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { ReleasePolicy, Verdict } from "@xrlp/shared";
import { canonicalJson, decide, policyFor, verdictHash, verifyMilestone } from "../src/index.ts";
import type { CheckOutcome } from "../src/types.ts";
import { builder, project, SCENARIOS } from "../fixtures/scenarios.ts";

const verdict: Verdict = { milestoneId: "m1", decision: "pass", confidence: 0.9, summary: "Ready", checks: [], policy: { projectType: "residential_new", riskTier: "medium", requiredInspectors: 1 }, model: "mock", createdAt: "2026-10-24T20:00:00Z" };
const snapshot = '{"checks":[],"confidence":0.9,"createdAt":"2026-10-24T20:00:00Z","decision":"pass","milestoneId":"m1","model":"mock","policy":{"projectType":"residential_new","requiredInspectors":1,"riskTier":"medium"},"summary":"Ready"}';

test("canonical verdict snapshot and hash agree, independently of property insertion order", () => {
  assert.equal(canonicalJson(verdict), snapshot);
  assert.equal(verdictHash(verdict), createHash("sha256").update(snapshot).digest("hex"));
  const reordered = Object.fromEntries(Object.entries(verdict).reverse()) as Verdict;
  reordered.policy = { requiredInspectors: 1, riskTier: "medium", projectType: "residential_new" };
  assert.equal(verdictHash(reordered), verdictHash(verdict));
  assert.notEqual(verdictHash({ ...verdict, decision: "fail" }), verdictHash(verdict));
  assert.notEqual(verdictHash({ ...verdict, createdAt: "2026-10-25T20:00:00Z" }), verdictHash(verdict));
  assert.equal(canonicalJson({ z: [2, 1], a: { z: 1, a: 2 } }), '{"a":{"a":2,"z":1},"z":[2,1]}');
  assert.equal(canonicalJson(Array(2)), "[null,null]");
  assert.throws(() => canonicalJson({ bad: NaN }));
  const cycle: Record<string, unknown> = {}; cycle.self = cycle;
  assert.throws(() => canonicalJson(cycle), /cycles/);
});

test("required fail always blocks, skipped/missing/low confidence need human; optional warning does not lower passing confidence", () => {
  const policy = policyFor(project, builder, project.milestones[0]!);
  const release: ReleasePolicy = { riskTier: "medium", requiredAudits: 1, requiredChecks: ["gps_within_site"], optionalChecks: ["lien_waiver_matches_invoices"], minConfidence: 0.8 };
  const o = (result: CheckOutcome["result"], confidence = 0.99): CheckOutcome => ({ check: "gps_within_site", result, confidence, reason: "test", source: "deterministic", evidenceIds: [] });
  assert.equal(decide([o("fail")], policy, release).decision, "fail");
  assert.equal(decide([o("skipped")], policy, release).decision, "needs_human");
  assert.equal(decide([], policy, release).decision, "needs_human");
  assert.equal(decide([], policy, { ...release, requiredChecks: [] }).decision, "needs_human");
  assert.equal(decide([o("pass", 0.7)], policy, release).decision, "needs_human");
  const optional = { ...o("warn", 0.3), check: "lien_waiver_matches_invoices" };
  const result = decide([o("pass"), optional], policy, release);
  assert.equal(result.decision, "pass");
  assert.equal(result.confidence, 0.99);
});

test("pinned fixture clock produces byte-stable complete verdicts and attestation hashes", async () => {
  const input = await SCENARIOS[0]!.input();
  const a = await verifyMilestone({ ...input, mode: "mock" });
  const b = await verifyMilestone({ ...input, mode: "mock" });
  assert.equal(a.decision, "pass");
  assert.deepEqual(a, b);
  assert.equal(verdictHash(a), verdictHash(b));
  const weak = await verifyMilestone({ ...input, audits: [], policy: { riskTier: "low", requiredChecks: [], optionalChecks: [], requiredAudits: 1, minConfidence: 0 }, mode: "mock" });
  assert.equal(weak.decision, "fail");
});
