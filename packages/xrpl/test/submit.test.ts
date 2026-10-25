// Offline tests for submission hardening (XRPL-12): lock, classification, retry engine, error mapping.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DisconnectedError } from "xrpl";
import { XrplTxError, toErrorCode } from "../src/errors.ts";
import {
  classifyPreliminary,
  isConnectionError,
  isTransientRpcError,
  lockedAccounts,
  submitReliably,
  withAccountLock,
  type LedgerIo,
  type Lookup,
  type ResignMode,
  type SignedBlob,
} from "../src/submit.ts";

const tick = () => new Promise<void>((r) => setImmediate(r));

// ── lock ──────────────────────────────────────────────────────────────────────────────────

test("withAccountLock serialises the same account (FIFO) and runs other accounts in parallel", async () => {
  const log: string[] = [];
  let inA = 0;
  let maxInA = 0;
  const job = (acct: string, id: string) =>
    withAccountLock(acct, async () => {
      if (acct === "A") maxInA = Math.max(maxInA, ++inA);
      log.push(`start ${id}`);
      await tick();
      await tick();
      log.push(`end ${id}`);
      if (acct === "A") inA--;
      return id;
    });
  const out = await Promise.all([job("A", "a1"), job("A", "a2"), job("B", "b1"), job("A", "a3")]);
  assert.deepEqual(out, ["a1", "a2", "b1", "a3"]);
  assert.equal(maxInA, 1);
  const aOrder = log.filter((l) => l.includes(" a"));
  assert.deepEqual(aOrder, ["start a1", "end a1", "start a2", "end a2", "start a3", "end a3"]);
  // b1 started before a1 finished → different accounts do not block each other
  assert.ok(log.indexOf("start b1") < log.indexOf("end a1"));
  assert.deepEqual(lockedAccounts(), []);
});

test("withAccountLock is re-entrant and releases on throw", async () => {
  const nested = await withAccountLock("R", () => withAccountLock("R", async () => "inner"));
  assert.equal(nested, "inner");
  await assert.rejects(withAccountLock("R", async () => Promise.reject(new Error("boom"))), /boom/);
  assert.equal(await withAccountLock("R", async () => "after"), "after");
  assert.deepEqual(lockedAccounts(), []);
});

test("20 parallel submits through the lock never race on Sequence (fake ledger)", async () => {
  let ledgerSeq = 7;
  const used: number[] = [];
  const send = () =>
    withAccountLock("rSAME", async () => {
      const seq = ledgerSeq; // "autofill"
      await tick(); // sign + network
      if (seq !== ledgerSeq) throw new Error(`tefPAST_SEQ ${seq}`);
      ledgerSeq++;
      used.push(seq);
      return seq;
    });
  const seqs = await Promise.all(Array.from({ length: 20 }, send));
  assert.deepEqual(seqs, Array.from({ length: 20 }, (_, i) => 7 + i));
  assert.equal(new Set(used).size, 20);
});

// ── classification ────────────────────────────────────────────────────────────────────────

test("classifyPreliminary", () => {
  const cases: Record<string, string> = {
    tesSUCCESS: "pending",
    terQUEUED: "pending",
    terPRE_SEQ: "pending",
    tefALREADY: "pending",
    tecTOO_SOON: "pending", // goes on-ledger; final result decides
    telINSUF_FEE_P: "resubmit",
    telCAN_NOT_QUEUE: "resubmit",
    telCAN_NOT_QUEUE_FULL: "resubmit",
    telCAN_NOT_QUEUE_FEE: "resubmit",
    tefPAST_SEQ: "past_seq",
    tefMAX_LEDGER: "expired",
    temMALFORMED: "fatal",
    temBAD_FEE: "fatal",
    tefBAD_AUTH: "fatal",
    tefMASTER_DISABLED: "fatal",
    telLOCAL_ERROR: "fatal",
  };
  for (const [code, want] of Object.entries(cases)) assert.equal(classifyPreliminary(code), want, code);
});

test("transient RPC + connection error detection", () => {
  assert.ok(isTransientRpcError({ data: { error: "tooBusy" } }));
  assert.ok(isTransientRpcError({ data: { error: "noNetwork" } }));
  assert.ok(!isTransientRpcError({ data: { error: "invalidTransaction" } }));
  assert.ok(isConnectionError(new DisconnectedError("websocket closed")));
  assert.ok(isConnectionError(new Error("WebSocket is not open: readyState 3")));
  assert.ok(!isConnectionError(new Error("tecTOO_SOON")));
});

// ── errors ────────────────────────────────────────────────────────────────────────────────

test("XrplTxError stays backwards compatible and carries typed fields", () => {
  const old = new XrplTxError("Payment", "tecUNFUNDED_PAYMENT", "ABC123");
  assert.equal(old.txType, "Payment");
  assert.equal(old.engineResult, "tecUNFUNDED_PAYMENT");
  assert.equal(old.hash, "ABC123");
  assert.equal(old.retriable, false);
  assert.equal(old.explorerUrl, "https://devnet.xrpl.org/transactions/ABC123");
  assert.match(old.message, /^Payment failed: tecUNFUNDED_PAYMENT \(https:\/\/devnet\.xrpl\.org\/transactions\/ABC123\)$/);
  assert.ok(old.onLedger);
  const r = new XrplTxError("VaultDeposit", "tefMAX_LEDGER", undefined, { retriable: true });
  assert.equal(r.retriable, true);
  assert.equal(r.explorerUrl, undefined);
  assert.ok(!r.onLedger);
});

test("toErrorCode maps to docs/05-api.md ErrorCode", () => {
  assert.equal(toErrorCode(new XrplTxError("LoanSet", "tecTOO_SOON", "H")), "too_soon");
  assert.equal(toErrorCode(new XrplTxError("EscrowFinish", "tecNO_TARGET", "H")), "not_found");
  assert.equal(toErrorCode(new XrplTxError("EscrowFinish", "tecNO_ENTRY", "H")), "not_found");
  assert.equal(toErrorCode(new XrplTxError("Payment", "temBAD_AMOUNT")), "validation");
  assert.equal(toErrorCode(new XrplTxError("Payment", "tecUNFUNDED_PAYMENT", "H")), "ledger_error");
  assert.equal(toErrorCode(new XrplTxError("Payment", "tefMAX_LEDGER", undefined, { retriable: true })), "ledger_error");
  assert.equal(toErrorCode({ data: { error: "entryNotFound" } }), "not_found");
  assert.equal(toErrorCode(new Error("whatever")), "ledger_error");
});

// ── retry engine against a scripted fake ledger ───────────────────────────────────────────

type Step = string | Error | { prelim: string; final?: string };

/** Fake ledger: each submit consumes one scripted step; `final` (or tesSUCCESS for tesSUCCESS/terQUEUED) gets validated next ledger. */
class FakeLedger implements LedgerIo {
  validated = 100;
  submits: string[] = [];
  reconnects = 0;
  private readonly applied = new Map<string, { result: string; ledger: number }>();
  constructor(private readonly steps: Step[]) {}

  async submit(blob: string) {
    this.submits.push(blob);
    const step = this.steps.shift() ?? "tesSUCCESS";
    if (step instanceof Error) throw step;
    const s = typeof step === "string" ? { prelim: step } : step;
    const final = s.final ?? (s.prelim === "tesSUCCESS" ? "tesSUCCESS" : undefined);
    if (final && !this.applied.has(blob)) this.applied.set(blob, { result: final, ledger: this.validated + 1 });
    return { engineResult: s.prelim };
  }
  /** Mark a blob as applied without a successful submit response (e.g. socket died after the server took it). */
  applyQuietly(blob: string, result = "tesSUCCESS") {
    this.applied.set(blob, { result, ledger: this.validated + 1 });
  }
  async lookup(hash: string): Promise<Lookup> {
    const a = this.applied.get(hash); // blob == hash in this fake
    if (a && a.ledger <= this.validated) return { status: "validated", result: { hash, validated: true, meta: { TransactionResult: a.result } } };
    if (a) return { status: "pending" };
    return { status: "missing", searchedAll: true };
  }
  async validatedLedgerIndex() {
    return this.validated;
  }
  async reconnect() {
    this.reconnects++;
  }
  async sleep() {
    this.validated++;
  }
}

const blob = (id: string, lls = 105): SignedBlob => ({ blob: id, hash: id, account: "rA", txType: "Payment", sequence: 1, lastLedgerSequence: lls });

function resigner() {
  const calls: ResignMode[] = [];
  let n = 0;
  const resign = async (mode: ResignMode) => {
    calls.push(mode);
    return blob(`B${++n}`, 200);
  };
  return { calls, resign };
}

test("tesSUCCESS → waits for validation, single submit", async () => {
  const io = new FakeLedger(["tesSUCCESS"]);
  const out = await submitReliably(blob("A"), io, { pollMs: 0 });
  assert.equal((out.meta as { TransactionResult: string }).TransactionResult, "tesSUCCESS");
  assert.deepEqual(io.submits, ["A"]);
});

test("telINSUF_FEE_P → re-sign with the SAME Sequence (fresh fee), then success", async () => {
  const io = new FakeLedger(["telINSUF_FEE_P", "tesSUCCESS"]);
  const r = resigner();
  const out = await submitReliably(blob("A"), io, { pollMs: 0, backoffMs: 0, resign: r.resign });
  assert.equal(out.hash, "B1");
  assert.deepEqual(r.calls, ["same_seq"]);
  assert.deepEqual(io.submits, ["A", "B1"]);
});

test("telCAN_NOT_QUEUE_FULL on a pre-signed blob → resubmits the same blob", async () => {
  const io = new FakeLedger(["telCAN_NOT_QUEUE_FULL", "tesSUCCESS"]);
  const out = await submitReliably(blob("A"), io, { pollMs: 0, backoffMs: 0 });
  assert.equal(out.hash, "A");
  assert.deepEqual(io.submits, ["A", "A"]);
});

test("tooBusy RPC error is retried; exhausting attempts throws retriable", async () => {
  const busy = Object.assign(new Error("tooBusy"), { data: { error: "tooBusy" } });
  const ok = await submitReliably(blob("A"), new FakeLedger([busy, "tesSUCCESS"]), { pollMs: 0, backoffMs: 0 });
  assert.equal(ok.hash, "A");
  const io = new FakeLedger([busy, busy, busy]);
  await assert.rejects(submitReliably(blob("A"), io, { pollMs: 0, backoffMs: 0, maxAttempts: 3 }), (e: unknown) => {
    assert.ok(e instanceof XrplTxError);
    assert.equal(e.engineResult, "tooBusy");
    assert.equal(e.retriable, true);
    return true;
  });
  assert.equal(io.submits.length, 3);
});

test("tec* final result is never retried; error carries hash + explorer link", async () => {
  const io = new FakeLedger([{ prelim: "tecTOO_SOON", final: "tecTOO_SOON" }]);
  const r = resigner();
  await assert.rejects(submitReliably(blob("A"), io, { pollMs: 0, resign: r.resign }), (e: unknown) => {
    assert.ok(e instanceof XrplTxError);
    assert.equal(e.engineResult, "tecTOO_SOON");
    assert.equal(e.hash, "A");
    assert.equal(e.retriable, false);
    assert.equal(toErrorCode(e), "too_soon");
    return true;
  });
  assert.deepEqual(io.submits, ["A"]);
  assert.deepEqual(r.calls, []);
});

test("tesSUCCESS preliminary that validates as tec* → throws, no retry", async () => {
  const io = new FakeLedger([{ prelim: "tesSUCCESS", final: "tecUNFUNDED_PAYMENT" }]);
  await assert.rejects(submitReliably(blob("A"), io, { pollMs: 0 }), /tecUNFUNDED_PAYMENT/);
  assert.equal(io.submits.length, 1);
});

test("tem* / other tef* → immediate non-retriable failure", async () => {
  for (const code of ["temMALFORMED", "tefBAD_AUTH"]) {
    const io = new FakeLedger([code]);
    const r = resigner();
    await assert.rejects(submitReliably(blob("A"), io, { pollMs: 0, resign: r.resign }), (e: unknown) => {
      assert.ok(e instanceof XrplTxError);
      assert.equal(e.engineResult, code);
      assert.equal(e.retriable, false);
      assert.equal(e.hash, undefined); // never reached a ledger → no explorer link
      return true;
    });
    assert.equal(io.submits.length, 1);
    assert.deepEqual(r.calls, []);
  }
});

test("tefPAST_SEQ on a never-sent blob → re-autofill a fresh Sequence", async () => {
  const io = new FakeLedger(["tefPAST_SEQ", "tesSUCCESS"]);
  const r = resigner();
  const out = await submitReliably(blob("A"), io, { pollMs: 0, backoffMs: 0, resign: r.resign });
  assert.equal(out.hash, "B1");
  assert.deepEqual(r.calls, ["new_seq"]);
});

test("socket dies mid-submit but the tx applied → resubmit same blob, tefPAST_SEQ, found validated; never re-signed", async () => {
  const io = new FakeLedger([new DisconnectedError("websocket closed"), "tefPAST_SEQ"]);
  io.applyQuietly("A");
  const r = resigner();
  const out = await submitReliably(blob("A"), io, { pollMs: 0, backoffMs: 0, resign: r.resign });
  assert.equal(out.hash, "A");
  assert.equal(io.reconnects, 1);
  assert.deepEqual(io.submits, ["A", "A"]);
  assert.deepEqual(r.calls, []);
});

test("terQUEUED that never makes it before LastLedgerSequence → provably not applied → same-Sequence re-sign", async () => {
  const io = new FakeLedger(["terQUEUED", "tesSUCCESS"]);
  const r = resigner();
  const out = await submitReliably(blob("A", 103), io, { pollMs: 0, backoffMs: 0, resign: r.resign });
  assert.equal(out.hash, "B1");
  assert.deepEqual(r.calls, ["same_seq"]);
  assert.ok(io.validated >= 103);
});

test("terQUEUED that validates → no retry", async () => {
  const io = new FakeLedger([{ prelim: "terQUEUED", final: "tesSUCCESS" }]);
  const out = await submitReliably(blob("A"), io, { pollMs: 0 });
  assert.equal(out.hash, "A");
  assert.equal(io.submits.length, 1);
});

test("expiry with incomplete server history is NOT treated as proof → no re-sign", async () => {
  const io = new FakeLedger(["tesSUCCESS"]);
  io.lookup = async () => ({ status: "missing", searchedAll: false });
  const r = resigner();
  await assert.rejects(submitReliably(blob("A", 101), io, { pollMs: 0, resign: r.resign }), (e: unknown) => {
    assert.ok(e instanceof XrplTxError);
    assert.equal(e.engineResult, "unknown_outcome");
    assert.equal(e.retriable, false);
    return true;
  });
  assert.deepEqual(r.calls, []);
});

test("pre-signed blob that expires → throws retriable tefMAX_LEDGER (caller must re-prepare)", async () => {
  const io = new FakeLedger(["terQUEUED"]);
  await assert.rejects(submitReliably(blob("A", 102), io, { pollMs: 0, backoffMs: 0 }), (e: unknown) => {
    assert.ok(e instanceof XrplTxError);
    assert.equal(e.engineResult, "tefMAX_LEDGER");
    assert.equal(e.retriable, true);
    return true;
  });
  assert.equal(io.submits.length, 1);
});
