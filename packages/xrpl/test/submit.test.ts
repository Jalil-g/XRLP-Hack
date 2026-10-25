// Offline tests for submission hardening (XRPL-12): lock, classification, retry engine, error mapping.
import assert from "node:assert/strict";
import { test } from "node:test";
import { inspect } from "node:util";
import { DisconnectedError, TimeoutError } from "xrpl";
import { XrplTxError, redactedCause, redactSecrets, toErrorCode, toLedgerError } from "../src/errors.ts";
import { submitRequest } from "../src/client.ts";
import {
  assertLlsMargin,
  classifyPreliminary,
  isConnectionError,
  isTransientRpcError,
  lockedAccounts,
  MAX_LLS_MARGIN,
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

type Step = string | Error | { prelim: string; final?: string; soft?: Step };

/**
 * Fake ledger: each submit consumes one scripted step; `final` (or tesSUCCESS for tesSUCCESS/terQUEUED) gets validated
 * next ledger. Models fail_hard like rippled (TapFAIL_HARD): a tec* answered to a fail_hard submit is DISCARDED (not
 * applied, nothing validates); the same blob resubmitted without fail_hard is answered by the step's `soft` (default:
 * the same tec, now applied) without consuming a new step. `cached`: like rippled, a lookup of any blob it has seen
 * answers "known, not validated" instead of txnNotFound.
 */
class FakeLedger implements LedgerIo {
  validated = 100;
  submits: string[] = [];
  /** fail_hard flag of every submit, in order. */
  failHard: boolean[] = [];
  reconnects = 0;
  cached = false;
  private readonly seen = new Set<string>();
  private readonly applied = new Map<string, { result: string; ledger: number }>();
  /** Blobs whose tec was discarded under fail_hard → the step that answers their soft resubmit. */
  private readonly discarded = new Map<string, { prelim: string; final?: string; soft?: Step }>();
  constructor(private readonly steps: Step[]) {}

  async submit(blob: string, opts?: { failHard?: boolean }) {
    const failHard = opts?.failHard !== false;
    this.submits.push(blob);
    this.failHard.push(failHard);
    this.seen.add(blob);
    const pending = !failHard ? this.discarded.get(blob) : undefined;
    if (pending) this.discarded.delete(blob);
    const step = pending ? (pending.soft ?? { prelim: pending.prelim, final: pending.final ?? pending.prelim }) : (this.steps.shift() ?? "tesSUCCESS");
    if (step instanceof Error) throw step;
    const s = typeof step === "string" ? { prelim: step } : step;
    if (failHard && s.prelim.startsWith("tec")) {
      this.discarded.set(blob, s); // TapFAIL_HARD: "would fail with a tec", nothing applied, not relayed, not held
      return { engineResult: s.prelim };
    }
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
    if (a || (this.cached && this.seen.has(hash))) return { status: "pending" };
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
    assert.ok(e.onLedger);
    return true;
  });
  // fail_hard discarded the tec → the same blob once more without fail_hard, which lands it on-ledger
  assert.deepEqual(io.submits, ["A", "A"]);
  assert.deepEqual(io.failHard, [true, false]);
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

// ── security review 2026-10-25: H1 / H2 / M3 / L1 ─────────────────────────────────────────

/**
 * Sequence-aware fake (one account): a relayed blob applies at a given ledger only if its Sequence is the account's
 * current one and its LastLedgerSequence hasn't passed; a blob whose Sequence is gone gets tefPAST_SEQ.
 * `script` overrides the next submit(s). Lookups answer from what applied.
 */
class SeqLedger implements LedgerIo {
  validated = 100;
  accountSeq = 1;
  readonly applied = new Map<string, number>();
  readonly relayed: { b: SignedBlob; at: number }[] = [];
  readonly script: ((b: SignedBlob) => Promise<{ engineResult: string }>)[] = [];
  readonly submits: string[] = [];
  readonly blobs = new Map<string, SignedBlob>();

  mk(hash: string, sequence: number, lastLedgerSequence: number): SignedBlob {
    const b: SignedBlob = { blob: hash, hash, account: "rA", txType: "Payment", sequence, lastLedgerSequence };
    this.blobs.set(hash, b);
    return b;
  }
  relay(b: SignedBlob, inLedgers = 1) {
    this.relayed.push({ b, at: this.validated + inLedgers });
  }
  async submit(blob: string) {
    const b = this.blobs.get(blob)!;
    this.submits.push(b.hash);
    const step = this.script.shift();
    if (step) return step(b);
    if (this.applied.has(b.hash) || b.sequence! < this.accountSeq) return { engineResult: "tefPAST_SEQ" };
    this.relay(b);
    return { engineResult: "tesSUCCESS" };
  }
  async lookup(hash: string): Promise<Lookup> {
    const l = this.applied.get(hash);
    if (l !== undefined && l <= this.validated) return { status: "validated", result: { hash, validated: true, meta: { TransactionResult: "tesSUCCESS" } } };
    return { status: "missing", searchedAll: true };
  }
  async validatedLedgerIndex() {
    return this.validated;
  }
  async reconnect() {}
  async sleep() {
    this.validated++;
    for (const r of [...this.relayed]) {
      if (r.at > this.validated) continue;
      this.relayed.splice(this.relayed.indexOf(r), 1);
      if (r.b.sequence === this.accountSeq && this.validated <= r.b.lastLedgerSequence!) {
        this.applied.set(r.b.hash, this.validated);
        this.accountSeq++;
      }
    }
  }
}

test("H1: a maybe-sent blob superseded by a same-Sequence re-sign is still tracked; when it applies, no fresh Sequence is ever signed", async () => {
  const io = new SeqLedger();
  // A reaches server X, the socket dies before the reply; X relays A, which validates 3 ledgers later.
  io.script.push(async (b) => {
    io.relay(b, 3);
    throw new DisconnectedError("websocket closed");
  });
  // After the reconnect another backend hasn't seen A: telINSUF_FEE_P → same-Sequence re-sign.
  io.script.push(async () => ({ engineResult: "telINSUF_FEE_P" }));
  const calls: ResignMode[] = [];
  let n = 0;
  const resign = async (mode: ResignMode) => {
    calls.push(mode);
    return io.mk(`R${++n}`, mode === "same_seq" ? 1 : io.accountSeq, io.validated + 3);
  };
  const out = await submitReliably(io.mk("A", 1, 104), io, { pollMs: 0, backoffMs: 0, resign });
  assert.equal(out.hash, "A", "the blob that applied is the result");
  assert.deepEqual([...io.applied.keys()], ["A"], "exactly one blob of the intent applied");
  assert.ok(!calls.includes("new_seq"), `never re-signed with a fresh Sequence (calls: ${calls.join(", ")})`);
});

test("H1: tefPAST_SEQ with no earlier blob of this intent alive still takes a fresh Sequence (another tx used it)", async () => {
  const io = new SeqLedger();
  io.accountSeq = 2; // Sequence 1 was taken by someone else
  const calls: ResignMode[] = [];
  const out = await submitReliably(io.mk("A", 1, 110), io, {
    pollMs: 0,
    backoffMs: 0,
    resign: async (mode) => {
      calls.push(mode);
      return io.mk("B", io.accountSeq, io.validated + 5);
    },
  });
  assert.equal(out.hash, "B");
  assert.deepEqual(calls, ["new_seq"]);
});

test("H2: connection lost on every submit → never retriable while the blob may apply; retriable only after its LastLedgerSequence provably passed", async () => {
  for (const lookupsDead of [true, false]) {
    let v = 100;
    const io: LedgerIo = {
      submit: async () => Promise.reject(new DisconnectedError("websocket closed")),
      lookup: async (): Promise<Lookup> => (lookupsDead ? Promise.reject(new DisconnectedError("websocket closed")) : { status: "missing", searchedAll: true }),
      validatedLedgerIndex: async () => v,
      reconnect: async () => {},
      sleep: async () => void v++,
    };
    await assert.rejects(submitReliably(blob("A", 160), io, { pollMs: 0, backoffMs: 0 }), (e: unknown) => {
      assert.ok(e instanceof XrplTxError);
      if (lookupsDead) {
        assert.equal(e.engineResult, "connection_lost");
        assert.equal(e.retriable, false, "outcome unknown: must not invite a rebuild");
        assert.equal(e.hash, "A");
      } else {
        assert.equal(e.engineResult, "not_applied");
        assert.equal(e.retriable, true);
        assert.ok(v >= 160, `waited out LastLedgerSequence 160 before saying retriable (at ${v})`);
      }
      return true;
    });
  }
});

test("H2: transient failures at the attempt limit after a maybe-sent attempt → the earlier blob is waited for and returned", async () => {
  const io = new FakeLedger([new DisconnectedError("websocket closed"), "telINSUF_FEE_P", "telINSUF_FEE_P", "telINSUF_FEE_P", "telINSUF_FEE_P"]);
  io.applyQuietly("A");
  const r = resigner();
  const out = await submitReliably(blob("A"), io, { pollMs: 0, backoffMs: 0, maxAttempts: 5, resign: r.resign });
  assert.equal(out.hash, "A");
  assert.ok(r.calls.every((c) => c === "same_seq"));
});

test("H2: a lookup error while waiting is unknown_outcome (non-retriable); tooBusy lookups are polled through", async () => {
  const io = new FakeLedger(["tesSUCCESS"]);
  io.lookup = async () => Promise.reject(Object.assign(new Error("lgrIdxsInvalid"), { data: { error: "lgrIdxsInvalid" } }));
  await assert.rejects(submitReliably(blob("A"), io, { pollMs: 0 }), (e: unknown) => {
    assert.ok(e instanceof XrplTxError);
    assert.equal(e.engineResult, "unknown_outcome");
    assert.equal(e.retriable, false);
    assert.equal(e.hash, "A");
    return true;
  });
  const busyFirst = new FakeLedger(["tesSUCCESS"]);
  const realLookup = busyFirst.lookup.bind(busyFirst);
  let calls = 0;
  busyFirst.lookup = async (h) => (++calls <= 3 ? Promise.reject(Object.assign(new Error("tooBusy"), { data: { error: "tooBusy" } })) : realLookup(h));
  assert.equal((await submitReliably(blob("A"), busyFirst, { pollMs: 0 })).hash, "A");
});

test("H2: a re-sign that throws while an earlier blob may apply → unknown_outcome with that hash", async () => {
  const io = new FakeLedger([new DisconnectedError("websocket closed"), "telINSUF_FEE_P"]);
  await assert.rejects(
    submitReliably(blob("A"), io, { pollMs: 0, backoffMs: 0, resign: async () => Promise.reject(new Error("account_info failed")) }),
    (e: unknown) => e instanceof XrplTxError && e.engineResult === "unknown_outcome" && e.hash === "A" && !e.retriable,
  );
});

// A signed EscrowFinish blob: its Fulfillment (A0228020 + 64 hex) sits inside a long hex run.
const PREIMAGE = "AB".repeat(32);
const SIGNED_BLOB = `120002228000000024000000016140000000000000${"A0228020" + PREIMAGE}${"7C".repeat(60)}`;

test("M3: error causes never carry the signed blob (xrpl.js echoes the request in TimeoutError / RippledError)", async () => {
  // RPC refusal: rippled echoes `request.tx_blob` in the error response.
  const rpc = Object.assign(new Error("invalidTransaction"), { data: { error: "invalidTransaction", request: { command: "submit", tx_blob: SIGNED_BLOB } } });
  const io = new FakeLedger([rpc]);
  await assert.rejects(submitReliably(blob("A"), io, { pollMs: 0 }), (e: unknown) => {
    assert.ok(e instanceof XrplTxError && e.engineResult === "invalidTransaction");
    const dump = inspect(toLedgerError(e), { depth: 12 });
    assert.ok(!dump.includes(PREIMAGE), "no preimage anywhere in the error chain");
    assert.match(dump, /\[redacted\]/);
    return true;
  });
  // Timeout: the MESSAGE holds the request JSON; after 6 timeouts the engine gives up with connection_lost + cause.
  const timeout = new TimeoutError(`Timeout for request: ${JSON.stringify({ command: "submit", tx_blob: SIGNED_BLOB })} with id 7`, { command: "submit", tx_blob: SIGNED_BLOB });
  let v = 100;
  const dead: LedgerIo = {
    submit: async () => Promise.reject(timeout),
    lookup: async () => Promise.reject(timeout),
    validatedLedgerIndex: async () => v,
    reconnect: async () => {},
    sleep: async () => void v++,
  };
  await assert.rejects(submitReliably(blob("A", 160), dead, { pollMs: 0, backoffMs: 0 }), (e: unknown) => {
    assert.ok(e instanceof XrplTxError && e.engineResult === "connection_lost");
    const dump = inspect(e, { depth: 12 });
    assert.ok(!dump.includes(PREIMAGE) && !dump.includes(SIGNED_BLOB.slice(0, 80)), "no blob in message, cause or stack");
    assert.ok(e.cause instanceof Error && /redacted \d+ hex/.test((e.cause as Error).message));
    return true;
  });
  // The helpers keep tx hashes (64 hex) readable.
  const hash = "C".repeat(64);
  assert.equal(redactSecrets(`tx ${hash}`), `tx ${hash}`);
  assert.equal(redactSecrets(`F=A0228020${PREIMAGE}`), "F=[redacted 72 hex]");
  assert.equal((redactedCause(rpc) as { data?: { request?: { tx_blob?: string } } }).data?.request?.tx_blob, "[redacted]");
});

test("L1: LastLedgerSequence margins are bounded; a lookup that can't cover the whole window is never proof of expiry", async () => {
  assert.equal(assertLlsMargin(20), 20);
  assert.equal(assertLlsMargin(MAX_LLS_MARGIN), MAX_LLS_MARGIN);
  for (const bad of [0, -1, MAX_LLS_MARGIN + 1, 2.5, Number.NaN, "20"]) assert.throws(() => assertLlsMargin(bad, "XRPL_LLS_MARGIN"), /XRPL_LLS_MARGIN must be an integer in 1\.\.500/);
  // A blob whose LastLedgerSequence is 1500 ledgers out: "not found in the last 1000" proves nothing.
  const io = new FakeLedger(["tesSUCCESS"]);
  io.lookup = async () => ({ status: "missing", searchedAll: true });
  const r = resigner();
  await assert.rejects(submitReliably(blob("A", 1_600), io, { pollMs: 0, resign: r.resign }), (e: unknown) => e instanceof XrplTxError && e.engineResult === "unknown_outcome");
  assert.deepEqual(r.calls, [], "never re-signed on a non-proof");
});

// ── independent review pass: H1b (held blobs), waits, reconnect ───────────────────────────

test("H1b: every submit sets fail_hard, so a provisional tel*/tef*/ter* answer is final at that server (rippled holds it otherwise)", () => {
  assert.deepEqual(submitRequest("ABCD"), { command: "submit", tx_blob: "ABCD", fail_hard: true });
});

test("H1b: tefPAST_SEQ on a blob that already applied (an earlier call submitted it) → its own validated result, never a fresh Sequence", async () => {
  for (const withResign of [false, true]) {
    const io = new FakeLedger(["tefPAST_SEQ"]);
    io.applyQuietly("A");
    io.validated++; // A validated a ledger ago
    const r = resigner();
    const out = await submitReliably(blob("A"), io, { pollMs: 0, backoffMs: 0, ...(withResign ? { resign: r.resign } : {}) });
    assert.equal(out.hash, "A", withResign ? "re-sign path" : "pre-signed path: not a retriable error");
    assert.deepEqual(r.calls, []);
  }
});

test("finding 2: past LastLedgerSequence, a 'known but not validated' answer (rippled's cache) is bounded → unknown_outcome", async () => {
  const io = new FakeLedger(["tesSUCCESS"]);
  io.lookup = async () => ({ status: "pending" });
  const r = resigner();
  await assert.rejects(submitReliably(blob("A", 103), io, { pollMs: 0, resign: r.resign }), (e: unknown) => {
    assert.ok(e instanceof XrplTxError && e.engineResult === "unknown_outcome" && !e.retriable && e.hash === "A");
    assert.match(e.message, /still known but not validated past its LastLedgerSequence/);
    return true;
  });
  assert.deepEqual(r.calls, [], "no proof of expiry → never re-signed");
});

test("finding 2: no new validated ledger for maxWaitMs → unknown_outcome instead of waiting forever", async () => {
  const io: LedgerIo = {
    submit: async () => ({ engineResult: "tesSUCCESS" }),
    lookup: async () => ({ status: "missing", searchedAll: true }),
    validatedLedgerIndex: async () => 100, // the network stopped validating
    reconnect: async () => {},
    sleep: (ms) => new Promise((res) => setTimeout(res, ms)),
  };
  await assert.rejects(submitReliably(blob("A", 150), io, { pollMs: 2, maxWaitMs: 20 }), (e: unknown) => e instanceof XrplTxError && e.engineResult === "unknown_outcome" && /no new validated ledger/.test(e.message) && e.hash === "A");
});

test("findings 3+4: a failed reconnect is connection_lost (with every unsettled hash), never a raw error", async () => {
  // A maybe-sent, telINSUF_FEE_P → same-Sequence B1, then the socket stays down and every reconnect fails.
  const down = () => new DisconnectedError("websocket closed");
  const io = new FakeLedger([down(), "telINSUF_FEE_P", down(), down()]);
  io.reconnect = async () => Promise.reject(new Error("connect ECONNREFUSED 1.2.3.4:51233"));
  const r = resigner();
  await assert.rejects(submitReliably(blob("A"), io, { pollMs: 0, backoffMs: 0, resign: r.resign }), (e: unknown) => {
    assert.ok(e instanceof XrplTxError, `got ${String(e)}`);
    assert.equal(e.engineResult, "connection_lost");
    assert.equal(e.retriable, false);
    assert.match(e.message, /check A, B1/, "the maybe-sent A and the re-signed B1 are both listed");
    return true;
  });
});

// ── PR #171 review: tec under fail_hard (issue 1), tefPAST_SEQ vs rippled's tx cache (issue 2) ─────────────────

const rpcRefusal = (code: string) => Object.assign(new Error(code), { data: { error: code } });

test("#171 issue 1: a tec under fail_hard is discarded by rippled → the SAME blob once more without fail_hard → the tec lands on-ledger (beat 5, tecNO_AUTH, TooSoon)", async () => {
  for (const code of ["tecCRYPTOCONDITION_ERROR", "tecNO_AUTH", "tecNO_PERMISSION", "tecTOO_SOON"]) {
    for (const withResign of [false, true]) {
      const io = new FakeLedger([code]);
      const r = resigner();
      await assert.rejects(submitReliably(blob("A"), io, { pollMs: 0, backoffMs: 0, ...(withResign ? { resign: r.resign, freshFirst: true } : {}) }), (e: unknown) => {
        assert.ok(e instanceof XrplTxError);
        assert.equal(e.engineResult, code);
        assert.equal(e.hash, "A");
        assert.ok(e.onLedger, `${code}: validated on-ledger, with an explorer link`);
        assert.equal(e.retriable, false);
        return true;
      });
      assert.deepEqual(io.submits, ["A", "A"], "same blob, same hash: applies at most once");
      assert.deepEqual(io.failHard, [true, false]);
      assert.deepEqual(r.calls, [], "never re-signed");
      assert.ok(io.validated <= 102, `validated next ledger, not waited out to LastLedgerSequence (at ${io.validated})`);
    }
  }
});

test("#171 issue 1: the soft resubmit is held by rippled (answers tel*) → tracked, never re-signed while it may apply; when it applies, that's the result", async () => {
  const io = new FakeLedger([{ prelim: "tecNO_AUTH", soft: { prelim: "telINSUF_FEE_P", final: "tecNO_AUTH" } }]);
  const r = resigner();
  await assert.rejects(submitReliably(blob("A"), io, { pollMs: 0, backoffMs: 0, resign: r.resign, freshFirst: true }), (e: unknown) => {
    assert.ok(e instanceof XrplTxError && e.engineResult === "tecNO_AUTH" && e.hash === "A");
    return true;
  });
  assert.deepEqual(r.calls, [], "the held blob was waited for, not superseded");
});

test("#171 issue 1: a held soft resubmit that never applies → re-signed (same Sequence) only after its LastLedgerSequence provably passed", async () => {
  const io = new FakeLedger([{ prelim: "tecNO_AUTH", soft: "telINSUF_FEE_P" }, "tesSUCCESS"]);
  const r = resigner();
  const out = await submitReliably(blob("A", 105), io, { pollMs: 0, backoffMs: 0, resign: r.resign, freshFirst: true });
  assert.equal(out.hash, "B1");
  assert.deepEqual(r.calls, ["same_seq"]);
  assert.ok(io.validated >= 105, `A's LastLedgerSequence 105 passed before the re-sign (at ${io.validated})`);
});

test("#171 issue 1: the soft resubmit answers tefPAST_SEQ (Sequence taken in between) → still tracked as maybe-applied: never a fresh Sequence, never retriable", async () => {
  const io = new FakeLedger([{ prelim: "tecNO_AUTH", soft: "tefPAST_SEQ" }]);
  io.cached = true;
  const r = resigner();
  await assert.rejects(submitReliably(blob("A", 103), io, { pollMs: 0, backoffMs: 0, resign: r.resign, freshFirst: true }), (e: unknown) => {
    assert.ok(e instanceof XrplTxError && e.engineResult === "unknown_outcome" && !e.retriable && e.hash === "A");
    return true;
  });
  assert.deepEqual(r.calls, []);
});

test("#171 issue 1: the soft resubmit refused by the RPC layer → the tec (for the caller's mapping), not on-ledger, non-retriable", async () => {
  const io = new FakeLedger([{ prelim: "tecNO_PERMISSION", soft: rpcRefusal("invalidTransaction") }]);
  await assert.rejects(submitReliably(blob("A"), io, { pollMs: 0, backoffMs: 0 }), (e: unknown) => {
    assert.ok(e instanceof XrplTxError);
    assert.equal(e.engineResult, "tecNO_PERMISSION");
    assert.equal(e.retriable, false);
    assert.equal(e.hash, undefined);
    assert.ok(!e.onLedger);
    assert.match(e.message, /discarded the provisional tecNO_PERMISSION under fail_hard and refused the resubmit without it \(invalidTransaction\)/);
    return true;
  });
  assert.deepEqual(io.failHard, [true, false]);
});

test("#171 issue 1: the socket dies during the soft resubmit (the server took it) → same blob again, tefPAST_SEQ, its validated tec", async () => {
  const io = new FakeLedger([{ prelim: "tecCRYPTOCONDITION_ERROR", soft: new DisconnectedError("websocket closed") }, "tefPAST_SEQ"]);
  io.applyQuietly("A", "tecCRYPTOCONDITION_ERROR");
  const r = resigner();
  await assert.rejects(submitReliably(blob("A"), io, { pollMs: 0, backoffMs: 0, resign: r.resign, freshFirst: true }), (e: unknown) => {
    assert.ok(e instanceof XrplTxError && e.engineResult === "tecCRYPTOCONDITION_ERROR" && e.hash === "A" && e.onLedger);
    return true;
  });
  assert.deepEqual(io.submits, ["A", "A", "A"]);
  assert.deepEqual(io.failHard, [true, false, true]);
  assert.equal(io.reconnects, 1);
  assert.deepEqual(r.calls, []);
});

test("#171 issue 2: tefPAST_SEQ on a blob signed in this call, looked up as 'known, not validated' (rippled's cache) → fresh Sequence at once", async () => {
  const io = new FakeLedger(["tefPAST_SEQ", "tesSUCCESS"]);
  io.cached = true; // the refused blob is in rippled's tx cache: `tx` says validated:false, never txnNotFound
  const r = resigner();
  const out = await submitReliably(blob("A", 120), io, { pollMs: 0, backoffMs: 0, resign: r.resign, freshFirst: true });
  assert.equal(out.hash, "B1");
  assert.deepEqual(r.calls, ["new_seq"]);
  assert.ok(io.validated <= 102, `no wait for A's LastLedgerSequence 120 (at ${io.validated})`);
});

test("#171 issue 2: …but a pre-signed blob (may have an earlier history) is never called dead from a cached lookup: without account state it is waited for", async () => {
  const io = new FakeLedger(["tefPAST_SEQ"]);
  io.cached = true;
  await assert.rejects(submitReliably(blob("A", 103), io, { pollMs: 0, backoffMs: 0 }), (e: unknown) => {
    assert.ok(e instanceof XrplTxError && e.engineResult === "unknown_outcome" && !e.retriable && e.hash === "A");
    return true;
  });
});
