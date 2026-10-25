// CORE-07: XRPL prestage (A/B/C) -> core store + release vault, and devnet route 21. Offline: fixture files + a stub ledger.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { SoftwareSigner, buildAttestationTx } from "@xrlp/attest-signer";
import { createPrestageAuditSigner } from "../src/demo/prestage-audit.ts";
import { conditionFromPreimage, type PrestageFile, type PrestagePreimagesFile, type PrestageProject } from "@xrlp/xrpl";
import { explorerTxUrl, type AttestMemo, type EscrowSnapshot, type LedgerPort, type TxResult } from "@xrlp/shared";
import { FakeClock } from "../src/clock.ts";
import { conditionFromFulfillment } from "../src/conditions.ts";
import { importPrestage, planPrestageImport, RESTAGE_HINT } from "../src/demo/prestage-import.ts";
import { DomainError } from "../src/errors.ts";
import { createCore } from "../src/factory.ts";
import { fakeAddress, fakeHash, sha256Hex } from "../src/ids.ts";
import { MemoryPreimageVault } from "../src/release-service.ts";
import { MemoryStore } from "../src/store.ts";

const NOW = "2026-10-25T15:00:00.000Z";
const MIN = 60_000;
const DAY = 86_400_000;
const at = (ms: number) => new Date(Date.parse(NOW) + ms).toISOString();
const isCode = (code: string, re?: RegExp) => (e: unknown) => e instanceof DomainError && e.code === code && (!re || re.test(e.message));

const testSigner = (label: string) => SoftwareSigner.fromEntropy(Buffer.from(sha256Hex(label).slice(0, 32), "hex"));
const ACCOUNTS = Object.fromEntries(
  ["issuer", "platform", "releaseService", "builder", "investor1", "investor2", "investor3", "inspector1", "inspector2", "inspector3", "aiAgent", "trustee"].map((r) => [r, testSigner(`ps:${r}`).wallet.classicAddress]),
);

type Esc = { state: "open" | "expired" | "finished"; cancelAfter: string };

/** One prestaged project like scripts/prestage.ts writes it (amounts/milestones as PLANS). */
function project(key: "A" | "B" | "C", run: string, escrows: Esc[], extra: Partial<PrestageProject> = {}): { p: PrestageProject; preimages: Record<string, { condition: string; preimage: string; createdAt: string }> } {
  const id = `ps-${run}-${key.toLowerCase()}`;
  const amounts = key === "C" ? ["3000", "5000", "4000"] : ["9000", "12000", "9000"];
  const principal = key === "C" ? "12000" : "30000";
  const keys = ["foundation", "framing", "dry_in"];
  const titles = ["Foundation", "Framing", "Roof & Dry-in"];
  const spv = testSigner(`ps:${id}:spv`).wallet.classicAddress;
  const loanSetAt = at(-20 * MIN);
  const preimages: Record<string, { condition: string; preimage: string; createdAt: string }> = {};
  const txs: PrestageProject["txs"] = [];
  const tx = (step: string, type: string, result = "tesSUCCESS") => {
    const hash = fakeHash(`${id}:${step}`);
    txs.push({ step, type, result, hash, explorerUrl: explorerTxUrl(hash) });
    return hash;
  };
  tx("Payment verification fee builder -> platform 250 RLUSD", "Payment");
  tx("SignerListSet SPV {platform,builder,inspector,trustee} q3", "SignerListSet");
  tx("VaultCreate private closed-ended", "VaultCreate");
  tx("LoanBrokerSet (cover 10%/100%, mgmt fee 10%)", "LoanBrokerSet");
  tx("LoanBrokerCoverDeposit 3000 (min 3000)", "LoanBrokerCoverDeposit");
  const p60 = String(Number(principal) * 0.6);
  const p40 = String(Number(principal) * 0.4);
  const investments = [
    { role: "investor1", investor: ACCOUNTS.investor1!, amount: p60, txHash: tx(`VaultDeposit investor1 ${p60}`, "VaultDeposit") },
    { role: "investor2", investor: ACCOUNTS.investor2!, amount: p40, txHash: tx(`VaultDeposit investor2 ${p40}`, "VaultDeposit") },
  ];
  if (key === "A") tx("VaultDeposit investor3 8000 (no KYC)", "VaultDeposit", "tecNO_AUTH");
  tx(`LoanSet ${principal} (SPV multisig countersign)`, "LoanSet");
  const milestones = keys.map((k, i) => ({ id: `${id}-m${i + 1}-${k}`, index: i, templateKey: k, title: titles[i]!, amount: amounts[i]!, status: (escrows[i]!.state === "finished" ? "released" : "pending") as "released" | "pending" }));
  const esc = milestones.map((m, i) => {
    const preimage = randomBytes(32);
    const condition = conditionFromPreimage(preimage);
    preimages[m.id] = { condition, preimage: preimage.toString("hex"), createdAt: loanSetAt };
    return {
      milestoneId: m.id,
      index: i,
      owner: spv,
      offerSequence: 100 + i,
      condition,
      cancelAfter: escrows[i]!.cancelAfter,
      amount: m.amount,
      destination: ACCOUNTS.builder!,
      createTx: tx(`EscrowCreate m${i + 1} ${m.amount}`, "EscrowCreate"),
      createdAt: loanSetAt,
      state: escrows[i]!.state,
    };
  });
  for (const e of esc) {
    if (e.state !== "finished") continue;
    tx("attest audit approve (inspector signed blob)", "Payment");
    tx("attest verdict pass (aiAgent)", "Payment");
    tx("attest release (releaseService: 8 checks green)", "Payment");
    Object.assign(e, { finishTx: tx(`EscrowFinish ${e.milestoneId.split("-").slice(-2).join("-")} ${e.amount} -> builder`, "EscrowFinish") });
  }
  if (key === "C") {
    tx("Payment builder -> SPV 400.00 (repayment funds)", "Payment");
    tx("LoanPay 6050.5 regular (repayment 1 of 2)", "LoanPay");
    tx("LoanPay 6050.5 regular (repayment 2 of 2)", "LoanPay");
  }
  const p: PrestageProject = {
    key,
    scenario: key === "A" ? "ready" : key === "B" ? "stalled" : "repaid",
    projectId: id,
    name: key === "A" ? "Maple St duplex" : key === "B" ? "Birch Rd townhouse" : "Elm St ADU",
    type: "residential_new",
    siteAddress: key === "A" ? "48 Maple St, Beacon, NY 12508" : "17 Birch Rd, Newburgh, NY 12550",
    siteGeo: key === "A" ? { lat: 41.5048, lng: -73.9696, radiusM: 150 } : { lat: 41.5034, lng: -74.0104, radiusM: 150 },
    status: key === "C" ? "completed" : "escrowed",
    builder: ACCOUNTS.builder!,
    assignedInspector: ACCOUNTS.inspector1!,
    terms: { principal, interestRateBps: 1000, paymentTotal: key === "C" ? 2 : 6, paymentIntervalS: key === "C" ? 240 : 30 * 86_400, originationFee: "300" },
    milestones,
    chain: {
      spv,
      vaultId: fakeHash(`${id}:vault`),
      vaultPseudoAccount: fakeAddress(`${id}:vault`),
      shareMptIssuanceId: fakeHash(`${id}:mpt`).slice(0, 48),
      loanBrokerId: fakeHash(`${id}:broker`),
      loanId: fakeHash(`${id}:loan`),
      domainId: fakeHash("domain"),
    },
    spv: { address: spv, signers: { platform: ACCOUNTS.platform!, builder: ACCOUNTS.builder!, inspector: ACCOUNTS.inspector1!, trustee: ACCOUNTS.trustee! }, quorum: 3 },
    cover: { amount: "3000", minimum: "3000", txHash: fakeHash(`${id}:cover`) },
    verificationFee: { amount: "250", txHash: txs[0]!.hash },
    investments,
    escrows: esc,
    dates: {
      subscriptionDate: at(-25 * MIN),
      redemptionDate: key === "C" ? at(-5 * MIN) : at(200 * DAY),
      loanSetAt,
      nextPaymentDueDate: key === "C" ? "" : at(30 * DAY),
    },
    snapshot: {
      vault: key === "C" ? { assetsTotal: "12090", assetsAvailable: "12090", sharesOutstanding: "12000000000", sharePrice: "1.0075", phase: "redemption" } : undefined,
      spvRlusd: "0",
    },
    txs,
    ...extra,
  };
  return { p, preimages };
}

interface Fixture {
  file: PrestageFile;
  preimages: PrestagePreimagesFile;
}

function fixture(run = "r1", o: { aCancelAfter?: string; withC?: boolean } = {}): Fixture {
  const far = (d: number) => o.aCancelAfter ?? at(d * DAY);
  const A = project("A", run, [{ state: "open", cancelAfter: far(30) }, { state: "open", cancelAfter: far(60) }, { state: "open", cancelAfter: far(90) }]);
  const B = project("B", run, [{ state: "finished", cancelAfter: at(30 * DAY) }, { state: "expired", cancelAfter: at(-10 * MIN) }, { state: "open", cancelAfter: at(60 * DAY) }]);
  const C = project("C", run, [0, 1, 2].map(() => ({ state: "finished" as const, cancelAfter: at(-12 * MIN) })));
  const parts = o.withC === false ? [A, B] : [A, B, C];
  return {
    file: {
      version: 1,
      network: "devnet",
      createdAt: at(-30 * MIN),
      finishedAt: at(-1 * MIN),
      rlusd: { currency: "524C555344000000000000000000000000000000", issuer: ACCOUNTS.issuer! },
      domainId: fakeHash("domain"),
      accounts: ACCOUNTS,
      preimagesFile: ".data/prestage-preimages.json",
      projects: Object.fromEntries(parts.map((x) => [x.p.key, x.p])),
    },
    preimages: {
      version: 1,
      warning: "SECRET",
      projects: Object.fromEntries(parts.map((x) => [x.p.projectId, x.preimages])),
    },
  };
}

function write(f: Fixture, dir = mkdtempSync(join(tmpdir(), "core07-"))) {
  const prestagePath = join(dir, "prestage.json");
  const preimagesPath = join(dir, "prestage-preimages.json");
  writeFileSync(prestagePath, JSON.stringify(f.file));
  writeFileSync(preimagesPath, JSON.stringify(f.preimages));
  return { dir, prestagePath, preimagesPath };
}

/** Devnet stand-in: knows the fixture's escrows, checks fulfillments, records every submitted tx. */
class StubLedger {
  readonly mode = "devnet" as const;
  readonly submitted: { type: string; args: unknown }[] = [];
  readonly escrows = new Map<string, EscrowSnapshot & { open: boolean }>();
  private n = 0;
  constructor(f: Fixture) {
    for (const p of Object.values(f.file.projects)) {
      for (const e of p!.escrows) if (e.state !== "finished") this.escrows.set(`${e.owner}:${e.offerSequence}`, { owner: e.owner, offerSequence: e.offerSequence, destination: e.destination, amount: e.amount, condition: e.condition, cancelAfter: e.cancelAfter, open: true });
    }
  }
  private tx(type: string, args: unknown, kind?: TxResult["kind"]): TxResult {
    this.submitted.push({ type, args });
    const hash = fakeHash(`stub:${this.n++}:${type}`);
    return { hash, explorerUrl: explorerTxUrl(hash), result: "tesSUCCESS", ...(kind ? { kind } : {}), at: NOW };
  }
  async getEscrow(owner: string, seq: number) {
    const e = this.escrows.get(`${owner}:${seq}`);
    return e?.open ? e : null;
  }
  async preflightFinish() {
    return { ok: true };
  }
  async attest(p: { signer: string; spv: string; memo: AttestMemo }) {
    return this.tx(`attest:${p.memo.kind}`, p, p.memo.kind === "audit" ? "audit_attested" : p.memo.kind === "verdict" ? "verdict_attested" : undefined);
  }
  async submitSignedBlob(blob: string) {
    // Core has already verified this blob; record only public transaction identifiers in the test ledger.
    return this.tx("signed:audit", { signed: true }, "audit_attested");
  }
  async finishEscrow(p: { owner: string; offerSequence: number; condition: string; fulfillment: string }) {
    const e = this.escrows.get(`${p.owner}:${p.offerSequence}`);
    assert.ok(e?.open, "finish of an unknown/closed escrow");
    assert.equal(conditionFromFulfillment(p.fulfillment), e.condition, "fulfillment must match the escrow condition");
    e.open = false;
    return this.tx("EscrowFinish", { owner: p.owner, offerSequence: p.offerSequence }, "escrow_finished");
  }
  async cancelEscrow(p: { owner: string; offerSequence: number }) {
    const e = this.escrows.get(`${p.owner}:${p.offerSequence}`);
    assert.ok(e?.open && Date.parse(e.cancelAfter!) <= Date.parse(NOW) + DAY);
    e.open = false;
    return this.tx("EscrowCancel", p, "escrow_cancelled");
  }
  async repayLoan(p: { project: { id: string }; amount: string; source: string }) {
    return this.tx("LoanPay", { projectId: p.project.id, amount: p.amount, source: p.source }, "loan_payment");
  }
  async withdraw(p: { project: { id: string }; investor: string; amount: string }) {
    return this.tx("VaultWithdraw", { projectId: p.project.id, investor: p.investor, amount: p.amount }, "vault_withdraw");
  }
  async tryFinishWithWrongFulfillment(p: { owner: string; offerSequence: number }) {
    return { ...this.tx("EscrowFinish(random)", p, "release_refused"), result: "tecCRYPTOCONDITION_ERROR" };
  }
}
const asPort = (s: StubLedger) =>
  new Proxy(s, {
    get: (t, k) => (k in t ? (t as unknown as Record<string | symbol, unknown>)[k] : () => Promise.reject(new Error(`stub ledger: ${String(k)} not expected`))),
  }) as unknown as LedgerPort;

function devnetCore(f: Fixture) {
  const paths = write(f);
  const stub = new StubLedger(f);
  const clock = new FakeClock(NOW);
  const core = createCore({ inMemory: true, clock, ledger: asPort(stub), prestageAuditSigner: createPrestageAuditSigner(async (address) => {
    const signer = ["inspector1", "inspector2", "inspector3"].map((role) => testSigner(`ps:${role}`)).find((s) => s.wallet.classicAddress === address);
    if (!signer) throw new Error("no assigned signer");
    return signer;
  }, async (p) => ({ ...buildAttestationTx(p), Fee: "12", Sequence: 1, LastLedgerSequence: 999999 })), env: { LEDGER_MODE: "devnet", PRESTAGE_FILE: paths.prestagePath, PRESTAGE_PREIMAGES_FILE: paths.preimagesPath } });
  return { ...paths, stub, clock, core, svc: core.service };
}

describe("CORE-07 importPrestage (offline)", () => {
  it("maps A/B/C to the demo states with chain refs from the file", async () => {
    const f = fixture();
    const paths = write(f);
    const store = new MemoryStore();
    const vault = new MemoryPreimageVault();
    const r = await importPrestage({ ...paths, store, vault, now: () => new Date(NOW) });
    const db = await store.read((d) => d);
    const A = db.projects.find((p) => p.id === r.ids.A)!;
    const B = db.projects.find((p) => p.id === r.ids.B)!;
    const C = db.projects.find((p) => p.id === r.ids.C)!;
    const fa = f.file.projects.A!;

    assert.equal(A.name, "Maple St Duplex"); // core's Maple fixture name (UI / verifier fixtures line up)
    assert.equal(A.status, "escrowed");
    assert.deepEqual(A.milestones.map((m) => m.status), ["escrowed", "escrowed", "escrowed"]);
    assert.deepEqual(A.milestones.map((m) => m.amount), ["9000", "12000", "9000"]);
    assert.deepEqual(A.sov?.map((l) => [l.code, l.amount]), [["foundation", "9000"], ["framing", "12000"], ["dry_in", "9000"]]);
    assert.ok(A.sov?.every((l) => l.evidence.length > 0 && l.visualCriteria.length > 0));
    assert.deepEqual(A.chain, {
      spv: fa.chain.spv,
      vaultId: fa.chain.vaultId,
      loanBrokerId: fa.chain.loanBrokerId,
      loanId: fa.chain.loanId,
      shareMptIssuanceId: fa.chain.shareMptIssuanceId,
      subscriptionDate: fa.dates.subscriptionDate,
      redemptionDate: fa.dates.redemptionDate,
    });
    A.milestones.forEach((m, i) => {
      const e = fa.escrows[i]!;
      assert.deepEqual(m.escrow, { owner: e.owner, offerSequence: e.offerSequence, condition: e.condition, createTx: e.createTx, createdAt: e.createdAt });
      assert.equal(m.cancelAfter, e.cancelAfter);
    });

    assert.equal(B.status, "escrowed");
    assert.deepEqual(B.milestones.map((m) => m.status), ["released", "escrowed", "escrowed"]);
    assert.ok(Date.parse(B.milestones[1]!.cancelAfter!) < Date.parse(NOW), "B M2 is past CancelAfter (route 13 / keeper)");
    assert.equal(B.milestones[0]!.escrow?.finishTx, f.file.projects.B!.escrows[0]!.finishTx);

    assert.equal(C.status, "completed");
    assert.ok(C.milestones.every((m) => m.status === "released"));
    assert.equal(db.repayments.filter((x) => x.projectId === C.id).length, 2);

    // participants: one devnet builder, panel = inspector1..3, investor3 without KYC
    assert.deepEqual(db.builders.map((b) => [b.name, b.address, b.verified]), [["Hudson Valley Builders", ACCOUNTS.builder, true]]);
    assert.deepEqual(db.inspectors.map((i) => i.address), [ACCOUNTS.inspector1, ACCOUNTS.inspector2, ACCOUNTS.inspector3]);
    assert.deepEqual(db.investors.map((i) => !!i.kycCredentialTx), [true, true, false]);
    assert.deepEqual(db.projectMeta.find((m) => m.projectId === A.id)?.assignment?.inspectors, [ACCOUNTS.inspector1]);

    // audit trail with explorer links; the tecNO_AUTH deposit is kept with its result
    const aEvents = db.chainEvents.filter((e) => e.projectId === A.id);
    assert.equal(aEvents.filter((e) => e.kind === "escrow_created").length, 3);
    assert.ok(aEvents.every((e) => e.explorerUrl.startsWith("https://devnet.xrpl.org/transactions/")));
    assert.equal(aEvents.find((e) => e.kind === "vault_deposit" && e.result)?.result, "tecNO_AUTH");
    const bFinish = db.chainEvents.find((e) => e.projectId === B.id && e.kind === "escrow_finished");
    assert.equal(bFinish?.milestoneId, B.milestones[0]!.id);
    assert.equal(db.chainEvents.find((e) => e.projectId === B.id && e.kind === "verdict_attested")?.milestoneId, B.milestones[0]!.id);
  });

  it("imports each preimage keyed {projectId, milestoneId} like conditionsForClose, released ones marked", async () => {
    const f = fixture();
    const vault = new MemoryPreimageVault();
    await importPrestage({ ...write(f), store: new MemoryStore(), vault, now: () => new Date(NOW) });
    const entries = await vault.all();
    assert.equal(entries.length, 9);
    for (const p of Object.values(f.file.projects)) {
      for (const e of p!.escrows) {
        const v = entries.find((x) => x.projectId === p!.projectId && x.milestoneId === e.milestoneId)!;
        assert.equal(v.condition, e.condition.toUpperCase());
        assert.equal(conditionFromPreimage(v.preimage), v.condition);
        assert.equal(!!v.releasedAt, e.state === "finished");
      }
    }
  });

  it("refuses a preimage that does not match its escrow condition, without touching store or vault", async () => {
    const f = fixture();
    const mid = f.file.projects.A!.escrows[1]!.milestoneId;
    const secret = randomBytes(32).toString("hex");
    f.preimages.projects[f.file.projects.A!.projectId]![mid]!.preimage = secret;
    const store = new MemoryStore();
    await store.write((d) => d.builders.push({ id: "keep", name: "keep", address: ACCOUNTS.builder!, licenseNumber: "x", insurancePolicy: "x", completedProjects: 0, riskTier: "low", verified: false }));
    const vault = new MemoryPreimageVault();
    await assert.rejects(importPrestage({ ...write(f), store, vault, now: () => new Date(NOW) }), (e: unknown) => {
      assert.ok(isCode("CONFLICT", /does not match the escrow condition/)(e));
      assert.ok(!(e as Error).message.includes(secret), "never put a preimage in an error");
      return true;
    });
    assert.deepEqual(await store.read((d) => d.builders.map((b) => b.id)), ["keep"]);
    assert.equal((await vault.all()).length, 0);
  });

  it("is idempotent; a re-staged file replaces the old demo projects", async () => {
    const store = new MemoryStore();
    const vault = new MemoryPreimageVault();
    const now = () => new Date(NOW);
    const f1 = write(fixture("r1"));
    await importPrestage({ ...f1, store, vault, now });
    const once = await store.read((d) => d);
    await importPrestage({ ...f1, store, vault, now });
    const twice = await store.read((d) => d);
    assert.deepEqual(twice, once);
    assert.equal((await vault.all()).length, 9);

    await importPrestage({ ...write(fixture("r2")), store, vault, now });
    const ids = await store.read((d) => d.projects.map((p) => p.id));
    assert.deepEqual(ids.sort(), ["ps-r2-a", "ps-r2-b", "ps-r2-c"]);
    assert.ok((await vault.all()).every((e) => e.projectId.startsWith("ps-r2-")));
    assert.ok(await store.read((d) => d.chainEvents.every((e) => e.projectId.startsWith("ps-r2-"))));
  });

  it("stale or missing files fail with a 4xx pointing at the prestage command", async () => {
    const now = () => new Date(NOW);
    const base = { store: new MemoryStore(), vault: new MemoryPreimageVault(), now };
    await assert.rejects(planPrestageImport({ ...base, prestagePath: "/nonexistent/prestage.json" }), (e: unknown) => {
      assert.ok(isCode("VALIDATION", /not found/)(e));
      assert.equal((e as DomainError).status, 400);
      assert.ok((e as Error).message.includes(RESTAGE_HINT));
      return true;
    });
    await assert.rejects(planPrestageImport({ ...base, ...write(fixture("r1", { aCancelAfter: at(10 * MIN) })) }), (e: unknown) => {
      assert.ok(isCode("CONFLICT", /too close/)(e));
      assert.equal((e as DomainError).status, 409);
      return true;
    });
    const noPre = fixture();
    delete noPre.preimages.projects[noPre.file.projects.A!.projectId];
    await assert.rejects(planPrestageImport({ ...base, ...write(noPre) }), isCode("VALIDATION", /No preimage/));
    await assert.rejects(planPrestageImport({ ...base, ...write(fixture()), walletsPlatform: fakeAddress("other-wallets") }), isCode("VALIDATION", /another wallet store/));
    // C is optional (withdraw beat unavailable), A and B are not
    const noC = await planPrestageImport({ ...base, ...write(fixture("r1", { withC: false })) });
    assert.deepEqual(Object.keys(noC.result.ids), ["A", "B"]);
  });

  it("with a ledger, refuses escrows a rehearsal already consumed", async () => {
    const f = fixture();
    const stub = new StubLedger(f);
    const e = f.file.projects.A!.escrows[0]!;
    stub.escrows.get(`${e.owner}:${e.offerSequence}`)!.open = false;
    await assert.rejects(
      planPrestageImport({ ...write(f), store: new MemoryStore(), vault: new MemoryPreimageVault(), ledger: stub, now: () => new Date(NOW) }),
      isCode("CONFLICT", /no longer on the ledger/),
    );
  });
});

describe("CORE-07 devnet route 21 (stub ledger)", () => {
  it("reset (default seed) -> A release, B cancel + refund, C withdraw", async () => {
    const f = fixture();
    const { svc, stub } = devnetCore(f);
    await svc.resetDemo({});
    const fa = f.file.projects.A!;
    const a = await svc.getProject(fa.projectId);
    assert.equal(a.project.status, "escrowed");
    assert.equal(a.vault?.phase, "investment");
    assert.equal(a.loan?.principalOutstanding, "30000.00");
    assert.deepEqual(a.inspectors.map((i) => i.address), [ACCOUNTS.inspector1]);
    // 04 §Pre-staged: M1 + M2 evidence and audits uploaded (2 audit attestations on the ledger)
    assert.deepEqual(a.project.milestones.map((m) => m.status), ["audited", "audited", "escrowed"]);
    assert.equal(stub.submitted.filter((s) => s.type === "signed:audit").length, 2);

    const [m1, m2] = a.project.milestones;
    const r1 = await svc.runChecks(fa.projectId, m1!.id);
    assert.equal(r1.verdict.decision, "pass");
    assert.ok(r1.release?.explorerUrl.startsWith("https://devnet.xrpl.org/transactions/"));
    const fin = stub.submitted.find((s) => s.type === "EscrowFinish")!;
    assert.deepEqual(fin.args, { owner: fa.escrows[0]!.owner, offerSequence: fa.escrows[0]!.offerSequence });

    const r2 = await svc.runChecks(fa.projectId, m2!.id); // IMG_2231.jpg re-uploaded from Project C
    assert.equal(r2.verdict.decision, "fail");
    assert.ok(r2.verdict.checks.some((c) => c.check === "no_duplicate_photo" && c.result === "fail" && /IMG_2231.jpg matches .* from project ps-r1-c/.test(c.reason)));

    const steal = await svc.tryStealDemo(fa.projectId, m2!.id);
    assert.equal(steal.result, "tecCRYPTOCONDITION_ERROR");

    const fb = f.file.projects.B!;
    const bm2 = fb.milestones[1]!.id;
    const c = await svc.cancelExpired(fb.projectId, bm2);
    assert.equal(c.milestone.status, "refunded");
    assert.deepEqual(stub.submitted.find((s) => s.type === "LoanPay")?.args, { projectId: fb.projectId, amount: "12000", source: "escrow_refund" });
    assert.equal((await svc.getProject(fb.projectId)).project.status, "stalled");

    const fc = f.file.projects.C!;
    const pos = (await svc.portfolio(ACCOUNTS.investor1!)).find((x) => x.projectId === fc.projectId);
    assert.equal(pos?.phase, "redemption");
    await assert.rejects(svc.withdraw(fc.projectId, { investor: ACCOUNTS.investor1!, amount: "7300" }), isCode("CONFLICT", /Withdrawable now: 7254\.00 RLUSD/)); // 60% of 12090
    const w = await svc.withdraw(fc.projectId, { investor: ACCOUNTS.investor1!, amount: "1000" });
    assert.equal(w.events[0]?.kind, "vault_withdraw");
  });

  it("stale prestage: 4xx and the current state is kept", async () => {
    const f = fixture();
    const ctx = devnetCore(f);
    await ctx.svc.resetDemo({ seed: "prestage" });
    const before = await ctx.core.store.read((d) => d.projects.length);
    writeFileSync(ctx.prestagePath, JSON.stringify(fixture("r9", { aCancelAfter: at(5 * MIN) }).file));
    await assert.rejects(ctx.svc.resetDemo({ seed: "prestage" }), isCode("CONFLICT", /prestage --only A,B/));
    assert.equal(await ctx.core.store.read((d) => d.projects.length), before);
    await assert.rejects(ctx.svc.resetDemo({ seed: "maple-st" }), isCode("VALIDATION", /use seed "prestage"/));
  });
});

describe("CORE-07 fake mode untouched", () => {
  it("maple-st still seeds the fake scenario; prestage is refused; no seed = empty store", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "core07-fake-"));
    const core = createCore({ dataDir, env: {}, clock: new FakeClock(NOW) });
    await core.service.resetDemo({ seed: "maple-st" });
    assert.deepEqual((await core.service.listProjects()).map((p) => p.id).sort(), ["maple-st-duplex", "oak-ave-renovation"]);
    await assert.rejects(core.service.resetDemo({ seed: "prestage" }), isCode("VALIDATION", /LEDGER_MODE=devnet/));
    await core.service.resetDemo({});
    assert.equal((await core.service.listProjects()).length, 0);
  });
});

describe("prestage signer precheck", () => {
  it("missing signer fails before reset changes the existing store", async () => {
    const f = fixture();
    const { core, stub, clock, prestagePath, preimagesPath, svc } = devnetCore(f);
    await svc.resetDemo({});
    const before = await core.store.read((db) => structuredClone(db));
    const submitted = stub.submitted.length;
    const missing = createCore({ inMemory: true, store: core.store, clock, ledger: asPort(stub), env: {
      LEDGER_MODE: "devnet", PRESTAGE_FILE: prestagePath, PRESTAGE_PREIMAGES_FILE: preimagesPath,
    } });
    await assert.rejects(missing.service.resetDemo({}), isCode("VALIDATION", /audit signer/));
    assert.deepEqual(await core.store.read((db) => db), before);
    assert.equal(stub.submitted.length, submitted);
  });
});


describe("prestage signer identity", () => {
  it("refuses a resolver that returns a different inspector", async () => {
    const signer = createPrestageAuditSigner(async () => testSigner("wrong-inspector"), async (p) => ({ ...buildAttestationTx(p), Fee: "12", Sequence: 1, LastLedgerSequence: 999999 }));
    await assert.rejects(signer.checkInspector(ACCOUNTS.inspector1!), isCode("VALIDATION", /unavailable or mismatched/));
  });
});
