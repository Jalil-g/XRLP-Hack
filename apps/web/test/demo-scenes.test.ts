import assert from "node:assert/strict";
import { test } from "node:test";
import type { CheckResult, Milestone, ProjectDetail, ProjectStatus } from "../lib/contract.ts";
import { failedChecks, findStall, isOverdueEscrow } from "../lib/demo-scenes.ts";
import { sharesFromUnits } from "../lib/utils.ts";

const NOW = Date.parse("2026-10-25T12:00:00.000Z");
const PAST = "2026-10-25T11:00:00.000Z";
const FUTURE = "2026-12-25T11:00:00.000Z";
const escrow = { owner: "rSPV", offerSequence: 1, condition: "A0", createTx: "TX" };

function ms(id: string, status: Milestone["status"], extra: Partial<Milestone> = {}): Milestone {
  return { id, index: 0, title: id, amount: "1000", requiredInspectors: 1, status, sovCodes: [], escrow, cancelAfter: FUTURE, ...extra } as Milestone;
}
function detail(id: string, status: ProjectStatus, milestones: Milestone[]): ProjectDetail {
  return { project: { id, name: id, status, milestones } } as unknown as ProjectDetail;
}
const check = (name: string, result: CheckResult["result"]): CheckResult => ({ check: name, result, reason: `${name} ${result}`, evidenceIds: [] });

test("failed-check scene counts every failing required check and headlines the reused photo", () => {
  const r = failedChecks({
    required: [check("gps_within_site", "fail"), check("photo_fresh", "fail"), check("no_duplicate_photo", "fail"), check("invoice_matches_budget", "pass")],
    optional: [],
    outcome: "blocked",
  } as never);
  assert.equal(r.failed.length, 3);
  assert.equal(r.headline?.check, "no_duplicate_photo");
});

test("failed-check scene falls back to the first failure, and to nothing before checks run", () => {
  assert.equal(failedChecks({ required: [check("gps_within_site", "fail")], optional: [], outcome: "blocked" } as never).headline?.check, "gps_within_site");
  assert.deepEqual(failedChecks(undefined), { failed: [], headline: undefined });
});

test("an escrowed milestone past CancelAfter is overdue even before the keeper marks it expired (prestage B)", () => {
  assert.equal(isOverdueEscrow(ms("m2", "escrowed", { cancelAfter: PAST }), NOW), true);
  assert.equal(isOverdueEscrow(ms("m2", "expired"), NOW), true);
  assert.equal(isOverdueEscrow(ms("m2", "escrowed"), NOW), false);
  assert.equal(isOverdueEscrow(ms("m1", "released", { cancelAfter: PAST, escrow: { ...escrow, finishTx: "F" } }), NOW), false);
  assert.equal(isOverdueEscrow(ms("m2", "escrowed", { cancelAfter: PAST, escrow: { ...escrow, cancelTx: "C" } }), NOW), false);
});

test("the stall scene finds the project by state, never project A, whatever the ids are", () => {
  const a = detail("maple-st-duplex", "escrowed", [ms("a1", "escrowed", { cancelAfter: PAST })]);
  const b = detail("ps-1234-b", "escrowed", [ms("b1", "released", { escrow: { ...escrow, finishTx: "F" } }), ms("b2", "escrowed", { cancelAfter: PAST })]);
  const c = detail("ps-1234-c", "completed", [ms("c1", "released", { escrow: { ...escrow, finishTx: "F" } })]);
  const stall = findStall([a, b, c], a, NOW);
  assert.equal(stall?.d, b);
  assert.equal(stall?.overdue?.id, "b2");
  assert.equal(findStall([a, c], a, NOW), undefined);
});

test("after the keeper tick the stall scene still shows the project whose escrow went back", () => {
  const b = detail("ps-1234-b", "stalled", [ms("b2", "refunded", { cancelAfter: PAST, escrow: { ...escrow, cancelTx: "C" } })]);
  const stall = findStall([b], undefined, NOW);
  assert.equal(stall?.overdue, undefined);
  assert.equal(stall?.refunded?.id, "b2");
});

test("portfolio shares are raw share-MPT units (10^6 per whole share), as core sends them", () => {
  assert.equal(sharesFromUnits("50000000000"), 50_000);
  assert.equal(sharesFromUnits("1500000"), 1.5);
});
