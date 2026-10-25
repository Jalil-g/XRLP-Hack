// CORE-03: every route method on fakes + the docs/04-demo-script.md story end to end.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FakeClock, DAY_MS } from "../src/clock.ts";
import {
  auditBody,
  DEMO,
  demoCancelAfter,
  invoice,
  doc,
  MAPLE_ID,
  mapleInput,
  OAK_ID,
  photos,
  registerParticipants,
  seedDemo,
  SEED_BACKDATE_MS,
  toFunded,
} from "../src/demo/scenario.ts";
import { DomainError } from "../src/errors.ts";
import { createCore } from "../src/factory.ts";
import { FakeLedger } from "../src/fakes/fake-ledger.ts";

const T0 = "2026-10-01T12:00:00.000Z";
const isCode = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;

function newCore() {
  const clock = new FakeClock(T0);
  const ledger = new FakeLedger({ clock, salt: "flows" });
  const core = createCore({ inMemory: true, clock, ledger, cancelAfterFor: demoCancelAfter });
  return { clock, ledger, core, svc: core.service };
}

/** Maple St funded (Subscription still open). */
async function mapleFunded() {
  const ctx = newCore();
  await registerParticipants(ctx.svc);
  const { project, inspectors } = await toFunded(ctx.svc, mapleInput(new Date(Date.parse(T0) + 2 * DAY_MS)), ["50000", "40000", "30000"]);
  return { ...ctx, project, inspector: inspectors[0]! };
}

/** Maple St escrowed. */
async function mapleEscrowed() {
  const ctx = await mapleFunded();
  ctx.clock.set(new Date(Date.parse(T0) + 2 * DAY_MS + 3_600_000));
  const { project } = await ctx.svc.closeLoan(ctx.project.id, { actor: ctx.svc.platformAddress });
  ctx.clock.advance(DAY_MS);
  return { ...ctx, project };
}

const goodEvidence = (clock: FakeClock, prefix = "foundation", unclear = false) => {
  const ps = photos(DEMO.maple.siteGeo, "Foundation", 3, clock.now(), prefix);
  if (unclear) ps[0] = { ...ps[0]!, filename: "foundation-unclear.jpg" };
  return [...ps, invoice("concrete.pdf", "36000"), doc("footing.pdf", "Footing inspection")];
};

describe("onboarding routes (3, 4, 5, 6, 19)", () => {
  it("create -> fee -> verify -> lock -> funding, with guards", async () => {
    const { svc } = newCore();
    await registerParticipants(svc);
    await assert.rejects(svc.createProject({ ...mapleInput(new Date("2026-10-05")), terms: { ...mapleInput(new Date("2026-10-05")).terms, principal: "1" } }), isCode("VALIDATION"));
    const p = await svc.createProject(mapleInput(new Date("2026-10-05")));
    assert.equal(p.id, MAPLE_ID);
    assert.equal(p.status, "draft");
    assert.deepEqual(p.milestones.map((m) => m.amount), ["36000", "48000", "36000"]);
    await assert.rejects(svc.payVerificationFee(p.id, { builder: DEMO.builders.catskill.address }), isCode("FORBIDDEN"));
    await assert.rejects(svc.lockTermsAndOpenFunding(p.id, { actor: svc.platformAddress }), isCode("ILLEGAL_TRANSITION"));
    const fee = await svc.payVerificationFee(p.id, { builder: DEMO.builders.hudson.address });
    assert.equal(fee.project.status, "verifying");
    assert.equal(fee.events[0]?.kind, "verification_fee_paid");
    assert.equal(fee.events[0]?.amount, "250.00");
    const v = await svc.verifyProject(p.id);
    assert.equal(v.verification.decision, "pass");
    assert.equal(v.project.status, "verified");
    assert.deepEqual(v.events.map((e) => e.kind), ["project_verified", "credential_issued", "credential_accepted"]);
    assert.equal((await svc.getBuilder(DEMO.builders.hudson.id)).verified, true);
    await assert.rejects(svc.lockTermsAndOpenFunding(p.id, { actor: DEMO.builders.hudson.address }), isCode("FORBIDDEN"));
    const locked = await svc.lockTermsAndOpenFunding(p.id, { actor: svc.platformAddress });
    assert.equal(locked.project.status, "funding");
    assert.deepEqual(locked.assignment.inspectors, [DEMO.inspectors.dana.address]);
    assert.ok(locked.project.chain.vaultId && locked.project.chain.subscriptionDate && locked.project.chain.redemptionDate);
    assert.deepEqual(locked.events.map((e) => e.kind), ["inspector_assigned", "vault_created", "loan_broker_created", "cover_deposited"]);
    assert.deepEqual(await svc.kycInvestor(DEMO.investors[0]!.address), { events: [] }); // idempotent
  });

  it("verification: failed docs -> rejected; thin docs -> needs_human + inspector pre_visit task", async () => {
    const { svc } = newCore();
    await registerParticipants(svc);
    const bad = await svc.createProject({ ...mapleInput(new Date("2026-10-05")), name: "Bad", documents: [{ kind: "license", filename: "l.pdf", fields: { status: "revoked" } }, { kind: "insurance", filename: "i.pdf" }] });
    await svc.payVerificationFee(bad.id, { builder: DEMO.builders.hudson.address });
    assert.equal((await svc.verifyProject(bad.id)).project.status, "rejected");
    const thin = await svc.createProject({ ...mapleInput(new Date("2026-10-05")), name: "Thin", documents: [{ kind: "license", filename: "l.pdf" }, { kind: "insurance", filename: "i.pdf" }] });
    await svc.payVerificationFee(thin.id, { builder: DEMO.builders.hudson.address });
    const v = await svc.verifyProject(thin.id);
    assert.equal(v.verification.decision, "needs_human");
    assert.equal(v.project.status, "verifying");
    const q = await svc.inspectorQueue(DEMO.inspectors.tom.address);
    assert.ok(q.some((t) => t.projectId === thin.id && t.needs === "pre_visit"));
  });
});

describe("funding + close (7, 8)", () => {
  it("only KYC'd investors, no over-funding, never auto-close; close is TOO_SOON before SubscriptionDate", async () => {
    const ctx = newCore();
    await registerParticipants(ctx.svc);
    const p = await ctx.svc.createProject(mapleInput(new Date(Date.parse(T0) + 2 * DAY_MS)));
    await ctx.svc.payVerificationFee(p.id, { builder: DEMO.builders.hudson.address });
    await ctx.svc.verifyProject(p.id);
    await ctx.svc.lockTermsAndOpenFunding(p.id, { actor: ctx.svc.platformAddress });
    await assert.rejects(ctx.svc.invest(p.id, { investor: DEMO.builders.hudson.address, amount: "10" }), isCode("FORBIDDEN"));
    await ctx.svc.invest(p.id, { investor: DEMO.investors[0]!.address, amount: "100000" });
    await assert.rejects(ctx.svc.invest(p.id, { investor: DEMO.investors[1]!.address, amount: "30000" }), isCode("CONFLICT"));
    await assert.rejects(ctx.svc.closeLoan(p.id, { actor: ctx.svc.platformAddress }), isCode("ILLEGAL_TRANSITION")); // not fully funded
    await ctx.svc.invest(p.id, { investor: DEMO.investors[1]!.address, amount: "20000" });
    const funded = await ctx.svc.getProject(p.id);
    assert.equal(funded.project.status, "funded");
    assert.ok(funded.project.milestones.every((m) => !m.escrow), "never auto-closes on the filling deposit");
    await assert.rejects(ctx.svc.closeLoan(p.id, { actor: ctx.svc.platformAddress }), isCode("TOO_SOON"));
    await assert.rejects(ctx.svc.closeLoan(p.id, { actor: DEMO.investors[0]!.address }), isCode("FORBIDDEN"));
    ctx.clock.set(new Date(Date.parse(T0) + 2 * DAY_MS + 1000));
    const closed = await ctx.svc.closeLoan(p.id, { actor: ctx.svc.platformAddress });
    assert.equal(closed.project.status, "escrowed");
    assert.deepEqual(closed.events.map((e) => e.kind), ["loan_set", "escrow_created", "escrow_created", "escrow_created"]);
    const conds = closed.project.milestones.map((m) => m.escrow!.condition);
    assert.equal(new Set(conds).size, 3);
    assert.ok(closed.project.milestones.every((m) => m.status === "escrowed" && m.escrow!.createdAt && m.cancelAfter));
    assert.ok(closed.project.milestones.every((m) => m.cancelAfter! < closed.project.chain.redemptionDate!));
  });
});

describe("milestone test suite (9-13)", () => {
  it("M1: evidence -> audit -> runChecks pass -> released (verdict attested before the finish)", async () => {
    const { svc, clock, project, inspector, ledger } = await mapleEscrowed();
    const m1 = project.milestones[0]!;
    const ev = goodEvidence(clock);
    const sub = await svc.submitEvidence(project.id, m1.id, ev);
    assert.equal(sub.milestone.status, "evidence_submitted");
    await assert.rejects(svc.submitAudit(project.id, m1.id, auditBody(project, m1.id, DEMO.inspectors.lee.address, ev)), isCode("FORBIDDEN"));
    const a = await svc.submitAudit(project.id, m1.id, auditBody(project, m1.id, inspector, ev));
    assert.equal(a.milestone.status, "audited");
    assert.equal(a.events[0]?.kind, "audit_attested");
    const r = await svc.runChecks(project.id, m1.id);
    assert.equal(r.verdict.decision, "pass");
    assert.ok(r.release?.explorerUrl.startsWith("https://devnet.xrpl.org/transactions/"));
    assert.deepEqual(r.events.map((e) => e.kind), ["verdict_attested", "approval_attested", "escrow_finished"]);
    const d = await svc.getProject(project.id);
    assert.equal(d.project.milestones[0]!.status, "released");
    assert.equal(d.checks[m1.id]!.outcome, "pass");
    assert.equal(await ledger.getBalance(DEMO.builders.hudson.address, "RLUSD"), "36000.00");
  });

  it("missing audit -> fail on inspector_audit_present, escrow stays locked", async () => {
    const { svc, clock, project, ledger } = await mapleEscrowed();
    const m1 = project.milestones[0]!;
    await svc.submitEvidence(project.id, m1.id, goodEvidence(clock));
    const r = await svc.runChecks(project.id, m1.id);
    assert.equal(r.release, undefined);
    const d = await svc.getProject(project.id);
    assert.equal(d.project.milestones[0]!.status, "failed");
    assert.equal(d.checks[m1.id]!.required.find((c) => c.check === "inspector_audit_present")?.result, "fail");
    assert.ok(await ledger.getEscrow(m1.escrow!.owner, m1.escrow!.offerSequence));
  });

  it("needs_human -> operator decision (attested first) -> released; guards on actor + reason", async () => {
    const { svc, clock, project, inspector } = await mapleEscrowed();
    const m1 = project.milestones[0]!;
    const ev = goodEvidence(clock, "foundation", true);
    await svc.submitEvidence(project.id, m1.id, ev);
    await svc.submitAudit(project.id, m1.id, auditBody(project, m1.id, inspector, ev));
    const r = await svc.runChecks(project.id, m1.id);
    assert.equal(r.verdict.decision, "needs_human");
    assert.equal((await svc.getProject(project.id)).project.milestones[0]!.status, "needs_human");
    await assert.rejects(svc.resolveNeedsHuman(project.id, m1.id, { actor: inspector, decision: "approve", reason: "ok" }), isCode("FORBIDDEN"));
    await assert.rejects(svc.resolveNeedsHuman(project.id, m1.id, { actor: svc.platformAddress, decision: "approve", reason: " " }), isCode("VALIDATION"));
    const res = await svc.resolveNeedsHuman(project.id, m1.id, { actor: svc.platformAddress, decision: "approve", reason: "Second photo set confirms the slab" });
    assert.equal(res.milestone.status, "released");
    assert.deepEqual(res.events.map((e) => e.kind), ["decision_attested", "approval_attested", "escrow_finished"]);
    assert.equal((await svc.getProject(project.id)).checks[m1.id]!.outcome, "pass");
  });

  it("operator reject -> failed -> resubmit (new round) -> re-audit -> pass", async () => {
    const { svc, clock, project, inspector } = await mapleEscrowed();
    const m1 = project.milestones[0]!;
    const ev1 = goodEvidence(clock, "foundation", true);
    await svc.submitEvidence(project.id, m1.id, ev1);
    await svc.submitAudit(project.id, m1.id, auditBody(project, m1.id, inspector, ev1));
    await svc.runChecks(project.id, m1.id);
    const rej = await svc.resolveNeedsHuman(project.id, m1.id, { actor: svc.platformAddress, decision: "reject", reason: "Photos unclear" });
    assert.equal(rej.milestone.status, "failed");
    clock.advance(3_600_000);
    const ev2 = goodEvidence(clock, "foundation-retake");
    assert.equal((await svc.submitEvidence(project.id, m1.id, ev2)).milestone.status, "evidence_submitted");
    assert.equal((await svc.getProject(project.id)).checks[m1.id]!.outcome, "pending"); // new round
    await svc.submitAudit(project.id, m1.id, auditBody(project, m1.id, inspector, ev2));
    const r = await svc.runChecks(project.id, m1.id);
    assert.equal(r.verdict.decision, "pass");
    assert.ok(r.release);
  });

  it("pre-reveal safety: no trust line -> UNSAFE_RELEASE, milestone stays verified, keeper releases later", async () => {
    const { svc, clock, project, inspector, ledger } = await mapleEscrowed();
    const m1 = project.milestones[0]!;
    const ev = goodEvidence(clock);
    await svc.submitEvidence(project.id, m1.id, ev);
    await svc.submitAudit(project.id, m1.id, auditBody(project, m1.id, inspector, ev));
    ledger.setTrustLine(DEMO.builders.hudson.address, false);
    await assert.rejects(svc.runChecks(project.id, m1.id), isCode("UNSAFE_RELEASE"));
    let d = await svc.getProject(project.id);
    assert.equal(d.project.milestones[0]!.status, "verified");
    assert.ok(!d.events.some((e) => e.kind === "escrow_finished"));
    ledger.setTrustLine(DEMO.builders.hudson.address, true);
    const tick = await svc.keeperTick();
    assert.ok(tick.events.some((e) => e.kind === "escrow_finished"));
    d = await svc.getProject(project.id);
    assert.equal(d.project.milestones[0]!.status, "released");
  });

  it("cancel: TOO_SOON before CancelAfter; after it -> EscrowCancel + LoanPay -> refunded, project stalled, others continue", async () => {
    const { svc, clock, project, inspector } = await mapleEscrowed();
    const [m1, , m3] = project.milestones;
    await assert.rejects(svc.cancelExpired(project.id, m3!.id), isCode("TOO_SOON"));
    clock.set(new Date(Date.parse(project.milestones[0]!.cancelAfter!) + 1000));
    const r = await svc.cancelExpired(project.id, m1!.id);
    assert.equal(r.milestone.status, "refunded");
    assert.deepEqual(r.events.map((e) => e.kind), ["escrow_cancelled", "loan_payment"]);
    const d = await svc.getProject(project.id);
    assert.equal(d.project.status, "stalled");
    // M2 still open: evidence + audit + checks still work on a stalled project
    const m2 = d.project.milestones[1]!;
    const ev = [...photos(DEMO.maple.siteGeo, "Framing", 4, clock.now(), "framing"), invoice("lumber.pdf", "48000")];
    await svc.submitEvidence(project.id, m2.id, ev);
    await svc.submitAudit(project.id, m2.id, auditBody(d.project, m2.id, inspector, ev));
    assert.ok((await svc.runChecks(project.id, m2.id)).release);
  });
});

describe("money out (14, 15) + reads (1, 2, 16, 17, 18, 20)", () => {
  it("repay -> repaying; LoanPay below one periodic payment is a ledger error", async () => {
    const { svc, project } = await mapleEscrowed();
    await assert.rejects(svc.repay(project.id, { amount: "10" }), isCode("LEDGER_ERROR"));
    const r = await svc.repay(project.id, { amount: "25000" });
    assert.equal(r.project.status, "repaying");
    assert.equal(r.events[0]?.kind, "loan_payment");
  });

  it("reads: marketplace, detail, events newest first, builders, inspectors, queue, portfolio", async () => {
    const { svc, clock, project, inspector } = await mapleEscrowed();
    const list = await svc.listProjects();
    assert.equal(list[0]?.raised, "120000.00");
    assert.equal(list[0]?.investorCount, 3);
    assert.equal(list[0]?.verified, true);
    assert.equal((await svc.listProjects({ status: "draft" })).length, 0);
    const d = await svc.getProject(project.id);
    assert.equal(d.vault?.phase, "investment");
    assert.equal(d.loan?.paymentRemaining, 6);
    assert.equal(d.inspectors[0]?.address, inspector);
    assert.equal(d.verification?.decision, "pass");
    const ev = await svc.listEvents(project.id);
    assert.equal(ev[0]?.kind, "escrow_created");
    assert.ok(ev.at(-1)!.at <= ev[0]!.at);
    await assert.rejects(svc.getBuilder("nope"), isCode("NOT_FOUND"));
    assert.equal((await svc.listBuilders()).length, 2);
    assert.equal((await svc.listInspectors()).length, 3);
    const m1 = project.milestones[0]!;
    const e1 = goodEvidence(clock);
    await svc.submitEvidence(project.id, m1.id, e1);
    const q = await svc.inspectorQueue(inspector);
    assert.equal(q.find((t) => t.milestone?.id === m1.id)?.needs, "audit");
    const pf = await svc.portfolio(DEMO.investors[0]!.address);
    assert.equal(pf[0]?.shares, "50000000000");
    assert.equal(pf[0]?.phase, "investment");
  });
});

describe("docs/04-demo-script.md end to end (fake mode)", () => {
  it("seeded story: money shot, fraud held, ledger says no, stall + keeper, redemption gate", async () => {
    const clock = new FakeClock(new Date(Date.parse(T0) - SEED_BACKDATE_MS));
    const core = createCore({ inMemory: true, clock, cancelAfterFor: demoCancelAfter });
    const svc = core.service;
    await seedDemo(svc, clock);
    const maple = await svc.getProject(MAPLE_ID);
    assert.equal(maple.project.status, "escrowed");
    const [m1, m2, m3] = maple.project.milestones;
    assert.equal(m1!.status, "audited");
    assert.equal(m2!.status, "audited");

    // Beat 3: money shot
    const r1 = await svc.runChecks(MAPLE_ID, m1!.id);
    assert.equal(r1.verdict.decision, "pass");
    assert.ok(r1.release);

    // Beat 4: fraud held (photo reused from Oak Ave)
    const r2 = await svc.runChecks(MAPLE_ID, m2!.id);
    assert.equal(r2.release, undefined);
    const dup = r2.verdict.checks.find((c) => c.check === "no_duplicate_photo")!;
    assert.equal(dup.result, "fail");
    assert.match(dup.reason, /IMG_2231\.jpg matches oak-ave-framing\.jpg from project oak-ave-renovation/);
    assert.ok(await core.ledger.getEscrow(m2!.escrow!.owner, m2!.escrow!.offerSequence), "escrow still locked");

    // Beat 5: ledger says no
    const steal = await svc.tryStealDemo(MAPLE_ID, m2!.id);
    assert.equal(steal.result, "tecCRYPTOCONDITION_ERROR");
    const refused = (await svc.listEvents(MAPLE_ID)).find((e) => e.kind === "release_refused");
    assert.equal(refused?.result, "tecCRYPTOCONDITION_ERROR");
    assert.ok(await core.ledger.getEscrow(m2!.escrow!.owner, m2!.escrow!.offerSequence), "still locked after the attempt");

    // Beat 6: stall -> keeper tick on Oak Ave (framing released earlier, roof expired)
    const tick = await svc.keeperTick();
    assert.deepEqual(tick.events.map((e) => e.kind), ["escrow_cancelled", "loan_payment"]);
    const oak = await svc.getProject(OAK_ID);
    assert.equal(oak.project.status, "stalled");
    assert.deepEqual(oak.project.milestones.map((m) => m.status), ["released", "refunded"]);
    assert.deepEqual((await svc.keeperTick()).events, [], "keeper is idempotent");
    assert.equal(m3!.status, "escrowed");

    // Redemption gate
    const inv = DEMO.investors[0]!.address;
    await assert.rejects(svc.withdraw(OAK_ID, { investor: inv, amount: "100" }), isCode("TOO_SOON"));
    clock.set(new Date(Date.parse(oak.project.chain.redemptionDate!) + 1000));
    const w = await svc.withdraw(OAK_ID, { investor: inv, amount: "100" });
    assert.equal(w.events[0]?.kind, "vault_withdraw");

    // The platform never stores a fulfillment
    const dump = JSON.stringify(await core.store.read((db) => db));
    assert.ok(!/A0228020[0-9A-F]{64}/.test(dump));
  });

  it("route 21 + files: seed in one process, release from another (shared store, ledger state, sealed vault)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "core-seed-"));
    const env = { DATA_DIR: dataDir };
    const a = createCore({ dataDir, env });
    await assert.rejects(createCore({ inMemory: true }).service.resetDemo({ seed: "maple-st" }), isCode("VALIDATION"));
    await a.service.resetDemo({ seed: "maple-st" });
    assert.equal((await a.service.listProjects()).length, 2);
    const vaultFile = readFileSync(join(dataDir, "release-vault.json"), "utf8");
    assert.ok(!/A0228020/.test(vaultFile), "preimages are sealed at rest");
    const b = createCore({ dataDir, env }); // "server" process
    const m1 = (await b.service.getProject(MAPLE_ID)).project.milestones[0]!;
    const r = await b.service.runChecks(MAPLE_ID, m1.id);
    assert.ok(r.release, "release works across processes");
    await b.service.resetDemo();
    assert.equal((await b.service.listProjects()).length, 0);
  });
});


describe("demo role picker", () => {
  it("serves registered public identities through the HTTP route", async () => {
    const { createHttpServer } = await import("../src/http/app.ts");
    const { svc } = newCore();
    await registerParticipants(svc);
    const app = createHttpServer(svc, { dataDir: mkdtempSync(join(tmpdir(), "demo-parties-")) });
    const response = await app.request("/api/admin/demo/parties");
    assert.equal(response.status, 200);
    const parties = await response.json() as { address: string; name: string; role: string; kyc?: boolean }[];
    assert.equal(parties.find((p) => p.role === "platform")?.address, svc.platformAddress);
    assert.equal(parties.filter((p) => p.role === "investor").length, 3);
    assert.ok(parties.filter((p) => p.role === "investor").every((p) => p.kyc));
    assert.ok(parties.some((p) => p.address === DEMO.builders.hudson.address && p.role === "builder"));
    for (const party of parties) assert.ok(Object.keys(party).every((k) => ["address", "name", "role", "kyc"].includes(k)));
  });
});
