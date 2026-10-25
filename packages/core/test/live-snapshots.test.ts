// Live mode: project detail + portfolio show the ledger's vault/loan, not core's book (which recognises the loan's full
// interest at LoanSet: share price 1.0493 on Maple St right after close while the XRPL vault stays at 1.00).
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { LoanSnapshot, VaultSnapshot } from "@xrlp/shared";
import { DAY_MS, FakeClock } from "../src/clock.ts";
import { DEMO, demoCancelAfter, mapleInput, registerParticipants, toFunded } from "../src/demo/scenario.ts";
import { createCore } from "../src/factory.ts";
import { FakeLedger } from "../src/fakes/fake-ledger.ts";

const T0 = "2026-10-01T12:00:00.000Z";

async function mapleClosed() {
  const clock = new FakeClock(T0);
  const ledger = new FakeLedger({ clock, salt: "live-snapshots" });
  const svc = createCore({ inMemory: true, clock, ledger, cancelAfterFor: demoCancelAfter }).service;
  await registerParticipants(svc);
  const { project } = await toFunded(svc, mapleInput(new Date(Date.parse(T0) + 2 * DAY_MS)), ["50000", "40000", "30000"]);
  clock.set(new Date(Date.parse(T0) + 2 * DAY_MS + 3_600_000));
  const closed = (await svc.closeLoan(project.id, { actor: svc.platformAddress })).project;
  return { ledger, svc, project: closed };
}

/** Pretend the ledger is devnet: reads go through getVaultSnapshot / getLoanSnapshot. */
function asDevnet(ledger: FakeLedger, vault: VaultSnapshot | Error, loan: LoanSnapshot | Error) {
  Object.defineProperty(ledger, "mode", { value: "devnet" });
  const calls = { vault: 0, loan: 0 };
  ledger.getVaultSnapshot = async () => (calls.vault++, vault instanceof Error ? Promise.reject(vault) : vault);
  ledger.getLoanSnapshot = async () => (calls.loan++, loan instanceof Error ? Promise.reject(loan) : loan);
  return calls;
}

const ledgerVault = (redemptionDate: string): VaultSnapshot => ({
  assetsTotal: "120000",
  assetsAvailable: "0",
  sharesOutstanding: "120000000000",
  sharePrice: "1.000000",
  subscriptionDate: T0,
  redemptionDate,
  phase: "investment",
});
const ledgerLoan: LoanSnapshot = {
  principalOutstanding: "120000",
  totalValueOutstanding: "125917.808219",
  periodicPayment: "20986.301369",
  paymentRemaining: 6,
  nextPaymentDueDate: "2026-11-02T13:00:00.000Z",
};

describe("live vault + loan snapshots (devnet)", () => {
  it("getProject shows the ledger's vault and loan instead of core's book", async () => {
    const { ledger, svc, project } = await mapleClosed();
    const calls = asDevnet(ledger, ledgerVault(project.chain.redemptionDate!), ledgerLoan);
    const d = await svc.getProject(project.id);
    assert.equal(d.vault!.sharePrice, "1.000000", "flat at LoanSet, like the XRPL vault");
    assert.equal(d.vault!.assetsTotal, "120000");
    assert.deepEqual(d.loan, ledgerLoan);
    assert.deepEqual(calls, { vault: 1, loan: 1 });
  });

  it("portfolio value is the investor's slice of the ledger's AssetsTotal", async () => {
    const { ledger, svc, project } = await mapleClosed();
    asDevnet(ledger, ledgerVault(project.chain.redemptionDate!), ledgerLoan);
    const [pos] = await svc.portfolio(DEMO.investors[0]!.address);
    assert.equal(pos!.projectId, project.id);
    assert.equal(pos!.value, "50000.00");
  });

  it("a failing ledger read falls back to the computed snapshot", async () => {
    const { ledger, svc, project } = await mapleClosed();
    const computed = await svc.getProject(project.id);
    asDevnet(ledger, new Error("rippled down"), new Error("rippled down"));
    const d = await svc.getProject(project.id);
    assert.deepEqual(d.vault, computed.vault);
    assert.deepEqual(d.loan, computed.loan);
    const [pos] = await svc.portfolio(DEMO.investors[0]!.address);
    assert.ok(Number(pos!.value) > 0);
  });

  it("fake mode never reads ledger snapshots", async () => {
    const { ledger, svc, project } = await mapleClosed();
    let reads = 0;
    ledger.getVaultSnapshot = async () => (reads++, Promise.reject(new Error("unused")));
    ledger.getLoanSnapshot = async () => (reads++, Promise.reject(new Error("unused")));
    await svc.getProject(project.id);
    await svc.portfolio(DEMO.investors[0]!.address);
    assert.equal(reads, 0);
  });
});
