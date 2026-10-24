import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { EscrowSnapshot, LedgerPort, Milestone, Project, TxResult } from "@xrlp/shared";
import { conditionFromFulfillment, fulfillmentMatches } from "../src/conditions.ts";
import { DomainError } from "../src/errors.ts";
import { FilePreimageVault, MemoryPreimageVault, ReleaseService } from "../src/release-service.ts";

const SPV = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const BUILDER = "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe";

const tx = (hash: string, result = "tesSUCCESS"): TxResult => ({ hash, explorerUrl: `https://devnet.xrpl.org/transactions/${hash}`, result });

/** Records calls; escrows keyed by offerSequence. Only the methods ReleaseService uses are real. */
function stubLedger(opts: { preflight?: { ok: boolean; reason?: string }; finishThrows?: boolean } = {}) {
  const calls: string[] = [];
  const escrows = new Map<number, EscrowSnapshot>();
  const finishes: { condition: string; fulfillment: string }[] = [];
  const no = () => {
    throw new Error("not used");
  };
  const ledger = {
    mode: "fake",
    async getEscrow(_owner: string, seq: number) {
      calls.push("getEscrow");
      return escrows.get(seq) ?? null;
    },
    async preflightFinish() {
      calls.push("preflightFinish");
      return opts.preflight ?? { ok: true };
    },
    async attest(p: { memo: { kind: string } }) {
      calls.push(`attest:${p.memo.kind}`);
      return tx("ATTEST");
    },
    async finishEscrow(p: { condition: string; fulfillment: string }) {
      calls.push("finishEscrow");
      finishes.push(p);
      if (opts.finishThrows) throw Object.assign(new Error("tecNO_LINE"), { txResult: "tecNO_LINE", txHash: "FAILED" });
      return tx("FINISH");
    },
    async tryFinishWithWrongFulfillment() {
      calls.push("tryFinishWithWrongFulfillment");
      return tx("STEAL", "tecCRYPTOCONDITION_ERROR");
    },
    payVerificationFee: no, issueCredential: no, setupProjectOnChain: no, deposit: no, withdraw: no,
    closeLoanAndCreateEscrows: no, cancelEscrow: no, repayLoan: no, submitSignedBlob: no,
    getVaultSnapshot: no, getLoanSnapshot: no, getBalance: no,
  } as unknown as LedgerPort;
  return { ledger, calls, escrows, finishes };
}

const project = (id = "p1", n = 3): Project => ({
  id,
  name: "Maple St duplex",
  type: "residential_new",
  builderId: "b1",
  siteAddress: "12 Maple St",
  siteGeo: { lat: 40.67, lng: -73.94, radiusM: 150 },
  description: "",
  terms: { principal: "30000", interestRateBps: 1000, termDays: 30, paymentIntervalDays: 15, fundingDeadline: "2026-10-25T00:00:00.000Z" },
  status: "funded",
  milestones: Array.from({ length: n }, (_, i): Milestone => ({
    id: `${id}:m${i + 1}`, index: i, templateKey: "foundation", title: `M${i + 1}`, amount: "10000", requiredInspectors: 1, status: "pending",
  })),
  chain: {},
});

/** Simulate the close: put conditions on the milestones + escrows on the stub ledger. */
function escrowed(p: Project, conditions: string[], stub: ReturnType<typeof stubLedger>): Project {
  return {
    ...p,
    status: "escrowed",
    milestones: p.milestones.map((m, i) => {
      const seq = 100 + i;
      stub.escrows.set(seq, { owner: SPV, offerSequence: seq, destination: BUILDER, amount: m.amount, condition: conditions[i] });
      return { ...m, status: "escrowed", escrow: { owner: SPV, offerSequence: seq, condition: conditions[i]!, createTx: `C${i}` } };
    }),
  };
}

describe("ReleaseService", () => {
  it("issues one valid, unique condition per milestone and is idempotent before escrows exist", async () => {
    const stub = stubLedger();
    const rs = new ReleaseService({ ledger: stub.ledger, vault: new MemoryPreimageVault() });
    const c1 = await rs.conditionsForClose(project());
    assert.equal(c1.length, 3);
    assert.equal(new Set(c1).size, 3);
    for (const c of c1) assert.match(c, /^A0258020[0-9A-F]{64}810120$/);
    assert.deepEqual(await rs.conditionsForClose(project()), c1, "retry after a failed close returns the same conditions");
    const other = await rs.conditionsForClose(project("p2"));
    assert.ok(other.every((c) => !c1.includes(c)), "conditions are unique across projects");
  });

  it("refuses to issue a duplicate condition", async () => {
    const stub = stubLedger();
    const same = Buffer.alloc(32, 7);
    const rs = new ReleaseService({ ledger: stub.ledger, vault: new MemoryPreimageVault(), random: () => Buffer.from(same) });
    await assert.rejects(rs.conditionsForClose(project("p1", 2)), (e) => e instanceof DomainError && e.code === "CONFLICT");
  });

  it("release: preflight -> release attestation -> finish with the matching fulfillment", async () => {
    const stub = stubLedger();
    const rs = new ReleaseService({ ledger: stub.ledger, vault: new MemoryPreimageVault() });
    const p = escrowed(project(), await rs.conditionsForClose(project()), stub);
    const txs = await rs.release({ project: p, milestone: p.milestones[0]! });
    assert.deepEqual(stub.calls, ["getEscrow", "preflightFinish", "attest:release", "finishEscrow"]);
    assert.equal(txs.length, 2);
    assert.equal(txs[1]!.kind, "escrow_finished");
    const f = stub.finishes[0]!;
    assert.ok(fulfillmentMatches(p.milestones[0]!.escrow!.condition, f.fulfillment));
    await assert.rejects(rs.release({ project: p, milestone: p.milestones[0]! }), (e) => e instanceof DomainError && e.code === "CONFLICT");
  });

  it("pre-reveal safety: nothing is submitted when preflight fails", async () => {
    const stub = stubLedger({ preflight: { ok: false, reason: "destination has no RLUSD trust line" } });
    const rs = new ReleaseService({ ledger: stub.ledger, vault: new MemoryPreimageVault() });
    const p = escrowed(project(), await rs.conditionsForClose(project()), stub);
    await assert.rejects(rs.release({ project: p, milestone: p.milestones[0]! }), (e) => e instanceof DomainError && e.code === "UNSAFE_RELEASE");
    assert.ok(!stub.calls.includes("finishEscrow") && !stub.calls.some((c) => c.startsWith("attest")));
  });

  it("refuses when the escrow's condition is not the one we issued, or the escrow is gone", async () => {
    const stub = stubLedger();
    const rs = new ReleaseService({ ledger: stub.ledger, vault: new MemoryPreimageVault() });
    const conds = await rs.conditionsForClose(project());
    const forged = conditionFromFulfillment(`A0228020${"11".repeat(32)}`);
    const p = escrowed(project(), [forged, conds[1]!, conds[2]!], stub);
    await assert.rejects(rs.release({ project: p, milestone: p.milestones[0]! }), (e) => e instanceof DomainError && e.code === "UNSAFE_RELEASE");
    stub.escrows.delete(101);
    await assert.rejects(rs.release({ project: p, milestone: p.milestones[1]! }), (e) => e instanceof DomainError && e.code === "UNSAFE_RELEASE");
    assert.ok(!stub.calls.includes("finishEscrow"));
  });

  it("a failed finish marks the key exposed and blocks any retry", async () => {
    const stub = stubLedger({ finishThrows: true });
    const rs = new ReleaseService({ ledger: stub.ledger, vault: new MemoryPreimageVault() });
    const p = escrowed(project(), await rs.conditionsForClose(project()), stub);
    await assert.rejects(rs.release({ project: p, milestone: p.milestones[0]! }), (e) => e instanceof DomainError && e.code === "LEDGER_ERROR" && e.txResult === "tecNO_LINE");
    await assert.rejects(rs.release({ project: p, milestone: p.milestones[0]! }), (e) => e instanceof DomainError && e.code === "UNSAFE_RELEASE");
    assert.equal(stub.calls.filter((c) => c === "finishEscrow").length, 1);
  });

  it("tryStealDemo never reads the vault and returns the ledger's refusal", async () => {
    const stub = stubLedger();
    let vaultReads = 0;
    const vault = new MemoryPreimageVault();
    const counting = { all: async () => (vaultReads++, vault.all()), save: (e: never) => vault.save(e) };
    const rs = new ReleaseService({ ledger: stub.ledger, vault: counting });
    const conds = await rs.conditionsForClose(project());
    const p = escrowed(project(), conds, stub);
    const before = vaultReads;
    const r = await rs.tryStealDemo({ project: p, milestone: p.milestones[1]! });
    assert.equal(vaultReads, before);
    assert.equal(r.result, "tecCRYPTOCONDITION_ERROR");
    assert.equal(r.kind, "release_refused");
  });

  it("FilePreimageVault encrypts at rest, round-trips, and rejects a tampered file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rv-"));
    const vault = new FilePreimageVault(dir, undefined);
    const rs = new ReleaseService({ ledger: stubLedger().ledger, vault });
    const conds = await rs.conditionsForClose(project());
    const raw = readFileSync(vault.path, "utf8");
    const [entry] = await vault.all();
    assert.ok(!raw.toLowerCase().includes(entry!.preimage.toString("hex")), "preimage is not stored in plaintext");
    assert.equal(statSync(vault.path).mode & 0o777, 0o600);
    assert.deepEqual(await new ReleaseService({ ledger: stubLedger().ledger, vault: new FilePreimageVault(dir, undefined) }).conditionsForClose(project()), conds);
    const tampered = JSON.parse(raw) as { ct: string }[];
    tampered[0]!.ct = "00" + tampered[0]!.ct.slice(2);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(vault.path, JSON.stringify(tampered));
    await assert.rejects(new FilePreimageVault(dir, undefined).all());
  });
});
