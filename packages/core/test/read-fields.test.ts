// Web's PROPOSED read fields (apps/web/lib/contract.ts): summary rate/builder, per-milestone evidence, check suite,
// attestation kind/hash, live balances (best effort).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DAY_MS, FakeClock } from "../src/clock.ts";
import { auditBody, DEMO, demoCancelAfter, doc, invoice, mapleInput, photos, registerParticipants, toFunded } from "../src/demo/scenario.ts";
import { createCore } from "../src/factory.ts";
import { FakeLedger } from "../src/fakes/fake-ledger.ts";

const T0 = "2026-10-01T12:00:00.000Z";

async function mapleEscrowed() {
  const clock = new FakeClock(T0);
  const ledger = new FakeLedger({ clock, salt: "read-fields" });
  const svc = createCore({ inMemory: true, clock, ledger, cancelAfterFor: demoCancelAfter }).service;
  await registerParticipants(svc);
  const { project, inspectors } = await toFunded(svc, mapleInput(new Date(Date.parse(T0) + 2 * DAY_MS)), ["50000", "40000", "30000"]);
  clock.set(new Date(Date.parse(T0) + 2 * DAY_MS + 3_600_000));
  const closed = (await svc.closeLoan(project.id, { actor: svc.platformAddress })).project;
  clock.advance(DAY_MS);
  return { clock, ledger, svc, project: closed, inspector: inspectors[0]! };
}

describe("web read fields", () => {
  it("summary carries rate, builder id and builder credential", async () => {
    const { svc, project } = await mapleEscrowed();
    const s = (await svc.listProjects()).find((x) => x.id === project.id)!;
    assert.equal(s.interestRateBps, project.terms.interestRateBps);
    assert.equal(s.builderId, project.builderId);
    assert.equal(s.builderVerified, true);
  });

  it("detail: suite before the first run, evidence per milestone, attestation kind + hash, balances tick on release", async () => {
    const { svc, clock, project, inspector } = await mapleEscrowed();
    const m1 = project.milestones[0]!;
    let d = await svc.getProject(project.id);
    assert.ok(d.checks[m1.id]!.suite!.includes("inspector_audit_present"), "queued checks listed before any run");
    assert.deepEqual(d.evidence![m1.id], []);
    const before = d.balances!;
    assert.ok(before, "balances once the SPV exists");

    const ev = [...photos(DEMO.maple.siteGeo, "Foundation", 3, clock.now(), "foundation"), invoice("concrete.pdf", "36000"), doc("footing.pdf", "Footing inspection")];
    await svc.submitEvidence(project.id, m1.id, ev);
    await svc.submitAudit(project.id, m1.id, auditBody(project, m1.id, inspector, ev));
    assert.ok((await svc.runChecks(project.id, m1.id)).release);

    d = await svc.getProject(project.id);
    assert.equal(d.evidence![m1.id]!.length, ev.length);
    assert.ok(!("round" in d.evidence![m1.id]![0]!), "store bookkeeping stripped");
    assert.equal(d.checks[m1.id]!.suite, undefined, "suite only while nothing has run");
    const kinds = d.attestations[m1.id]!.map((a) => a.kind);
    assert.deepEqual(kinds, ["audit", "verdict", "release"]);
    for (const a of d.attestations[m1.id]!.filter((a) => a.kind !== "release")) assert.match(a.hash!, /^[0-9a-f]{64}$/i);
    assert.equal(Number(d.balances!.builder) - Number(before.builder), Number(m1.amount), "builder balance ticks by the milestone");
  });

  it("a failing ledger balance read never breaks the project page", async () => {
    const { svc, ledger, project } = await mapleEscrowed();
    ledger.getBalance = async () => {
      throw new Error("rippled down");
    };
    const d = await svc.getProject(project.id);
    assert.equal(d.balances, undefined);
    assert.equal(d.project.id, project.id);
  });
});
