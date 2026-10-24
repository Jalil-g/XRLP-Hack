import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createCore,
  demo,
  demoDoc,
  demoPhoto,
  DomainError,
  FakeClock,
  FakeLedger,
  FakeVerifier,
  generateMilestoneCondition,
  MemoryInspectorKeyring,
  toMicro,
  type InspectorKeyring,
} from "../src/index.ts";

const { DEMO, MAPLE_ID, MAPLE_M } = demo;
const DANA = DEMO.inspectors[0].address;
const TOM = DEMO.inspectors[1].address;

function setup(start = "2026-10-25T14:00:00Z") {
  const clock = new FakeClock(start);
  const ledger = new FakeLedger({ clock, salt: "test" });
  const core = createCore({ inMemory: true, clock, ledger, verifier: new FakeVerifier(clock) });
  const rings = new Map<string, InspectorKeyring>();
  const keyringFor = (a: string) => {
    if (!rings.has(a)) rings.set(a, new MemoryInspectorKeyring(a));
    return rings.get(a)!;
  };
  return { clock, ledger, core, keyringFor };
}

async function escrowedMaple() {
  const t = setup();
  await demo.registerParticipants(t.core);
  await demo.verifyBuilder(t.core, DEMO.builders.hudson.id);
  await demo.mapleToEscrowed(t.core, t.clock, t.keyringFor);
  return t;
}

const isCode = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;

/** Good evidence for any Maple milestone, satisfying its template. */
async function goodEvidence(t: Awaited<ReturnType<typeof escrowedMaple>>, milestoneId: string) {
  const m = (await t.core.read.getProjectDetail(MAPLE_ID)).milestones.find((x) => x.id === milestoneId)!;
  const ev = [];
  for (const r of m.template.requiredEvidence)
    for (let i = 0; i < r.minCount; i++)
      ev.push(
        r.kind === "photo"
          ? demoPhoto({ label: `${m.title} ${i} ${t.clock.now().getTime()}`, filename: `${m.templateKey}-${i}.jpg`, takenAt: t.clock.now(), gps: DEMO.maple.siteGeo })
          : demoDoc({ kind: r.kind, filename: `${m.templateKey}-${r.kind}-${i}.pdf`, title: `${m.title} ${r.kind}`, invoiceTotal: r.kind === "invoice" ? "1000.00" : undefined }),
      );
  return ev;
}

describe("happy path", () => {
  it("verify -> fund -> escrow -> all milestones released -> repay -> completed", async () => {
    const t = await escrowedMaple();
    const { service, read } = t.core;
    let d = await read.getProjectDetail(MAPLE_ID);
    assert.equal(d.project.status, "escrowed");
    assert.equal(d.funding.fundedPct, 100);
    assert.equal(d.milestones.every((m) => m.status === "escrowed" && m.escrow?.condition), true);
    assert.equal(d.timeline.filter((e) => e.kind === "escrow_created").length, 4);
    assert.ok(d.timeline.every((e) => e.explorerUrl === `https://devnet.xrpl.org/transactions/${e.txHash}`));

    for (const m of d.project.milestones) {
      t.clock.advanceDays(10);
      await service.submitEvidence(MAPLE_ID, m.id, { evidence: await goodEvidence(t, m.id) });
      const { verdict } = await service.runAiReview(MAPLE_ID, m.id);
      assert.equal(verdict.decision, "pass", JSON.stringify(verdict.checks));
      const r = await service.inspectorAttest(MAPLE_ID, m.id, {
        inspector: DANA,
        decision: "approve",
        fulfillment: t.keyringFor(DANA).fulfillmentFor(m.id),
      });
      assert.equal(r.quorum.met, true);
      assert.equal(r.milestone.status, "released");
      assert.ok(r.released);
    }
    d = await read.getProjectDetail(MAPLE_ID);
    assert.equal(d.card.releasedAmount, "120000.00");
    await service.repayLoan(MAPLE_ID, { amount: "50000.00" });
    assert.equal((await read.getProjectDetail(MAPLE_ID)).project.status, "repaying");
    await service.repayLoan(MAPLE_ID, { amount: (await read.getProjectDetail(MAPLE_ID)).vault.outstanding });
    d = await read.getProjectDetail(MAPLE_ID);
    assert.equal(d.project.status, "completed");
    // investors got principal + interest
    const ava = await read.getInvestorPortfolio(DEMO.investors[0].address);
    assert.ok(toMicro(ava.totals.withdrawable) > toMicro("50000.00"));
    await assert.rejects(service.repayLoan(MAPLE_ID, { amount: "1.00" }), isCode("ILLEGAL_TRANSITION"));
  });

  it("AI needs_human: inspector alone can't release; platform co-sign completes quorum", async () => {
    const t = await escrowedMaple();
    const { service } = t.core;
    const ev = await goodEvidence(t, MAPLE_M.foundation);
    ev[0]!.filename = "foundation-blurry.jpg";
    await service.submitEvidence(MAPLE_ID, MAPLE_M.foundation, { evidence: ev });
    const { verdict, attestation } = await service.runAiReview(MAPLE_ID, MAPLE_M.foundation);
    assert.equal(verdict.decision, "needs_human");
    assert.equal(attestation, undefined, "no AI approval on needs_human");
    const fulfillment = t.keyringFor(DANA).fulfillmentFor(MAPLE_M.foundation)!;
    const r = await service.inspectorAttest(MAPLE_ID, MAPLE_M.foundation, { inspector: DANA, decision: "approve", fulfillment });
    assert.equal(r.quorum.met, false);
    assert.equal(r.milestone.status, "inspected");
    await assert.rejects(service.releaseMilestone(MAPLE_ID, MAPLE_M.foundation, { fulfillment }), isCode("QUORUM_NOT_MET"));
    const p = await service.platformAttest(MAPLE_ID, MAPLE_M.foundation, { decision: "approve", notes: "Reviewed photos manually" });
    assert.equal(p.quorum.met, true);
    const q = await t.core.read.getInspectorQueue(DANA);
    assert.equal(q.awaitingRelease.length, 1);
    await assert.rejects(
      service.releaseMilestone(MAPLE_ID, MAPLE_M.foundation, { fulfillment: generateMilestoneCondition().fulfillment }),
      isCode("VALIDATION"),
    );
    const rel = await service.releaseMilestone(MAPLE_ID, MAPLE_M.foundation, { fulfillment });
    assert.equal(rel.milestone.status, "released");
  });

  it("2-inspector milestones need both inspectors", async () => {
    const t = setup();
    await demo.registerParticipants(t.core);
    await demo.verifyBuilder(t.core, DEMO.builders.empire.id);
    await demo.verifyBuilder(t.core, DEMO.builders.catskill.id);
    await demo.seedOtherProjects(t.core, t.clock, t.keyringFor);
    const rv = await t.core.read.getProjectDetail("riverside-commons");
    assert.equal(rv.milestones[0]!.status, "released");
    assert.ok(rv.milestones.every((m) => m.requiredInspectors === 2));
    const m2 = rv.milestones[1]!;
    assert.equal(m2.status, "ai_reviewed");
    const fulfillment = t.keyringFor(DANA).fulfillmentFor(m2.id)!;
    const a = await t.core.service.inspectorAttest(rv.project.id, m2.id, { inspector: DANA, decision: "approve", fulfillment });
    assert.equal(a.quorum.met, false, "inspector + AI is weight 3 but policy needs 2 inspectors");
    assert.equal((await t.core.read.getInspectorQueue(TOM)).pending.length, 1);
    await t.core.service.inspectorAttest(rv.project.id, m2.id, { inspector: TOM, decision: "approve" });
    assert.equal((await t.core.read.getInspectorQueue(DANA)).awaitingRelease.length, 1);
    const r = await t.core.service.releaseMilestone(rv.project.id, m2.id, { fulfillment });
    assert.equal(r.milestone.status, "released");
    const elm = await t.core.read.getProjectDetail("elm-ave-brownstone");
    assert.equal(elm.project.status, "funding");
    assert.equal(elm.funding.raised, "38000.00");
  });
});

describe("fraud path", () => {
  it("reused/old photos -> AI fail -> rejected, money locked; resubmission with good evidence releases", async () => {
    const t = await escrowedMaple();
    await demo.mapleMilestone1(t.core, t.clock, t.keyringFor);
    const { verdict, milestone } = await demo.mapleMilestone2Fraud(t.core, t.clock);
    assert.equal(verdict.decision, "fail");
    const failed = verdict.checks.filter((c) => c.result === "fail").map((c) => c.check);
    assert.deepEqual(failed.sort(), ["no_duplicate_photo", "photo_fresh"]);
    assert.equal(milestone.status, "rejected");
    const { service, read } = t.core;
    const fulfillment = t.keyringFor(DANA).fulfillmentFor(MAPLE_M.framing)!;
    await assert.rejects(service.inspectorAttest(MAPLE_ID, MAPLE_M.framing, { inspector: DANA, decision: "approve", fulfillment }), isCode("ILLEGAL_TRANSITION"));
    await assert.rejects(service.releaseMilestone(MAPLE_ID, MAPLE_M.framing, { fulfillment }), isCode("ILLEGAL_TRANSITION"));
    assert.equal(t.ledger.submitted.filter((e) => e.kind === "escrow_finished").length, 1, "only foundation released");

    // Builder resubmits honest evidence: new round, old attestations don't count.
    await service.submitEvidence(MAPLE_ID, MAPLE_M.framing, { evidence: await goodEvidence(t, MAPLE_M.framing) });
    const v2 = await service.runAiReview(MAPLE_ID, MAPLE_M.framing);
    assert.equal(v2.verdict.decision, "pass");
    const r = await service.inspectorAttest(MAPLE_ID, MAPLE_M.framing, { inspector: DANA, decision: "approve", fulfillment });
    assert.equal(r.milestone.status, "released");
    const view = (await read.getProjectDetail(MAPLE_ID)).milestones[1]!;
    assert.equal(view.round, 2);
    assert.equal(view.verdictHistory.length, 2);
  });

  it("inspector reject sends milestone back to builder", async () => {
    const t = await escrowedMaple();
    const { service } = t.core;
    await service.submitEvidence(MAPLE_ID, MAPLE_M.foundation, { evidence: await goodEvidence(t, MAPLE_M.foundation) });
    await service.runAiReview(MAPLE_ID, MAPLE_M.foundation);
    const r = await service.inspectorAttest(MAPLE_ID, MAPLE_M.foundation, { inspector: TOM, decision: "reject", notes: "Anchor bolts missing on east wall" });
    assert.equal(r.milestone.status, "rejected");
    assert.equal(r.quorum.rejected, true);
  });
});

describe("expiry path", () => {
  it("cannot expire early; after CancelAfter: EscrowCancel -> LoanPay to vault -> stalled -> investors withdraw pro-rata", async () => {
    const t = await escrowedMaple();
    const { service, read } = t.core;
    await assert.rejects(service.expireMilestone(MAPLE_ID, MAPLE_M.dryIn), isCode("ILLEGAL_TRANSITION"));
    await demo.mapleMilestone1(t.core, t.clock, t.keyringFor);
    await demo.mapleExpireMilestone3(t.core, t.clock);
    const d = await read.getProjectDetail(MAPLE_ID);
    const m3 = d.milestones[2]!;
    assert.equal(m3.status, "refunded");
    assert.ok(m3.escrow?.cancelTx);
    assert.equal(d.project.status, "stalled");
    assert.equal(d.vault.repaid, "24000.00");
    assert.equal(d.vault.withdrawn, "24000.00");
    assert.equal(d.vault.available, "0.00");
    const kinds = d.timeline.map((e) => e.kind);
    assert.ok(kinds.indexOf("escrow_cancelled") < kinds.indexOf("loan_payment"));
    const ava = await read.getInvestorPortfolio(DEMO.investors[0].address);
    assert.equal(ava.totals.withdrawn, "10000.00"); // 50k/120k of 24k
    // late evidence for an expired-eligible milestone is refused
    await assert.rejects(
      service.submitEvidence(MAPLE_ID, MAPLE_M.framing, { evidence: await goodEvidence(t, MAPLE_M.framing) }),
      isCode("ILLEGAL_TRANSITION"),
    );
    // sweep expires the rest that are past CancelAfter (framing), not finish
    const swept = await service.sweepExpired(MAPLE_ID);
    assert.deepEqual(swept.map((s) => s.milestoneId), [MAPLE_M.framing]);
  });

  it("missed funding deadline -> stalled, investors withdraw everything", async () => {
    const t = setup();
    await demo.registerParticipants(t.core);
    await demo.verifyBuilder(t.core, DEMO.builders.hudson.id);
    await demo.mapleToEscrowed(t.core, t.clock, t.keyringFor, undefined, "funding");
    const ava = DEMO.investors[0].address;
    await t.core.service.invest(MAPLE_ID, { investor: ava, amount: "20000.00" });
    assert.equal(await t.core.service.checkFundingDeadline(MAPLE_ID), false);
    t.clock.advanceDays(15);
    await assert.rejects(t.core.service.invest(MAPLE_ID, { investor: ava, amount: "1.00" }), isCode("ILLEGAL_TRANSITION"));
    assert.equal(await t.core.service.checkFundingDeadline(MAPLE_ID), true);
    const w = await t.core.service.withdraw(MAPLE_ID, { investor: ava });
    assert.equal(w.amount, "20000.00");
  });
});

describe("guards", () => {
  it("rejects bad inputs and illegal steps with clear errors", async () => {
    const t = setup();
    const { service } = t.core;
    await demo.registerParticipants(t.core);
    // unverified builder cannot list
    await assert.rejects(service.createProject(demo.mapleInput(t.clock)), isCode("FORBIDDEN"));
    await demo.verifyBuilder(t.core, DEMO.builders.hudson.id);
    await assert.rejects(demo.verifyBuilder(t.core, DEMO.builders.hudson.id), isCode("CONFLICT"));
    await assert.rejects(service.createProject({ ...demo.mapleInput(t.clock), terms: { ...demo.mapleInput(t.clock).terms, principal: "12.3456789" } }), isCode("VALIDATION"));
    const p = await service.createProject(demo.mapleInput(t.clock));
    assert.deepEqual(p.milestones.map((m) => m.amount), ["30000.00", "36000.00", "24000.00", "30000.00"]);
    await assert.rejects(service.openFunding(p.id), isCode("ILLEGAL_TRANSITION")); // must lock terms first
    await service.lockTerms(p.id);
    await assert.rejects(service.lockTerms(p.id), isCode("ILLEGAL_TRANSITION"));
    await service.openFunding(p.id);
    // only assigned inspectors can supply conditions; must be valid conditions
    await assert.rejects(
      service.submitMilestoneConditions(p.id, { inspector: DEMO.investors[0].address, conditions: [] }),
      isCode("FORBIDDEN"),
    );
    await assert.rejects(
      service.submitMilestoneConditions(p.id, { inspector: DANA, conditions: [{ milestoneId: p.milestones[0]!.id, condition: "ABCD" }] }),
      isCode("VALIDATION"),
    );
    // unregistered investor / overfunding
    await assert.rejects(service.invest(p.id, { investor: DEMO.builders.hudson.address, amount: "10.00" }), isCode("FORBIDDEN"));
    await assert.rejects(service.invest(p.id, { investor: DEMO.investors[0].address, amount: "120000.01" }), isCode("VALIDATION"));
    // fully funded but conditions missing -> stays funded, no escrows
    const r = await service.invest(p.id, { investor: DEMO.investors[0].address, amount: "120000.00" });
    assert.equal(r.project.status, "funded");
    await assert.rejects(service.closeLoan(p.id), (e: unknown) => e instanceof DomainError && /conditions/.test(e.message));
    // supplying conditions now auto-closes
    const after = await demo.supplyConditions(t.core, p.id, DANA, t.keyringFor);
    assert.equal(after.status, "escrowed");
    // ledger failure leaves state unchanged
    await assert.rejects(service.runAiReview(p.id, p.milestones[0]!.id), isCode("ILLEGAL_TRANSITION"));
  });

  it("ledger failure does not commit state", async () => {
    const t = await escrowedMaple();
    const { service, read } = t.core;
    await service.submitEvidence(MAPLE_ID, MAPLE_M.foundation, { evidence: await goodEvidence(t, MAPLE_M.foundation) });
    await service.runAiReview(MAPLE_ID, MAPLE_M.foundation);
    const orig = t.ledger.attestApproval.bind(t.ledger);
    t.ledger.attestApproval = async () => {
      throw new Error("tefPAST_SEQ");
    };
    await assert.rejects(service.inspectorAttest(MAPLE_ID, MAPLE_M.foundation, { inspector: DANA, decision: "approve" }), isCode("LEDGER_ERROR"));
    t.ledger.attestApproval = orig;
    const m = (await read.getProjectDetail(MAPLE_ID)).milestones[0]!;
    assert.equal(m.status, "ai_reviewed");
    assert.equal(m.attestations.filter((a) => a.role === "inspector").length, 0);
  });
});

describe("read models", () => {
  it("seeded marketplace has 3 projects at different stages and every read model renders", async () => {
    const t = setup("2026-09-01T12:00:00Z");
    await demo.seedDemo(t.core, t.clock, t.keyringFor, "fraud-caught");
    const market = await t.core.read.getMarketplace();
    assert.deepEqual(market.map((p) => [p.id, p.status]).sort(), [
      ["elm-ave-brownstone", "funding"],
      ["maple-st-duplex", "escrowed"],
      ["riverside-commons", "escrowed"],
    ]);
    const maple = await t.core.read.getProjectDetail(MAPLE_ID);
    assert.deepEqual(maple.milestones.map((m) => m.status), ["released", "rejected", "escrowed", "escrowed"]);
    assert.ok(maple.activity.some((a) => a.type === "verdict" && /FAIL/.test(a.title)));
    const builder = await t.core.read.getBuilderDashboard(DEMO.builders.hudson.id);
    assert.equal(builder.builder.verified, true);
    assert.ok(builder.credentialEvent);
    assert.match(builder.projects[0]!.nextAction ?? "", /resubmit/);
    const q = await t.core.read.getInspectorQueue(TOM);
    assert.equal(q.pending.length, 1); // riverside structure
    const pf = await t.core.read.getInvestorPortfolio(DEMO.investors[1].address);
    assert.equal(pf.positions.length, 3);
    JSON.stringify([market, maple, builder, q, pf]); // no bigint leaks
  });
});
