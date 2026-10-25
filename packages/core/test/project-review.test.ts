// Project-level needs_human (routes 24 site visit + 25 operator decision), the keeper's exposed-key skip, and the
// verifier adapter's stored risk tier.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { serve, type ServerType } from "@hono/node-server";
import { canonicalJson, sha256Hex } from "@xrlp/attest-signer";
import { LedgerError, type Milestone } from "@xrlp/shared";
import { CoreVerifierAdapter } from "../src/adapters/verifier.ts";
import type { StoredFile } from "../src/api-surface.ts";
import { DAY_MS, FakeClock } from "../src/clock.ts";
import { auditBody, DEMO, demoCancelAfter, doc, invoice, mapleInput, photos, registerParticipants, toFunded } from "../src/demo/scenario.ts";
import { DomainError } from "../src/errors.ts";
import { createCore } from "../src/factory.ts";
import { FakeLedger } from "../src/fakes/fake-ledger.ts";
import { createHttpServer } from "../src/http/app.ts";
import type { SiteVisitReportInput } from "../src/site-visit.ts";
import { MemoryStore } from "../src/store.ts";

const T0 = "2026-10-01T12:00:00.000Z";
const isCode = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;

function newCore() {
  const clock = new FakeClock(T0);
  const ledger = new FakeLedger({ clock, salt: "project-review" });
  const core = createCore({ inMemory: true, clock, ledger, cancelAfterFor: demoCancelAfter });
  return { clock, ledger, core, svc: core.service };
}

/** FakeVerifier: license + insurance only -> needs_human (no entity / permit docs). */
async function needsHumanProject(name = "Thin") {
  const ctx = newCore();
  await registerParticipants(ctx.svc);
  const p = await ctx.svc.createProject({ ...mapleInput(new Date("2026-10-05")), name, documents: [{ kind: "license", filename: "l.pdf" }, { kind: "insurance", filename: "i.pdf" }] });
  await ctx.svc.payVerificationFee(p.id, { builder: DEMO.builders.hudson.address });
  const v = await ctx.svc.verifyProject(p.id);
  assert.equal(v.verification.decision, "needs_human");
  assert.equal(v.project.status, "verifying");
  return { ...ctx, project: p, verification: v.verification };
}

const photo = (name: string, sha: string): StoredFile => ({ fileId: `00000000-0000-4000-8000-${sha.slice(0, 12)}`, filename: name, mimeType: "image/jpeg", uri: `/api/files/x`, sha256: sha, bytes: 10 });
const PHOTO = photo("site-1.jpg", "a".repeat(64));

const report = (projectId: string, inspector: string, over: Partial<SiteVisitReportInput> = {}): SiteVisitReportInput => ({
  projectId,
  inspector,
  answers: { siteExists: { answer: "yes" }, siteAccessible: { answer: "yes", note: "  gravel drive  " }, plansMatchSite: { answer: "yes" } },
  notes: " Lot staked, matches the permit set. ",
  ...over,
});

describe("route 24: inspector pre-construction site visit", () => {
  it("panel inspector files it: attested, pre_visit task cleared, project still verifying; hash = the inspector app's siteVisitHash", async () => {
    const { svc, project } = await needsHumanProject();
    const tom = DEMO.inspectors.tom.address;
    assert.ok((await svc.inspectorQueue(tom)).some((t) => t.projectId === project.id && t.needs === "pre_visit"));
    const { visit, events } = await svc.submitSiteVisit(project.id, { report: report(project.id, tom), photos: [PHOTO] });
    assert.equal(visit.projectId, project.id);
    assert.equal(visit.inspector, tom);
    assert.deepEqual(visit.answers.siteAccessible, { answer: "yes", note: "gravel drive" });
    assert.equal(visit.notes, "Lot staked, matches the permit set.");
    assert.equal(visit.photos.length, 1);
    assert.equal(visit.photos[0]!.sha256, PHOTO.sha256);
    assert.ok(visit.txHash && visit.at);
    assert.deepEqual(events.map((e) => [e.kind, e.actor, e.milestoneId]), [["audit_attested", tom, undefined]]);
    // apps/inspector/lib/site-visit.ts siteVisitHash, written out
    const expected = await sha256Hex(
      canonicalJson({ v: 1, projectId: project.id, inspector: tom, answers: { siteExists: { answer: "yes" }, siteAccessible: { answer: "yes", note: "gravel drive" }, plansMatchSite: { answer: "yes" } }, notes: "Lot staked, matches the permit set.", photos: [PHOTO.sha256] }),
    );
    const stored = await svc.store.read((db) => db.projectMeta.find((m) => m.projectId === project.id)!.siteVisits!);
    assert.equal(stored.length, 1);
    assert.equal(stored[0]!.hash, expected);
    assert.equal(stored[0]!.signedByInspector, false);
    assert.ok(!(await svc.inspectorQueue(tom)).some((t) => t.projectId === project.id), "pre_visit task done");
    assert.equal((await svc.getProject(project.id)).project.status, "verifying", "the operator decides (route 25)");
    assert.ok((await svc.listEvents(project.id)).some((e) => e.txHash === visit.txHash));
  });

  it("guards: non-panel actor, wrong project id, no photos, unexplained 'no', signed blob, project not awaiting review", async () => {
    const { svc, project } = await needsHumanProject();
    const tom = DEMO.inspectors.tom.address;
    await assert.rejects(svc.submitSiteVisit(project.id, { report: report(project.id, DEMO.builders.hudson.address), photos: [PHOTO] }), isCode("FORBIDDEN"));
    await assert.rejects(svc.submitSiteVisit(project.id, { report: report(project.id, svc.platformAddress), photos: [PHOTO] }), isCode("FORBIDDEN"));
    await assert.rejects(svc.submitSiteVisit(project.id, { report: report("other", tom), photos: [PHOTO] }), isCode("VALIDATION"));
    await assert.rejects(svc.submitSiteVisit(project.id, { report: report(project.id, tom), photos: [] }), isCode("VALIDATION"));
    const no = report(project.id, tom, { answers: { siteExists: { answer: "no", note: " " }, siteAccessible: { answer: "yes" }, plansMatchSite: { answer: "yes" } } });
    await assert.rejects(svc.submitSiteVisit(project.id, { report: no, photos: [PHOTO] }), isCode("VALIDATION"));
    await assert.rejects(svc.submitSiteVisit(project.id, { report: report(project.id, tom), photos: [PHOTO], signedTxBlob: "ABCDEF0123456789ABCDEF" }), isCode("VALIDATION"));
    await assert.rejects(svc.submitSiteVisit("nope", { report: report("nope", tom), photos: [PHOTO] }), isCode("NOT_FOUND"));
    // A project that passed verification has nothing to review.
    const ok = await svc.createProject(mapleInput(new Date("2026-10-05")));
    await svc.payVerificationFee(ok.id, { builder: DEMO.builders.hudson.address });
    await svc.verifyProject(ok.id);
    await assert.rejects(svc.submitSiteVisit(ok.id, { report: report(ok.id, tom), photos: [PHOTO] }), isCode("ILLEGAL_TRANSITION"));
  });
});

describe("route 25: operator decision on a needs_human project", () => {
  it("site visit -> approve: attested first, verified, VERIFIED_BUILDER on first pass, builder risk tier from the AI report", async () => {
    const { svc, project, verification } = await needsHumanProject();
    await svc.submitSiteVisit(project.id, { report: report(project.id, DEMO.inspectors.dana.address), photos: [PHOTO] });
    assert.equal((await svc.getBuilder(DEMO.builders.hudson.id)).verified, false);
    const r = await svc.decideProject(project.id, { actor: svc.platformAddress, decision: "approve", reason: "Site visit confirms the lot; permits on file" });
    assert.equal(r.project.status, "verified");
    assert.deepEqual(r.events.map((e) => e.kind), ["decision_attested", "credential_issued", "credential_accepted"]);
    const b = await svc.getBuilder(DEMO.builders.hudson.id);
    assert.equal(b.verified, true);
    assert.equal(b.riskTier, verification.riskTier);
    // and the normal flow continues
    const locked = await svc.lockTermsAndOpenFunding(project.id, { actor: svc.platformAddress });
    assert.equal(locked.project.status, "funding");
    await assert.rejects(svc.decideProject(project.id, { actor: svc.platformAddress, decision: "approve", reason: "again" }), isCode("ILLEGAL_TRANSITION"));
  });

  it("reject (no site visit needed) -> rejected; pre_visit task gone", async () => {
    const { svc, project } = await needsHumanProject();
    const r = await svc.decideProject(project.id, { actor: svc.platformAddress, decision: "reject", reason: "Entity documents never supplied" });
    assert.equal(r.project.status, "rejected");
    assert.deepEqual(r.events.map((e) => e.kind), ["decision_attested"]);
    assert.equal((await svc.getBuilder(DEMO.builders.hudson.id)).verified, false);
    assert.ok(!(await svc.inspectorQueue(DEMO.inspectors.tom.address)).some((t) => t.projectId === project.id));
    await assert.rejects(svc.submitSiteVisit(project.id, { report: report(project.id, DEMO.inspectors.tom.address), photos: [PHOTO] }), isCode("ILLEGAL_TRANSITION"));
  });

  it("guards: only the platform, reason required, only after a needs_human verification", async () => {
    const { svc, project } = await needsHumanProject();
    for (const actor of [DEMO.builders.hudson.address, DEMO.inspectors.tom.address, DEMO.investors[0]!.address, svc.aiAgentAddress])
      await assert.rejects(svc.decideProject(project.id, { actor, decision: "approve", reason: "ok" }), isCode("FORBIDDEN"));
    await assert.rejects(svc.decideProject(project.id, { actor: svc.platformAddress, decision: "approve", reason: "  " }), isCode("VALIDATION"));
    await assert.rejects(svc.decideProject(project.id, { actor: svc.platformAddress, decision: "maybe" as never, reason: "x" }), isCode("VALIDATION"));
    assert.equal((await svc.getProject(project.id)).project.status, "verifying", "nothing changed");
    // verifying, but route 5 never ran
    const fresh = await svc.createProject({ ...mapleInput(new Date("2026-10-05")), name: "Fresh" });
    await svc.payVerificationFee(fresh.id, { builder: DEMO.builders.hudson.address });
    await assert.rejects(svc.decideProject(fresh.id, { actor: svc.platformAddress, decision: "approve", reason: "x" }), isCode("ILLEGAL_TRANSITION"));
  });
});

describe("routes 24 + 25 over HTTP (the inspector app's exact multipart call)", () => {
  let server: ServerType;
  let base: string;
  let dataDir: string;
  let ctx: Awaited<ReturnType<typeof needsHumanProject>>;
  before(async () => {
    ctx = await needsHumanProject();
    dataDir = mkdtempSync(join(tmpdir(), "core-site-visit-"));
    const app = createHttpServer(ctx.svc, { dataDir, corsOrigins: [], maxFileBytes: 1024 * 1024 });
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => {
        base = `http://127.0.0.1:${info.port}`;
        resolve();
      });
    });
  });
  after(() => {
    server.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("POST /api/projects/:id/site-visit -> { visit }, then POST /api/projects/:id/decision -> verified", async () => {
    const id = ctx.project.id;
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    // apps/inspector/lib/api.ts submitSiteVisit: report = full InspectorSiteVisit JSON (with client photo metadata + at)
    const appReport = { ...report(id, DEMO.inspectors.tom.address), photos: [{ id: "local-1", kind: "photo", filename: "site-1.jpg", mimeType: "image/jpeg", uri: "blob:x", sha256: "b".repeat(64), meta: {}, uploadedAt: T0 }], at: T0 };
    const form = new FormData();
    form.set("report", JSON.stringify(appReport));
    form.append("photos", new Blob([bytes], { type: "image/jpeg" }), "site-1.jpg");
    const r = await fetch(`${base}/api/projects/${id}/site-visit`, { method: "POST", body: form });
    assert.equal(r.status, 200, await r.clone().text());
    const { visit } = (await r.json()) as { visit: { photos: { sha256: string; uri: string }[]; txHash: string; inspector: string } };
    assert.equal(visit.inspector, DEMO.inspectors.tom.address);
    assert.equal(visit.photos.length, 1);
    assert.match(visit.photos[0]!.uri, /^\/api\/files\/[a-f0-9-]{36}$/, "core's stored upload, not the client's blob: URL");
    assert.notEqual(visit.photos[0]!.sha256, "b".repeat(64), "hash of the uploaded bytes, not the client's claim");
    assert.ok(visit.txHash);

    const forbidden = await fetch(`${base}/api/projects/${id}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor: DEMO.inspectors.tom.address, decision: "approve", reason: "ok" }) });
    assert.equal(forbidden.status, 403);
    const bad = await fetch(`${base}/api/projects/${id}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor: ctx.svc.platformAddress, decision: "approve" }) });
    assert.equal(bad.status, 400);
    const d = await fetch(`${base}/api/projects/${id}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ actor: ctx.svc.platformAddress, decision: "approve", reason: "Site visit confirms the lot" }) });
    assert.equal(d.status, 200);
    assert.equal(((await d.json()) as { project: { status: string } }).project.status, "verified");
  });

  it("site-visit body errors are 400s", async () => {
    const id = ctx.project.id;
    const noReport = new FormData();
    noReport.append("photos", new Blob([new Uint8Array([1])], { type: "image/jpeg" }), "a.jpg");
    assert.equal((await fetch(`${base}/api/projects/${id}/site-visit`, { method: "POST", body: noReport })).status, 400);
    const json = await fetch(`${base}/api/projects/${id}/site-visit`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(json.status, 400);
  });
});

describe("keeper: exposed release key", () => {
  it("reported once, never retried; CancelAfter -> cancel -> refund still runs", async () => {
    const { svc, clock, ledger, core } = newCore();
    await registerParticipants(svc);
    const { project: funded, inspectors } = await toFunded(svc, mapleInput(new Date(Date.parse(T0) + 2 * DAY_MS)), ["50000", "40000", "30000"]);
    clock.set(new Date(Date.parse(T0) + 2 * DAY_MS + 3_600_000));
    const project = (await svc.closeLoan(funded.id, { actor: svc.platformAddress })).project;
    clock.advance(DAY_MS);
    const m1: Milestone = project.milestones[0]!;
    const ev = [...photos(DEMO.maple.siteGeo, "Foundation", 3, clock.now(), "foundation"), invoice("concrete.pdf", "36000"), doc("footing.pdf", "Footing inspection")];
    await svc.submitEvidence(project.id, m1.id, ev);
    await svc.submitAudit(project.id, m1.id, auditBody(project, m1.id, inspectors[0]!, ev));
    // The finish is submitted and fails on-ledger: the fulfillment may be public, so the key is marked exposed.
    const finish = ledger.finishEscrow.bind(ledger);
    ledger.finishEscrow = async () => {
      throw new LedgerError("ledger_error", "EscrowFinish failed", { txResult: "tecINSUFFICIENT_RESERVE", txHash: "F".repeat(64) });
    };
    await assert.rejects(svc.runChecks(project.id, m1.id), isCode("LEDGER_ERROR"));
    ledger.finishEscrow = finish;
    assert.ok(await core.release.keyExposedAt({ projectId: project.id, milestoneId: m1.id }));

    let releases = 0;
    const release = core.release.release.bind(core.release);
    core.release.release = async (a) => (releases++, release(a));
    const t1 = await svc.keeperTick();
    assert.deepEqual(t1.issues.map((i) => [i.milestoneId, i.step, i.code]), [[m1.id, "release", "UNSAFE_RELEASE"]]);
    assert.match(t1.issues[0]!.message, /exposed/);
    const t2 = await svc.keeperTick();
    assert.deepEqual(t2, { events: [], issues: [] }, "reported once");
    assert.equal(releases, 0, "no release retry with an exposed key");

    clock.set(new Date(Date.parse(m1.cancelAfter!) + 1000));
    const t3 = await svc.keeperTick();
    assert.deepEqual(t3.events.filter((e) => e.milestoneId === m1.id).map((e) => e.kind), ["escrow_cancelled", "loan_payment"]);
    const d = await svc.getProject(project.id);
    assert.equal(d.project.milestones[0]!.status, "refunded");
    assert.equal(releases, 0);
  });
});

describe("CoreVerifierAdapter: release policy uses the stored builder risk tier", () => {
  async function storeWithProject(riskTier: "low" | "medium" | "high") {
    const { svc, core } = newCore();
    await registerParticipants(svc);
    const p = await svc.createProject(mapleInput(new Date("2026-10-05")));
    await core.store.write((db) => void (db.builders.find((b) => b.id === p.builderId)!.riskTier = riskTier));
    // A "restarted" process: a new adapter over the same data; it never ran verifyProject.
    const store = new MemoryStore(await core.store.read((db) => db));
    return { p, store };
  }

  it("restarted adapter, medium-tier builder: 1 required audit (M1 36000 < two-inspector threshold)", async () => {
    const { p, store } = await storeWithProject("medium");
    const adapter = new CoreVerifierAdapter({ mode: "mock", store });
    await adapter.store.read((db) => db.projects.length); // any read through core's store view refreshes the tier
    const policy = adapter.policyFor(p, p.milestones[0]!);
    assert.equal(policy.riskTier, "medium");
    assert.equal(policy.requiredAudits, 1);
    assert.equal(policy.minConfidence, 0.8);
  });

  it("follows the store: low and high tiers, and a write that changes the tier", async () => {
    const low = await storeWithProject("low");
    const a = new CoreVerifierAdapter({ mode: "mock", store: low.store });
    await a.store.read(() => 0);
    assert.equal(a.policyFor(low.p, low.p.milestones[0]!).riskTier, "low");
    await a.store.write((db) => void (db.builders.find((b) => b.id === low.p.builderId)!.riskTier = "high"));
    assert.equal(a.policyFor(low.p, low.p.milestones[0]!).requiredAudits, 2);
  });

  it("createCore with the real verifier: the service's own reads keep the tier current", async () => {
    const { p, store } = await storeWithProject("medium");
    const core = createCore({ inMemory: true, store, env: { CORE_VERIFIER: "verifier", VERIFIER_MODE: "mock" } });
    assert.ok(core.verifier instanceof CoreVerifierAdapter);
    const d = await core.service.getProject(p.id);
    assert.equal(core.verifier.policyFor(d.project, d.project.milestones[0]!).requiredAudits, 1);
    assert.equal(core.verifier.policyFor(d.project, d.project.milestones[0]!).riskTier, "medium");
  });
});
