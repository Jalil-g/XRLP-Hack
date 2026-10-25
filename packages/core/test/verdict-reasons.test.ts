// Demo-visible verdict reasons: duplicate photos name the other PROJECT (not its id); photo_fresh never says "0 days".
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Evidence, VerifyMilestoneInput } from "@xrlp/shared";
import { CoreVerifierAdapter } from "../src/adapters/verifier.ts";
import { DAY_MS, FakeClock } from "../src/clock.ts";
import { demoPhoto } from "../src/demo/fixtures.ts";
import { DEMO, auditBody, demoCancelAfter, invoice, mapleInput, photos, registerParticipants, toFunded } from "../src/demo/scenario.ts";
import { createCore } from "../src/factory.ts";
import { FakeLedger } from "../src/fakes/fake-ledger.ts";
import { MemoryStore } from "../src/store.ts";

const T0 = "2026-10-01T12:00:00.000Z";
const HOUR = 3_600_000;

describe("verdict reasons (fake verifier)", () => {
  it("photo_fresh: under a day reads 'taken before this escrow existed'; whole days are counted down", async () => {
    const clock = new FakeClock(T0);
    const svc = createCore({ inMemory: true, clock, ledger: new FakeLedger({ clock, salt: "reasons" }), cancelAfterFor: demoCancelAfter }).service;
    await registerParticipants(svc);
    const { project } = await toFunded(svc, mapleInput(new Date(Date.parse(T0) + 2 * DAY_MS)), ["50000", "40000", "30000"]);
    clock.set(new Date(Date.parse(T0) + 2 * DAY_MS + HOUR));
    const closed = (await svc.closeLoan(project.id, { actor: svc.platformAddress })).project;
    const m1 = closed.milestones[0]!;
    const created = Date.parse(m1.escrow!.createdAt!);
    clock.advance(DAY_MS);
    const site = DEMO.maple.siteGeo;
    const ev = [
      demoPhoto({ label: "hours early", filename: "hours.jpg", takenAt: new Date(created - 2 * HOUR), gps: site }),
      demoPhoto({ label: "one day early", filename: "oneday.jpg", takenAt: new Date(created - 30 * HOUR), gps: site, hue: 90 }),
      demoPhoto({ label: "days early", filename: "days.jpg", takenAt: new Date(created - 3 * DAY_MS - HOUR), gps: site, hue: 150 }),
      ...photos(site, "fresh", 1, clock.now(), "fresh", 200),
      invoice("i.pdf", "36000"),
    ];
    await svc.submitEvidence(project.id, m1.id, ev);
    const { verdict } = await svc.runChecks(project.id, m1.id);
    const fresh = verdict.checks.find((c) => c.check === "photo_fresh")!;
    assert.equal(fresh.result, "fail");
    assert.match(fresh.reason, /hours\.jpg taken before this escrow existed/);
    assert.match(fresh.reason, /oneday\.jpg taken 1 day before this escrow existed/);
    assert.match(fresh.reason, /days\.jpg taken 3 days before this escrow existed/);
    assert.doesNotMatch(fresh.reason, /\b0 days\b/);
  });
});

describe("audit vs evidence (fake verifier)", () => {
  it("inspector marks a line not done: checklist fails and the audit-vs-evidence row says they disagree, not 'agrees'", async () => {
    const clock = new FakeClock(T0);
    const svc = createCore({ inMemory: true, clock, ledger: new FakeLedger({ clock, salt: "behind" }), cancelAfterFor: demoCancelAfter }).service;
    await registerParticipants(svc);
    const { project, inspectors } = await toFunded(svc, mapleInput(new Date(Date.parse(T0) + 2 * DAY_MS)), ["50000", "40000", "30000"]);
    clock.set(new Date(Date.parse(T0) + 2 * DAY_MS + HOUR));
    const closed = (await svc.closeLoan(project.id, { actor: svc.platformAddress })).project;
    const m1 = closed.milestones[0]!;
    clock.advance(HOUR);
    const ev = [...photos(DEMO.maple.siteGeo, "slab", 2, clock.now(), "slab", 30), invoice("i.pdf", m1.amount)];
    await svc.submitEvidence(project.id, m1.id, ev);
    const body = auditBody(closed, m1.id, inspectors[0]!, ev, "Anchor bolts not set yet.");
    body.report.checklist = body.report.checklist.map((c) => ({ ...c, status: "not_done" as never }));
    await svc.submitAudit(project.id, m1.id, body);
    const { verdict, release } = await svc.runChecks(project.id, m1.id);
    const row = (id: string) => verdict.checks.find((c) => c.check === id)!;
    assert.equal(row("audit_checklist_complete").result, "fail");
    assert.equal(row("audit_matches_evidence").result, "warn");
    assert.match(row("audit_matches_evidence").reason, /Inspector marked 1 of 1 item not done/);
    assert.doesNotMatch(row("audit_matches_evidence").reason, /agrees/);
    assert.equal(release, undefined, "nothing released");
  });
});

describe("CoreVerifierAdapter prior evidence", () => {
  it("hands core's records over as PriorEvidence with project id, milestone and name", async () => {
    const adapter = new CoreVerifierAdapter({ mode: "mock", store: new MemoryStore() });
    let seen: unknown[] = [];
    adapter.inner.verifyMilestone = (async (input: { priorEvidence?: unknown[] }) => ((seen = input.priorEvidence ?? []), {})) as never;
    const ev: Evidence = { id: "ev1", kind: "photo", filename: "c-framing-01.jpg", mimeType: "image/jpeg", uri: "/x", sha256: "a".repeat(64), meta: {}, uploadedAt: T0 };
    const record = { ...ev, projectId: "ps-mvnexxxo-c", milestoneId: "ps-mvnexxxo-c-m1-framing", round: 1, projectName: "Elm St ADU" };
    await adapter.verifyMilestone({ project: { id: "maple" }, evidence: [], audits: [], priorEvidence: [record, ev] } as unknown as VerifyMilestoneInput);
    assert.deepEqual(seen[0], { evidence: ev, projectId: "ps-mvnexxxo-c", milestoneId: "ps-mvnexxxo-c-m1-framing", projectName: "Elm St ADU" });
    assert.deepEqual(seen[1], ev, "plain Evidence passes through");
  });
});
