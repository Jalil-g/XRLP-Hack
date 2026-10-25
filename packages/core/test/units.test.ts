import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { LedgerError, TooSoonError, type Project } from "@xrlp/shared";
import { FakeClock } from "../src/clock.ts";
import { conditionFromFulfillment, fulfillmentMatches, generateMilestoneCondition } from "../src/conditions.ts";
import { DEMO, mapleInput } from "../src/demo/scenario.ts";
import { DomainError } from "../src/errors.ts";
import { FakeLedger } from "../src/fakes/fake-ledger.ts";
import { FakeVerifier } from "../src/fakes/fake-verifier.ts";
import { FileStore } from "../src/file-store.ts";
import { assertMilestoneTransition, assertProjectTransition, canMilestoneTransition } from "../src/state-machine.ts";
import { verificationFeeFor } from "../src/service.ts";
import { emptyDb, normalizeDb } from "../src/store.ts";

const isCode = (code: string) => (e: unknown) => e instanceof DomainError && e.code === code;

describe("state machines (shared v2 tables)", () => {
  it("allows the v2 path and rejects shortcuts", () => {
    assertMilestoneTransition("m", "audited", "verified");
    assertMilestoneTransition("m", "needs_human", "verified");
    assertMilestoneTransition("m", "failed", "evidence_submitted");
    assert.throws(() => assertMilestoneTransition("m", "evidence_submitted", "released"), isCode("ILLEGAL_TRANSITION"));
    assert.throws(() => assertMilestoneTransition("m", "escrowed", "verified"), isCode("ILLEGAL_TRANSITION"));
    assertProjectTransition("p", "funded", "escrowed");
    assert.throws(() => assertProjectTransition("p", "funding", "escrowed"), isCode("ILLEGAL_TRANSITION"));
    assert.throws(() => assertProjectTransition("p", "draft", "terms_locked"), isCode("ILLEGAL_TRANSITION"));
  });
  it("never transitions out of legacy v1 statuses", () => {
    assert.equal(canMilestoneTransition("ai_reviewed", "verified"), false);
    assert.equal(canMilestoneTransition("rejected", "evidence_submitted"), false);
  });
});

describe("money + conditions", () => {
  it("verification fee = max(250, 20 bps of principal)", () => {
    assert.equal(verificationFeeFor("120000"), "250.00");
    assert.equal(verificationFeeFor("2000000"), "4000.00");
  });
  it("PREIMAGE-SHA-256 condition/fulfillment round-trip", () => {
    const { condition, fulfillment } = generateMilestoneCondition();
    assert.equal(conditionFromFulfillment(fulfillment), condition);
    assert.ok(fulfillmentMatches(condition, fulfillment));
    assert.ok(!fulfillmentMatches(condition, generateMilestoneCondition().fulfillment));
  });
});

describe("store", () => {
  it("normalizeDb tolerates v1 files (inspector profiles become panel inspectors)", () => {
    const db = normalizeDb({ version: 1, inspectors: [{ address: "rX", name: "Dana", licenseNumber: "L1", createdAt: "x" }], builderReviews: [] } as never);
    assert.equal(db.version, 2);
    assert.deepEqual(db.inspectors[0], { address: "rX", name: "Dana", licenseNumber: "L1", trades: [], homeGeo: undefined, verified: true, credentialTx: undefined });
    assert.deepEqual(db.audits, []);
  });
  it("FileStore commits only when fn succeeds", async () => {
    const s = new FileStore(mkdtempSync(join(tmpdir(), "core-store-")));
    await s.write((db) => db.builders.push({ ...DEMO.builders.hudson, verified: false }));
    await assert.rejects(s.write((db) => { db.builders.length = 0; throw new Error("boom"); }));
    assert.equal(await s.read((db) => db.builders.length), 1);
    await s.reset(emptyDb());
    assert.equal(await s.read((db) => db.builders.length), 0);
  });
});

describe("FakeVerifier", () => {
  const v = new FakeVerifier(new FakeClock("2026-10-24T00:00:00Z"));
  const project = { ...mapleInput(new Date("2026-11-01")), id: "p", status: "draft", milestones: [], chain: {} } as unknown as Project;
  it("policy: two audits at/above TWO_INSPECTOR_THRESHOLD", () => {
    assert.equal(v.policyFor(project, { amount: "49999" } as never).requiredAudits, 1);
    assert.equal(v.policyFor(project, { amount: "50000" } as never).requiredAudits, 2);
    assert.ok(v.policyFor(project, { amount: "1" } as never).requiredChecks.includes("inspector_audit_present"));
  });
  it("assigns the closest verified panel inspector", async () => {
    const panel = Object.values(DEMO.inspectors).map((i) => ({ ...i, verified: true }));
    const a = await v.assignInspector({ project, panel, count: 1 });
    assert.deepEqual(a.inspectors, [DEMO.inspectors.dana.address]);
    const none = await v.assignInspector({ project, panel: panel.map((i) => ({ ...i, verified: false })), count: 1 });
    assert.deepEqual(none.inspectors, []);
  });
  it("verdictHash is canonical", async () => {
    const verdict = { milestoneId: "m", decision: "pass" as const, confidence: 0.9, summary: "s", checks: [], policy: { projectType: "residential_new" as const, riskTier: "low" as const, requiredInspectors: 1 }, model: "mock", createdAt: "t" };
    const shuffled = Object.fromEntries(Object.entries(verdict).reverse()) as typeof verdict;
    assert.equal(v.verdictHash(verdict), v.verdictHash(shuffled));
    assert.notEqual(v.verdictHash(verdict), v.verdictHash({ ...verdict, decision: "fail" }));
  });
});

describe("FakeLedger gates", () => {
  const setup = async (stateFile?: string) => {
    const clock = new FakeClock("2026-10-24T00:00:00Z");
    const ledger = new FakeLedger({ clock, salt: "t", stateFile });
    const project = { ...mapleInput(new Date("2026-10-25T00:00:00Z")), id: "p1", status: "funding", chain: {}, milestones: [
      { id: "m1", index: 0, templateKey: "a", title: "A", amount: "60000", requiredInspectors: 1, status: "pending" },
      { id: "m2", index: 1, templateKey: "b", title: "B", amount: "60000", requiredInspectors: 1, status: "pending" },
    ] } as unknown as Project;
    const builder = { ...DEMO.builders.hudson, verified: true };
    const s = await ledger.setupProjectOnChain({ project, builder, inspectors: [], subscriptionDate: "2026-10-25T00:00:00Z", redemptionDate: "2027-06-01T00:00:00Z" });
    project.chain = { spv: s.spv, vaultId: s.vaultId };
    await ledger.deposit({ project, investor: "rInv", amount: "120000" });
    return { clock, ledger, project, builder };
  };
  const conds = () => [generateMilestoneCondition(), generateMilestoneCondition()];

  it("LoanSet is tecTOO_SOON during Subscription; deposits close after it", async () => {
    const { clock, ledger, project, builder } = await setup();
    const c = conds();
    await assert.rejects(ledger.closeLoanAndCreateEscrows({ project, builder, conditions: c.map((x) => x.condition), cancelAfters: ["2026-12-01T00:00:00Z", "2026-12-02T00:00:00Z"] }), (e) => e instanceof TooSoonError && e.txResult === "tecTOO_SOON");
    clock.set("2026-10-26T00:00:00Z");
    await assert.rejects(ledger.deposit({ project, investor: "rInv", amount: "1" }), (e) => e instanceof LedgerError && e.txResult === "tecNO_PERMISSION");
    await assert.rejects(ledger.closeLoanAndCreateEscrows({ project, builder, conditions: [c[0]!.condition, c[0]!.condition], cancelAfters: ["2026-12-01T00:00:00Z", "2026-12-02T00:00:00Z"] }), /duplicate/);
    const r = await ledger.closeLoanAndCreateEscrows({ project, builder, conditions: c.map((x) => x.condition), cancelAfters: ["2026-12-01T00:00:00Z", "2026-12-02T00:00:00Z"] });
    assert.equal(r.escrows.length, 2);
    await assert.rejects(ledger.withdraw({ project, investor: "rInv", amount: "1" }), TooSoonError);
  });

  it("finish: wrong fulfillment is a recorded tec; preflight refuses without a trust line; state persists across instances", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "fake-ledger-")), "fake-ledger.json");
    const { clock, ledger, project, builder } = await setup(file);
    clock.set("2026-10-26T00:00:00Z");
    const c = conds();
    const r = await ledger.closeLoanAndCreateEscrows({ project, builder, conditions: c.map((x) => x.condition), cancelAfters: ["2026-12-01T00:00:00Z", "2026-12-02T00:00:00Z"] });
    const e = r.escrows[0]!;
    const steal = await ledger.tryFinishWithWrongFulfillment(e);
    assert.equal(steal.result, "tecCRYPTOCONDITION_ERROR");
    ledger.setTrustLine(builder.address, false);
    assert.equal((await ledger.preflightFinish({ ...e, destination: builder.address })).ok, false);
    ledger.setTrustLine(builder.address, true);
    assert.equal((await ledger.preflightFinish({ ...e, destination: builder.address })).ok, true);
    const other = new FakeLedger({ clock, salt: "t", stateFile: file });
    assert.equal((await other.getEscrow(e.owner, e.offerSequence))?.destination, builder.address);
    await other.finishEscrow({ ...e, fulfillment: c[0]!.fulfillment });
    assert.equal(await ledger.getEscrow(e.owner, e.offerSequence), null);
  });
});
