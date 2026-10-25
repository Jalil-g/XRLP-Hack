// Review finding (merge train): a refund LoanPay that applied but whose outcome was lost must not be paid again.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LedgerError } from "@xrlp/shared";
import { DAY_MS, FakeClock } from "../src/clock.ts";
import { demoCancelAfter, mapleInput, registerParticipants, toFunded } from "../src/demo/scenario.ts";
import { createCore } from "../src/factory.ts";
import { FakeLedger } from "../src/fakes/fake-ledger.ts";

const T0 = "2026-10-01T12:00:00.000Z";

async function m1Expired() {
  const clock = new FakeClock(T0);
  const ledger = new FakeLedger({ clock, salt: "refund-retry" });
  const svc = createCore({ inMemory: true, clock, ledger, cancelAfterFor: demoCancelAfter }).service;
  await registerParticipants(svc);
  const { project } = await toFunded(svc, mapleInput(new Date(Date.parse(T0) + 2 * DAY_MS)), ["50000", "40000", "30000"]);
  clock.set(new Date(Date.parse(T0) + 2 * DAY_MS + 3_600_000));
  const closed = (await svc.closeLoan(project.id, { actor: svc.platformAddress })).project;
  const m1 = closed.milestones[0]!;
  clock.set(new Date(Date.parse(m1.cancelAfter!) + 1000));
  const real = ledger.repayLoan.bind(ledger);
  let applied = 0;
  return { ledger, svc, project: closed, m1, real, applied: () => applied, count: () => applied++ };
}

const status = async (svc: Awaited<ReturnType<typeof m1Expired>>["svc"], pid: string, mid: string) =>
  (await svc.getProject(pid)).project.milestones.find((m) => m.id === mid)!.status;

describe("refund LoanPay retry safety", () => {
  it("LoanPay applies, then the socket drops: the next tick records it (with its hash) and pays nothing", async () => {
    const t = await m1Expired();
    let lose = true;
    t.ledger.repayLoan = async (a) => {
      const r = await t.real(a);
      t.count();
      if (lose) throw new LedgerError("ledger_error", "socket closed", { txResult: "connection_lost", txHash: r.hash });
      return r;
    };
    const first = await t.svc.cancelExpired(t.project.id, t.m1.id).catch((e) => e);
    assert.ok(first instanceof Error);
    assert.equal(await status(t.svc, t.project.id, t.m1.id), "expired");
    lose = false;
    const tick = await t.svc.keeperTick();
    assert.equal(t.applied(), 1, "exactly one LoanPay on the ledger");
    assert.equal(await status(t.svc, t.project.id, t.m1.id), "refunded");
    assert.deepEqual(tick.events.map((e) => [e.kind, e.amount]), [["loan_payment", t.m1.amount]]);
    assert.deepEqual((await t.svc.keeperTick()).events, [], "idempotent afterwards");
  });

  it("LoanPay applies but no hash comes back: reconciled from the loan, no second payment, no fake event", async () => {
    const t = await m1Expired();
    let lose = true;
    t.ledger.repayLoan = async (a) => {
      const r = await t.real(a);
      t.count();
      if (lose) throw new Error("process died after submit");
      return r;
    };
    await t.svc.cancelExpired(t.project.id, t.m1.id).catch(() => undefined);
    lose = false;
    const tick = await t.svc.keeperTick();
    assert.equal(t.applied(), 1);
    assert.equal(await status(t.svc, t.project.id, t.m1.id), "refunded");
    assert.deepEqual(tick.events, []);
  });

  it("LoanPay definitely failed (not applied): the retry pays exactly once", async () => {
    const t = await m1Expired();
    let fail = true;
    t.ledger.repayLoan = async (a) => {
      if (fail) throw new LedgerError("ledger_error", "tecINSUFFICIENT_PAYMENT", { txResult: "tecINSUFFICIENT_PAYMENT" });
      t.count();
      return t.real(a);
    };
    await t.svc.cancelExpired(t.project.id, t.m1.id).catch(() => undefined);
    fail = false;
    await t.svc.keeperTick();
    assert.equal(t.applied(), 1);
    assert.equal(await status(t.svc, t.project.id, t.m1.id), "refunded");
  });

  it("LoanPay definitely failed, then the builder repays: the retry still pays the refund (no false reconcile)", async () => {
    const t = await m1Expired();
    let fail = true;
    t.ledger.repayLoan = async (a) => {
      if (fail && a.source === "escrow_refund") throw new LedgerError("ledger_error", "tecPATH_DRY", { txResult: "tecPATH_DRY" });
      if (a.source === "escrow_refund") t.count();
      return t.real(a);
    };
    await t.svc.cancelExpired(t.project.id, t.m1.id).catch(() => undefined);
    assert.equal(await status(t.svc, t.project.id, t.m1.id), "expired");
    await t.svc.repay(t.project.id, { amount: "30000" }); // shrinks TotalValueOutstanding by more than half of M1
    fail = false;
    await t.svc.keeperTick();
    assert.equal(t.applied(), 1, "the refund LoanPay went out");
    assert.equal(await status(t.svc, t.project.id, t.m1.id), "refunded");
    const refund = (await t.svc.listEvents(t.project.id)).find((e) => e.kind === "loan_payment" && e.milestoneId === t.m1.id)!;
    assert.ok(!refund.result, "a real LoanPay, not a reconciled one");
  });

  it("refund outcome unknown: builder repay is refused until it is resolved", async () => {
    const t = await m1Expired();
    let lose = true;
    t.ledger.repayLoan = async (a) => {
      if (lose && a.source === "escrow_refund") throw new LedgerError("ledger_error", "socket closed", { txResult: "connection_lost" });
      return t.real(a);
    };
    await t.svc.cancelExpired(t.project.id, t.m1.id).catch(() => undefined);
    await assert.rejects(t.svc.repay(t.project.id, { amount: "30000" }), (e: Error & { code?: string }) => e.code === "CONFLICT");
    lose = false;
    await t.svc.keeperTick();
    assert.equal(await status(t.svc, t.project.id, t.m1.id), "refunded");
    await t.svc.repay(t.project.id, { amount: "30000" });
  });
});
