import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { ProjectVerification } from "@xrlp/shared";
import { verifyProject } from "../src/index.ts";
import { projectInput } from "../fixtures/project-scenarios.ts";

const manifest = JSON.parse(await readFile(new URL("../fixtures/project-manifest.json", import.meta.url), "utf8"));
for (const scenario of manifest.scenarios) {
  test(`project fixture ${scenario.key} -> ${scenario.expect}`, async () => {
    const input = projectInput(scenario.key);
    const result = await verifyProject(input);
    ProjectVerification.parse(result);
    assert.equal(result.decision, scenario.expect, result.summary);
    const checks = [...result.identity, ...result.feasibility, ...result.capability];
    for (const name of scenario.failingChecks) assert.equal(checks.find((c) => c.check === name)?.result, "fail");
    for (const name of scenario.warnChecks) assert.equal(checks.find((c) => c.check === name)?.result, "warn");
    assert.equal(result.inspectorPreVisitRequired, scenario.expect === "needs_human");
    assert.equal(result.registryIsMock, true);
    assert.match(result.summary, /MOCK/);
    assert.deepEqual(await verifyProject(input), result);
  });
}

test("missing trusted history or permits cannot be inferred from applicant assertions", async () => {
  const input = projectInput();
  input.history = undefined;
  input.documents = input.documents.filter((d) => d.kind !== "permit");
  const result = await verifyProject(input);
  assert.equal(result.decision, "needs_human");
  assert.equal(result.inspectorPreVisitRequired, true);
  assert.equal(result.riskTier, "high");
});

test("identity mismatch, denied permits, invalid site, duplicate SoV and sum shortfall block", async () => {
  const variants = [
    () => { const i = projectInput(); i.documents[2]!.fields!.legalName = "Other LLC"; return i; },
    () => { const i = projectInput(); i.documents[3]!.fields!.status = "denied"; return i; },
    () => { const i = projectInput(); i.project.siteGeo.lat = 200; return i; },
    () => { const i = projectInput(); i.sov[1]!.code = i.sov[0]!.code; return i; },
    () => { const i = projectInput(); i.sov[0]!.amount = "1.00"; return i; },
  ];
  for (const make of variants) assert.equal((await verifyProject(make())).decision, "fail");
});

test("registry errors and inconsistent history require review instead of passing", async () => {
  const input = projectInput();
  input.registry = { label: "test unavailable registry", lookupLicense: async () => { throw new Error("offline"); }, lookupInsurance: async () => null };
  input.history = { openProjects: 1, priorMilestones: 2, passedMilestones: 3 };
  const result = await verifyProject(input);
  assert.equal(result.decision, "needs_human");
});

test("live project refusal/transport failure and low confidence fail closed through the real runner", async () => {
  const input = { ...projectInput(), mode: "live" as const };
  const down = await verifyProject(input, { judge: async () => { throw new Error("timeout/refusal"); } });
  assert.equal(down.decision, "needs_human");
  const section = { result: "pass" as const, confidence: 0.2, reason: "uncertain" };
  const low = await verifyProject(input, { judge: async () => ({ identity: section, feasibility: section, capability: section }) });
  assert.equal(low.decision, "needs_human");
});
