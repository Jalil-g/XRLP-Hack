import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { Inspector, InspectorAssignment, type VerifierPort } from "@xrlp/shared";
import { assignInspector } from "../src/index.ts";
import { project } from "../fixtures/scenarios.ts";

const fixture = JSON.parse(await readFile(new URL("../fixtures/inspectors.json", import.meta.url), "utf8"));
const panel = fixture.inspectors as (Inspector & { available: boolean; openAudits: number; priorAgreement: number })[];
const p = { ...project, sov: [{ code: "F", title: "Concrete", amount: "25000", trade: "concrete", evidence: [], visualCriteria: [] }] };
const assign: VerifierPort["assignInspector"] = assignInspector;

test("real mock panel selects only verified, available, trade-matched inspectors with reasons", async () => {
  const before = JSON.stringify(panel);
  const result = await assign({ project: p, panel, count: 1 });
  InspectorAssignment.parse(result);
  assert.deepEqual(result.inspectors, [panel[0]!.address]);
  assert.ok(result.reasons.some((reason) => reason.includes("robot/sensor auditors use the same interface")));
  assert.match(result.reasons.join(" "), /MOCK|mock/);
  assert.equal(JSON.stringify(panel), before);
});

for (const [factor, change] of [
  ["distance", { homeGeo: { lat: 0, lng: 0 } }],
  ["open load", { openAudits: 8 }],
  ["agreement", { priorAgreement: 0.1 }],
] as const) {
  test(`ranking accounts for ${factor}`, async () => {
    const original = panel[0]!;
    const candidate = { ...original, ...change };
    const a = await assignInspector({ project: p, panel: [original], count: 1 });
    const b = await assignInspector({ project: p, panel: [candidate], count: 1 });
    assert.ok(a.scores[original.address]! > b.scores[original.address]!);
  });
}

test("trade coverage affects ranking; two inspectors are distinct and ordered deterministically", async () => {
  const both = { ...p, sov: [...p.sov, { ...p.sov[0]!, code: "FR", trade: "framing" }] };
  const first = { ...panel[0]!, openAudits: 0, priorAgreement: 1, homeGeo: p.siteGeo };
  const second = { ...first, address: panel[1]!.address, trades: ["framing"] };
  const result = await assignInspector({ project: both, panel: [second, first], count: 2 });
  assert.deepEqual(result.inspectors, [first.address, second.address]);
  assert.ok(result.scores[first.address]! > result.scores[second.address]!);
  const tied = { ...first, address: panel[1]!.address };
  const a = await assignInspector({ project: p, panel: [first, tied], count: 2 });
  const b = await assignInspector({ project: p, panel: [tied, first], count: 2 });
  assert.deepEqual(a, b);
});

test("insufficient, unavailable, unverified and wrong-trade panels never fill a required slot", async () => {
  for (const bad of [[], [{ ...panel[0]!, verified: false }], [{ ...panel[0]!, available: false }], [panel[1]!]]) {
    const result = await assignInspector({ project: p, panel: bad, count: 1 });
    assert.deepEqual(result.inspectors, []);
    assert.match(result.reasons.join(" "), /incomplete/);
  }
  const result = await assignInspector({ project: p, panel: [panel[0]!], count: 2 });
  assert.deepEqual(result.inspectors, []);
  assert.match(result.reasons.join(" "), /Need 2 independent inspectors/);
});

test("shared-only Inspector still works but unknown scheduling/history is disclosed", async () => {
  const clean = Inspector.parse(panel[0]); // zod strips the local scheduling extensions
  const result = await assign({ project: p, panel: [clean], count: 1 });
  assert.equal(result.inspectors.length, 1);
  assert.match(result.reasons.join(" "), /open audits unknown/);
  assert.match(result.reasons.join(" "), /availability unknown/);
  const unavailable = await assignInspector({ project: p, panel: [clean], count: 1, availability: { [clean.address]: { available: false } } });
  assert.deepEqual(unavailable.inspectors, []);
});

test("invalid, duplicate and missing SoV inputs do not silently produce assignments", async () => {
  await assert.rejects(assignInspector({ project: p, panel: [panel[0]!, panel[0]!], count: 2 }), /Duplicate/);
  await assert.rejects(assignInspector({ project: p, panel: [{ ...panel[0]!, priorAgreement: 5 }], count: 1 }));
  await assert.rejects(assignInspector({ project: { ...p, siteGeo: { ...p.siteGeo, lat: 200 } }, panel, count: 1 }));
  const missing = await assign({ project: { ...p, sov: [] }, panel, count: 1 });
  assert.deepEqual(missing.inspectors, []);
  assert.match(missing.reasons.join(" "), /No Schedule-of-Values trades/);
});
