// End-to-end in mock mode: fixtures -> verifyMilestone -> shared Verdict.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { Inspector, InspectorAudit, Verdict } from "@xrlp/shared";
import { extractEvidenceMeta, verifyBuilder, verifyMilestone, verifyMilestoneDetailed, type MilestoneJudge } from "../src/index.ts";
import { unavailableJudgement } from "../src/llm/types.ts";
import { evidenceBundleHash } from "../src/audit.ts";
import { builder, builderOnboardingInput, FIXTURES_DIR, project, SCENARIOS } from "../fixtures/scenarios.ts";

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

test("scenario A with one half-size invoice uploaded twice (audit covers the padded bundle) does not pass", async () => {
  const input = await SCENARIOS[0]!.input();
  const text = (await readFile(join(FIXTURES_DIR, "evidence/maple-st/foundation/invoice_GRM-24117.txt"), "utf8")).replace("TOTAL: $24,850.00", "TOTAL: $12,425.00");
  const bytes = new TextEncoder().encode(text);
  const { sha256, meta } = await extractEvidenceMeta({ bytes, mimeType: "text/plain", filename: "invoice.txt" });
  const copy = (id: string) => ({ id, kind: "invoice" as const, filename: `${id}.txt`, mimeType: "text/plain", uri: `mem/${id}`, sha256, meta, uploadedAt: input.evidence[0]!.uploadedAt });
  const evidence = [...input.evidence.filter((e) => e.kind !== "invoice" && !/lien/.test(e.filename)), copy("inv_a"), copy("inv_b")];
  const files: Record<string, Uint8Array> = { inv_a: bytes, inv_b: bytes };
  const bundle = evidenceBundleHash(evidence.map((e) => ({ sha256: e.sha256 })));
  const audits = input.audits!.map((a) => ({ ...a, evidenceBundleHash: bundle }));
  const v = await verifyMilestone({ ...input, evidence, files, audits, mode: "mock" });
  const invoice = v.checks.find((c) => c.check === "invoice_matches_budget")!;
  assert.equal(invoice.result, "fail", invoice.reason);
  assert.deepEqual(invoice.evidenceIds.sort(), ["inv_a", "inv_b"]);
  assert.equal(v.decision, "fail", v.summary);
});

for (const s of SCENARIOS) {
  test(`scenario ${s.key} matches the manifest: failing and warning checks`, async () => {
    const v = await verifyMilestone({ ...(await s.input()), mode: "mock" });
    const by = (r: string) => v.checks.filter((c) => c.result === r).map((c) => c.check);
    for (const f of s.failingChecks) assert.ok(by("fail").includes(f), `${f} should fail: ${v.summary}`);
    for (const w of s.warnChecks) assert.ok(by("warn").includes(w), `${w} should warn`);
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

test("fixture panel and audits parse against shared v2 and cover the milestone SoV", async () => {
  const panel = JSON.parse(await readFile(join(FIXTURES_DIR, "inspectors.json"), "utf8"));
  const inspectors = panel.inspectors.map((i: unknown) => Inspector.parse(i));
  assert.equal(inspectors.length, 3);
  assert.ok(inspectors.every((i: Inspector) => i.verified && i.homeGeo));
  for (const s of SCENARIOS.filter((x) => x.auditPath)) {
    const [audit] = await s.audits();
    InspectorAudit.parse(audit);
    const milestone = (await s.input()).milestone;
    assert.deepEqual(audit!.checklist.map((line) => line.sovCode), milestone.sovCodes);
    assert.ok(audit!.checklist.every((line) => project.sov!.some((sov) => sov.code === line.sovCode)));
  }
  const cents = (s: string) => BigInt(s.replace(".", ""));
  assert.equal(project.sov!.reduce((sum, line) => sum + cents(line.amount), 0n), cents(project.terms.principal));
  for (const milestone of project.milestones) {
    assert.equal(project.sov!.filter((line) => milestone.sovCodes!.includes(line.code)).reduce((sum, line) => sum + cents(line.amount), 0n), cents(milestone.amount));
  }
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
