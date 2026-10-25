// CORE-06: keeper is idempotent per step (cancel and refund LoanPay commit separately) and never overlaps itself.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LedgerError } from "@xrlp/shared";
import { toAdapterError } from "../../xrpl/src/adapter-map.ts";
import { XrplTxError } from "../../xrpl/src/errors.ts";
import { ledgerErrorCode } from "../src/errors.ts";
import type { KeeperTickResult } from "../src/api-surface.ts";
import { DAY_MS, FakeClock } from "../src/clock.ts";
import { demoCancelAfter, mapleInput, registerParticipants, toFunded } from "../src/demo/scenario.ts";
import { createCore } from "../src/factory.ts";
import { FakeLedger } from "../src/fakes/fake-ledger.ts";
import { DEFAULT_KEEPER_INTERVAL_MS, keeperIntervalFromEnv, startKeeper } from "../src/keeper.ts";

const T0 = "2026-10-01T12:00:00.000Z";

/** Maple St escrowed, clock just past M1's CancelAfter. Ledger calls are counted. */
async function m1Expired() {
  const clock = new FakeClock(T0);
  const ledger = new FakeLedger({ clock, salt: "keeper" });
  const calls = { cancel: 0, repay: 0 };
  const cancel = ledger.cancelEscrow.bind(ledger);
  const repay = ledger.repayLoan.bind(ledger);
  ledger.cancelEscrow = async (a) => (calls.cancel++, cancel(a));
  ledger.repayLoan = async (a) => (calls.repay++, repay(a));
  const { service: svc, store } = createCore({ inMemory: true, clock, ledger, cancelAfterFor: demoCancelAfter });
  await registerParticipants(svc);
  const { project } = await toFunded(svc, mapleInput(new Date(Date.parse(T0) + 2 * DAY_MS)), ["50000", "40000", "30000"]);
  clock.set(new Date(Date.parse(T0) + 2 * DAY_MS + 3_600_000));
  const closed = (await svc.closeLoan(project.id, { actor: svc.platformAddress })).project;
  const m1 = closed.milestones[0]!;
  clock.set(new Date(Date.parse(m1.cancelAfter!) + 1000));
  return { clock, ledger, calls, repay, svc, store, project: closed, m1 };
}

const status = async (svc: Awaited<ReturnType<typeof m1Expired>>["svc"], pid: string, mid: string) =>
  (await svc.getProject(pid)).project.milestones.find((m) => m.id === mid)!.status;

describe("keeperTick (CORE-06)", () => {
  it("refund fails after the cancel: cancel is persisted, next tick only retries the LoanPay", async () => {
    const { ledger, calls, repay, svc, project, m1 } = await m1Expired();
    ledger.repayLoan = async () => {
      calls.repay++;
      throw new LedgerError("ledger_error", "LoanPay failed", { txResult: "tecINSUFFICIENT_PAYMENT" });
    };
    const t1 = await svc.keeperTick();
    assert.deepEqual(t1.events.map((e) => e.kind), ["escrow_cancelled"]);
    assert.deepEqual(t1.issues.map((i) => [i.milestoneId, i.step, i.code]), [[m1.id, "refund", "LEDGER_ERROR"]]);
    assert.equal(await status(svc, project.id, m1.id), "expired");
    const d = await svc.getProject(project.id);
    assert.ok(d.project.milestones[0]!.escrow!.cancelTx, "cancel tx persisted before the refund");
    assert.equal(d.project.status, "stalled");

    ledger.repayLoan = repay;
    const t2 = await svc.keeperTick();
    assert.deepEqual(t2.events.map((e) => e.kind), ["loan_payment"]);
    assert.deepEqual(t2.issues, []);
    assert.equal(calls.cancel, 1, "no second EscrowCancel (would be tecNO_TARGET)");
    assert.equal(await status(svc, project.id, m1.id), "refunded");

    const t3 = await svc.keeperTick();
    assert.deepEqual(t3, { events: [], issues: [] }, "nothing left to do");
  });

  it("escrow already cancelled out of band: no cancel tx, still refunds the vault", async () => {
    const { ledger, calls, svc, project, m1 } = await m1Expired();
    const { owner, offerSequence } = m1.escrow!;
    await ledger.cancelEscrow({ owner, offerSequence }); // someone else cancelled (anyone may, after CancelAfter)
    const t = await svc.keeperTick();
    assert.deepEqual(t.events.map((e) => e.kind), ["loan_payment"]);
    assert.deepEqual(t.issues, []);
    assert.equal(calls.cancel, 2, "ours hit tecNO_TARGET, then the ledger read showed the escrow gone");
    assert.equal(await status(svc, project.id, m1.id), "refunded");
  });

  it("real tecNO_TARGET mapping reconciles an out-of-band cancel before refunding", async () => {
    const { ledger, calls, svc, project, m1 } = await m1Expired();
    await ledger.cancelEscrow(m1.escrow!);
    const error = toAdapterError(new XrplTxError("EscrowCancel", "tecNO_TARGET"));
    assert.equal(ledgerErrorCode(error), "NOT_FOUND");
    ledger.cancelEscrow = async () => { throw error; };
    const result = await svc.cancelExpired(project.id, m1.id);
    assert.deepEqual(result.events.map((e) => e.kind), ["loan_payment"]);
    assert.equal(result.milestone.status, "refunded");
    assert.equal(result.milestone.escrow!.cancelTx, undefined, "do not invent a cancel receipt");
    assert.equal(calls.repay, 1);
  });

  for (const situation of ["present", "unknown", "verified", "other-not-found"] as const) {
    it(`real missing-escrow mapping does not refund when ${situation}`, async () => {
      const { ledger, calls, svc, store, project, m1 } = await m1Expired();
      if (situation === "verified") {
        await store.write((db) => { db.projects.find((p) => p.id === project.id)!.milestones[0]!.status = "verified"; });
      }
      if (situation === "unknown") ledger.getEscrow = async () => { throw new Error("read unavailable"); };
      if (situation === "verified" || situation === "other-not-found") ledger.getEscrow = async () => null;
      const result = situation === "other-not-found" ? "tecNO_DST" : "tecNO_TARGET";
      ledger.cancelEscrow = async () => { throw toAdapterError(new XrplTxError("EscrowCancel", result)); };
      await assert.rejects(svc.cancelExpired(project.id, m1.id));
      assert.equal(calls.repay, 0);
      assert.equal(await status(svc, project.id, m1.id), situation === "verified" ? "verified" : "escrowed");
    });
  }

  it("cancel itself fails with the escrow still open: reported as a cancel issue, nothing committed", async () => {
    const { ledger, svc, project, m1 } = await m1Expired();
    ledger.cancelEscrow = async () => {
      throw new LedgerError("ledger_error", "rippled timeout");
    };
    const t = await svc.keeperTick();
    assert.deepEqual(t.events, []);
    assert.deepEqual(t.issues.map((i) => [i.milestoneId, i.step]), [[m1.id, "cancel"]]);
    assert.equal(await status(svc, project.id, m1.id), "escrowed");
  });
});

describe("startKeeper / keeperIntervalFromEnv", () => {
  it("env: off by default, KEEPER=1 -> 30 s, KEEPER_INTERVAL_MS override, bad override throws", () => {
    assert.equal(keeperIntervalFromEnv({}), undefined);
    assert.equal(keeperIntervalFromEnv({ KEEPER: "0" }), undefined);
    assert.equal(keeperIntervalFromEnv({ KEEPER: "1" }), DEFAULT_KEEPER_INTERVAL_MS);
    assert.equal(keeperIntervalFromEnv({ KEEPER: "true", KEEPER_INTERVAL_MS: "5000" }), 5000);
    assert.throws(() => keeperIntervalFromEnv({ KEEPER: "1", KEEPER_INTERVAL_MS: "10" }));
  });

  it("ticks never overlap and a thrown tick does not kill the keeper", async () => {
    let release!: () => void;
    let n = 0;
    const api = {
      keeperTick: async (): Promise<KeeperTickResult> => {
        n++;
        if (n === 1) await new Promise<void>((r) => (release = r));
        if (n === 2) throw new Error("boom");
        return { events: [], issues: [] };
      },
    };
    const lines: string[] = [];
    const k = startKeeper(api, { intervalMs: 3_600_000, log: (l) => lines.push(l) });
    try {
      const first = k.tickNow();
      assert.equal(await k.tickNow(), undefined, "skipped while the first tick runs");
      release();
      assert.deepEqual(await first, { events: [], issues: [] });
      assert.equal(await k.tickNow(), undefined);
      assert.match(lines.join("\n"), /tick failed: boom/);
      assert.deepEqual(await k.tickNow(), { events: [], issues: [] });
      assert.equal(n, 3);
    } finally {
      k.stop();
    }
  });
});
