// CORE-08 (#60): chain events are recorded once per (txHash, kind, projectId, milestoneId).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { explorerTxUrl, LedgerError, type ChainEvent } from "@xrlp/shared";
import { DAY_MS, FakeClock } from "../src/clock.ts";
import { demoCancelAfter, mapleInput, registerParticipants, toFunded } from "../src/demo/scenario.ts";
import { createCore } from "../src/factory.ts";
import { FakeLedger } from "../src/fakes/fake-ledger.ts";
import { fakeHash } from "../src/ids.ts";
import { emptyDb, recordChainEvents } from "../src/store.ts";

const T0 = "2026-10-01T12:00:00.000Z";
const H = fakeHash("dedupe:1");
const ev = (o: Partial<ChainEvent> = {}): ChainEvent => ({
  projectId: "p1",
  milestoneId: "p1:m1",
  kind: "loan_payment",
  txHash: H,
  explorerUrl: explorerTxUrl(H),
  at: T0,
  ...o,
});

describe("recordChainEvents", () => {
  it("records a repeat of the same fact once; the first recording wins", () => {
    const db = emptyDb();
    assert.equal(recordChainEvents(db, [ev()]).length, 1);
    // e.g. a reconcile of the same LoanPay: same hash/kind/milestone, different result + time
    assert.deepEqual(recordChainEvents(db, [ev({ result: "reconciled_loan_repaid", at: "2026-10-02T00:00:00.000Z" })]), []);
    assert.deepEqual(db.chainEvents, [ev()]);
    assert.deepEqual(recordChainEvents(db, [ev({ txHash: H.toLowerCase() })]), [], "hex hashes compare case-insensitively");
    assert.equal(recordChainEvents(db, [ev({ milestoneId: "p1:m2" }), ev({ milestoneId: "p1:m2" })]).length, 1, "repeats inside one call too");
  });

  it("keeps events of one tx that differ in kind, project or milestone", () => {
    const db = emptyDb();
    const added = recordChainEvents(db, [
      ev(),
      ev({ kind: "escrow_finished" }),
      ev({ projectId: "p2", milestoneId: "p2:m1" }),
      ev({ milestoneId: undefined }),
    ]);
    assert.equal(added.length, 4);
    // One hash backing N escrows (were an adapter to label every escrow with the outer Batch hash): still N events.
    const batch = fakeHash("batch-outer");
    const escrows = ["p1:m1", "p1:m2", "p1:m3"].map((m) => ev({ kind: "escrow_created", milestoneId: m, txHash: batch, explorerUrl: explorerTxUrl(batch) }));
    assert.equal(recordChainEvents(db, escrows).length, 3);
    assert.equal(db.chainEvents.length, 7);
  });

  it("never collapses events without a txHash", () => {
    const db = emptyDb();
    recordChainEvents(db, [ev({ txHash: "" }), ev({ txHash: "" })]);
    recordChainEvents(db, [ev({ txHash: "" })]);
    assert.equal(db.chainEvents.length, 3);
  });
});

async function escrowedProject(salt: string) {
  const clock = new FakeClock(T0);
  const ledger = new FakeLedger({ clock, salt });
  const core = createCore({ inMemory: true, clock, ledger, cancelAfterFor: demoCancelAfter });
  const svc = core.service;
  await registerParticipants(svc);
  const { project } = await toFunded(svc, mapleInput(new Date(Date.parse(T0) + 2 * DAY_MS)), ["50000", "40000", "30000"]);
  clock.set(new Date(Date.parse(T0) + 2 * DAY_MS + 3_600_000));
  const closed = await svc.closeLoan(project.id, { actor: svc.platformAddress });
  return { clock, ledger, core, svc, project: closed.project, closeEvents: closed.events };
}

describe("chain event dedupe through the service", () => {
  it("a loan close with N milestone escrows records N escrow_created events (one per escrow, plus the LoanSet)", async () => {
    const t = await escrowedProject("dedupe-close");
    const events = await t.svc.listEvents(t.project.id);
    const created = events.filter((e) => e.kind === "escrow_created");
    assert.equal(created.length, t.project.milestones.length);
    assert.deepEqual(created.map((e) => e.milestoneId).sort(), t.project.milestones.map((m) => m.id).sort());
    assert.equal(new Set(created.map((e) => e.txHash)).size, t.project.milestones.length);
    assert.equal(events.filter((e) => e.kind === "loan_set").length, 1);
  });

  it("an ambiguous refund LoanPay reconciled by two writers on one store is recorded once (event + repayment)", async () => {
    const t = await escrowedProject("dedupe-refund");
    const m1 = t.project.milestones[0]!;
    t.clock.set(new Date(Date.parse(m1.cancelAfter!) + 1000));
    const real = t.ledger.repayLoan.bind(t.ledger);
    let hash = "";
    let paid = 0;
    t.ledger.repayLoan = async (a) => {
      const r = await real(a);
      paid++;
      hash = r.hash;
      throw new LedgerError("ledger_error", "socket closed", { txResult: "connection_lost", txHash: r.hash });
    };
    await assert.rejects(t.svc.cancelExpired(t.project.id, m1.id));
    assert.ok(hash);

    // A second process (keeper next to the HTTP server) on the same store: own in-process locks, same ledger.
    const other = createCore({ inMemory: true, store: t.core.store, clock: t.clock, ledger: t.ledger, cancelAfterFor: demoCancelAfter }).service;
    // Both read the loan (and the write-ahead marker) before either commits.
    const realSnap = t.ledger.getLoanSnapshot.bind(t.ledger);
    const waiting: (() => void)[] = [];
    t.ledger.getLoanSnapshot = async (a) => {
      const s = await realSnap(a);
      await new Promise<void>((go) => {
        waiting.push(go);
        if (waiting.length === 2) waiting.forEach((f) => f());
      });
      return s;
    };
    const [a, b] = await Promise.all([t.svc.cancelExpired(t.project.id, m1.id), other.cancelExpired(t.project.id, m1.id)]);
    assert.equal(a.milestone.status, "refunded");
    assert.equal(b.milestone.status, "refunded");
    assert.equal(paid, 1, "nothing paid twice");

    const refunds = (await t.svc.listEvents(t.project.id)).filter((e) => e.kind === "loan_payment" && e.milestoneId === m1.id);
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0]!.txHash, hash);
    assert.equal(refunds[0]!.result, "reconciled_loan_repaid");
    const repayments = await t.core.store.read((db) => db.repayments.filter((r) => r.milestoneId === m1.id));
    assert.equal(repayments.length, 1);
  });

  it("re-recording a committed tx (a retried commit) adds nothing; every stored event key is unique", async () => {
    const t = await escrowedProject("dedupe-replay");
    const before = await t.core.store.read((db) => db.chainEvents.length);
    const again = await t.core.store.write((db) => recordChainEvents(db, t.closeEvents));
    assert.deepEqual(again, []);
    const keys = await t.core.store.read((db) => db.chainEvents.map((e) => `${e.txHash}|${e.kind}|${e.projectId}|${e.milestoneId}`));
    assert.equal(keys.length, before);
    assert.equal(new Set(keys).size, keys.length);
  });
});
