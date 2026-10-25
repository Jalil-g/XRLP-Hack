// Route 8 on devnet: CancelAfter fits the ledger's loan maturity; a partial close (LoanSet ok, EscrowCreate failed)
// records the on-chain loan + escrows instead of forgetting them.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { LedgerError, type CreateProjectInput } from "@xrlp/shared";
import { DAY_MS, FakeClock } from "../src/clock.ts";
import { auditBody, DEMO, doc, invoice, mapleInput, photos, registerParticipants, toFunded } from "../src/demo/scenario.ts";
import { createCore } from "../src/factory.ts";
import { FakeLedger } from "../src/fakes/fake-ledger.ts";

const T0 = "2026-10-01T12:00:00.000Z";
const LEDGER_LAG_MS = 8_000;

async function funded(input: CreateProjectInput, ledger?: FakeLedger) {
  const clock = new FakeClock(T0);
  const l = ledger ?? new FakeLedger({ clock, salt: "close" });
  const core = createCore({ inMemory: true, clock, ledger: l });
  await registerParticipants(core.service);
  const { project, inspectors } = await toFunded(core.service, input, ["50000", "40000", "30000"]);
  clock.set(new Date(Date.parse(T0) + 2 * DAY_MS + 3_600_000));
  return { clock, ledger: l, core, svc: core.service, project, inspector: inspectors[0]! };
}

/** xrpl planLoanClose: CancelAfter < maturity = ledger now + PaymentInterval x round(termDays / interval). */
function xrplMaturityGuard(ledger: FakeLedger, clock: FakeClock) {
  const real = ledger.closeLoanAndCreateEscrows.bind(ledger);
  ledger.closeLoanAndCreateEscrows = async (a) => {
    const { termDays, paymentIntervalDays } = a.project.terms;
    const maturity = clock.now().getTime() - LEDGER_LAG_MS + Math.max(1, Math.round(termDays / paymentIntervalDays)) * paymentIntervalDays * DAY_MS;
    a.cancelAfters.forEach((c, i) => {
      if (Date.parse(c) >= maturity) throw new LedgerError("validation", `milestone #${i}: CancelAfter ${c} must be before loan maturity`);
    });
    return real(a);
  };
}

describe("close: CancelAfter vs loan maturity", () => {
  it("default schedule: the last milestone's CancelAfter is before the ledger's maturity (ledger clock lags)", async () => {
    const t = await funded(mapleInput(new Date(Date.parse(T0) + 2 * DAY_MS)));
    xrplMaturityGuard(t.ledger, t.clock);
    const closed = await t.svc.closeLoan(t.project.id, { actor: t.svc.platformAddress });
    const last = closed.project.milestones.at(-1)!;
    assert.ok(Date.parse(last.cancelAfter!) <= t.clock.now().getTime() + 179 * DAY_MS);
  });

  it("termDays not a multiple of the payment interval: capped at the rounded schedule's maturity", async () => {
    const input = mapleInput(new Date(Date.parse(T0) + 2 * DAY_MS));
    input.terms = { ...input.terms, termDays: 100, paymentIntervalDays: 30 }; // 3 payments x 30 days = 90-day loan
    const t = await funded(input);
    xrplMaturityGuard(t.ledger, t.clock);
    const closed = await t.svc.closeLoan(t.project.id, { actor: t.svc.platformAddress });
    for (const m of closed.project.milestones) assert.ok(Date.parse(m.cancelAfter!) < t.clock.now().getTime() + 90 * DAY_MS);
  });
});

describe("close: partial (LoanSet applied, EscrowCreate failed)", () => {
  it("records the loan + created escrows, project escrowed, the rest pending; no second LoanSet; M1 still releases", async () => {
    const t = await funded(mapleInput(new Date(Date.parse(T0) + 2 * DAY_MS)));
    const real = t.ledger.closeLoanAndCreateEscrows.bind(t.ledger);
    let loanSets = 0;
    t.ledger.closeLoanAndCreateEscrows = async (a) => {
      loanSets++;
      const r = await real(a);
      // Shape of @xrlp/xrpl CloseLoanPartialError: only M1's EscrowCreate made it.
      throw Object.assign(new LedgerError("ledger_error", "LoanSet succeeded but EscrowCreate for milestone m2 failed: tecUNFUNDED"), {
        loanId: r.loanId,
        loanSetTx: r.txs[0]!.hash,
        created: [r.escrows[0]!],
        pending: a.project.milestones.slice(1).map((m) => m.id),
      });
    };
    await assert.rejects(t.svc.closeLoan(t.project.id, { actor: t.svc.platformAddress }), (e: Error & { code?: string }) => e.code === "LEDGER_ERROR");

    const d = await t.svc.getProject(t.project.id);
    const [m1, m2, m3] = d.project.milestones;
    assert.equal(d.project.status, "escrowed");
    assert.ok(d.project.chain.loanId);
    assert.equal(m1!.status, "escrowed");
    assert.ok(m1!.escrow && m1!.cancelAfter);
    assert.deepEqual([m2!.status, m3!.status], ["pending", "pending"]);
    assert.deepEqual(d.events.map((e) => e.kind).filter((k) => k === "loan_set" || k === "escrow_created").sort(), ["escrow_created", "loan_set"]);
    const meta = await t.core.store.read((db) => db.projectMeta.find((x) => x.projectId === t.project.id)!);
    assert.deepEqual(meta.closePending, [m2!.id, m3!.id]);

    await assert.rejects(t.svc.closeLoan(t.project.id, { actor: t.svc.platformAddress }), (e: Error & { code?: string }) => e.code === "ILLEGAL_TRANSITION");
    assert.equal(loanSets, 1, "no second LoanSet");

    // The escrow that exists is fully usable: its preimage was issued at close.
    t.clock.advance(DAY_MS);
    const ev = [...photos(DEMO.maple.siteGeo, "Foundation", 3, t.clock.now(), "foundation"), invoice("concrete.pdf", "36000"), doc("footing.pdf", "Footing inspection")];
    await t.svc.submitEvidence(t.project.id, m1!.id, ev);
    await t.svc.submitAudit(t.project.id, m1!.id, auditBody(d.project, m1!.id, t.inspector, ev));
    assert.ok((await t.svc.runChecks(t.project.id, m1!.id)).release, "M1 released");
  });
});
