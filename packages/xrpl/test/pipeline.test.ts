// Offline tests for pipelined submission (XRPL-17, submit.ts R1-R6). `SeqLedger` is a sequence-aware fake ledger that
// behaves like rippled where it matters (devnet-checked, protocol notes §0a): an open ledger applied in Sequence order,
// held txs (terPRE_SEQ, and tel* rejects, which rippled caches and retries), LastLedgerSequence expiry, and a `tx`
// lookup that answers "not validated" forever for any blob the server has seen (never txnNotFound), so "dead" has to
// come from account state (Sequence at a ledger, account_tx). Scripted faults: reject at submit, drop / delay / lose
// the Sequence to another tx after a tesSUCCESS prelim, tec final, socket drops, busy lookups, another writer, a
// lagging tx index. One ledger closes per round of polling (every sleep in the same turn), or mid-call via `closeHook`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DisconnectedError } from "xrpl";
import { toErrorCode, XrplTxError } from "../src/errors.ts";
import {
  DEFAULT_PIPELINE_WINDOW,
  getSubmitMode,
  lockedAccounts,
  pipelineState,
  resetSubmitMode,
  setSubmitMode,
  submitModeFromEnv,
  submitPipelined,
  submitReliably,
  usePipeline,
  withAccountLock,
  type Lookup,
  type PipelineEvent,
  type PipelineIo,
  type PipelinePolicy,
  type SignedBlob,
  type ValidatedTx,
} from "../src/submit.ts";

interface FakeTx {
  hash: string;
  account: string;
  seq: number;
  lls: number;
  /** The logical tx (one submitPipelined call); every re-sign is a new blob of the same intent. */
  intent: string;
}

interface Fault {
  /** Returned as the preliminary result; not applied (temMALFORMED, telINSUF_FEE_P, …). */
  reject?: string;
  /** Validated result (tec*). */
  final?: string;
  /** Accepted (tesSUCCESS prelim) but never makes it into a validated ledger (what a tem/tef at apply looks like). */
  drop?: boolean;
  /** Stays in the open ledger this many closes before it validates. */
  delay?: number;
  /** The socket dies during submit; `received`: the server took the blob anyway. */
  disconnect?: { received: boolean };
  /** Accepted, but another tx with the same Sequence wins the next ledger (another writer on another server). */
  dropAndReplace?: boolean;
  /** Validates normally, but its `tx` lookup keeps answering "not validated" (a lagging tx index). */
  lagLookup?: boolean;
}

type Entry = FakeTx & { delay: number; drop: boolean; final: string; replace: boolean };

class SeqLedger implements PipelineIo {
  validated = 100;
  closes = 0;
  reconnects = 0;
  /** The next N requests (any kind) throw DisconnectedError. */
  dropRequests = 0;
  /** The next N lookups throw rippled `tooBusy`. */
  busyLookups = 0;
  /** Added to the next nextSequence() answer only (a stale-high counter). */
  nextSeqSkew = 0;
  /** false → the server can't show past account state or history (sequenceAt / txWithSequence answer nothing). */
  completeHistory = true;
  /** rippled holds locally submitted tel* txs and retries them at the next ledger (xrpl.org: tel is provisional). */
  holdTel = true;
  /** Called before every request; true → a ledger closes right then (closes in the middle of issue/resync). */
  closeHook?: () => boolean;
  /** Lookups answered txnNotFound (rippled never does that for a blob it has seen). */
  missingAnswers = 0;
  /** Accounts that don't exist: account_info → actNotFound. */
  readonly unfunded = new Set<string>();
  /** Blobs carry minLedger (as client.ts does); false → the engine asks for the validated index itself. */
  withMinLedger = true;
  readonly submits: string[] = [];
  readonly prepares = new Map<string, number>();
  /** By blob hash; consumed by its first submit. */
  readonly faults = new Map<string, Fault>();
  /** intent → number of its blobs in validated ledgers (must never exceed 1). */
  readonly applied = new Map<string, number>();
  readonly done = new Map<string, { tx: FakeTx; result: string; ledger: number }>();
  /** Validated lookups whose ledger was outside the range the engine asked about. */
  readonly rangeViolations: string[] = [];
  maxOutstanding = 0;
  externals = 0;
  /** Every hash ever submitted: rippled's TransactionMaster cache, which `tx` answers from. */
  private readonly seen = new Set<string>();
  private readonly lagging = new Set<string>();
  onPrepare?: (intent: string, n: number, sequence: number) => void;
  private readonly seqs = new Map<string, number>();
  private open: Entry[] = [];
  private held: Entry[] = [];
  /** Dropped blobs, dead once the validated ledger reaches their LastLedgerSequence. */
  private limbo: Entry[] = [];
  private tick: Promise<void> | undefined;

  constructor(private readonly start = 1000) {}

  /** Next Sequence on the open ledger. */
  openSeq(account: string): number {
    return (this.seqs.get(account) ?? this.start) + this.open.filter((o) => o.account === account).length;
  }

  /** prepare() for one intent: every call signs a new blob `${intent}#n` at the given Sequence. */
  preparer(intent: string, o: { account: string; margin?: number }): (sequence: number) => Promise<SignedBlob> {
    const margin = o.margin ?? 8;
    return async (sequence) => {
      const n = (this.prepares.get(intent) ?? 0) + 1;
      this.prepares.set(intent, n);
      this.onPrepare?.(intent, n, sequence);
      const tx: FakeTx = { hash: `${intent}#${n}`, account: o.account, seq: sequence, lls: this.validated + margin, intent };
      return {
        blob: JSON.stringify(tx),
        hash: tx.hash,
        account: o.account,
        txType: "Payment",
        sequence,
        lastLedgerSequence: tx.lls,
        ...(this.withMinLedger ? { minLedger: this.validated + 1 } : {}),
      };
    };
  }

  /** Another writer (another process) takes the account's next Sequence on the open ledger. */
  external(account: string): number {
    const seq = this.openSeq(account);
    const hash = `ext-${account}-${seq}-${++this.externals}`;
    assert.equal(this.accept({ hash, account, seq, lls: this.validated + 20, intent: hash }, {}), "tesSUCCESS");
    return seq;
  }

  seqOfIntent(intent: string): number | undefined {
    for (const d of this.done.values()) if (d.tx.intent === intent) return d.tx.seq;
    return undefined;
  }

  private net(): void {
    if (this.closeHook?.()) this.close();
    if (this.dropRequests > 0) {
      this.dropRequests--;
      throw new DisconnectedError("websocket closed");
    }
  }

  private accept(tx: FakeTx, f: Fault): string {
    if (this.done.has(tx.hash)) return "tefPAST_SEQ";
    if ([...this.open, ...this.held, ...this.limbo].some((x) => x.hash === tx.hash)) return "tefALREADY";
    if (this.validated + 1 > tx.lls) return "tefMAX_LEDGER";
    const next = this.openSeq(tx.account);
    if (tx.seq < next) return "tefPAST_SEQ";
    const e: Entry = { ...tx, delay: f.delay ?? 0, drop: !!f.drop, final: f.final ?? "tesSUCCESS", replace: !!f.dropAndReplace };
    if (f.lagLookup) this.lagging.add(tx.hash);
    if (tx.seq > next) {
      this.held.push(e);
      this.track();
      return "terPRE_SEQ";
    }
    this.open.push(e);
    this.track();
    return e.final.startsWith("tec") ? e.final : "tesSUCCESS";
  }

  private track(): void {
    const n = new Set([...this.open, ...this.held, ...this.limbo].map((x) => x.intent)).size;
    this.maxOutstanding = Math.max(this.maxOutstanding, n);
  }

  private close(): void {
    this.closes++;
    const ledger = this.validated + 1;
    const next = new Map<string, number>();
    const seqNow = (a: string) => next.get(a) ?? this.seqs.get(a) ?? this.start;
    const carry: Entry[] = [];
    for (const tx of this.open) {
      if (tx.replace && tx.seq === seqNow(tx.account)) {
        // another writer's tx with this Sequence wins the ledger; ours can never apply now
        const hash = `foreign-${tx.account}-${tx.seq}-${++this.externals}`;
        this.done.set(hash, { tx: { hash, account: tx.account, seq: tx.seq, lls: tx.lls, intent: hash }, result: "tesSUCCESS", ledger });
        this.applied.set(hash, 1);
        next.set(tx.account, seqNow(tx.account) + 1);
        this.limbo.push(tx);
      } else if (tx.drop) {
        this.limbo.push(tx);
      } else if (tx.delay > 0 || tx.seq !== seqNow(tx.account)) {
        tx.delay = Math.max(0, tx.delay - 1);
        carry.push(tx); // delayed, or behind a gap: retried in the next ledger
      } else {
        this.done.set(tx.hash, { tx, result: tx.final, ledger });
        this.applied.set(tx.intent, (this.applied.get(tx.intent) ?? 0) + 1);
        next.set(tx.account, seqNow(tx.account) + 1);
      }
    }
    for (const [a, s] of next) this.seqs.set(a, s);
    this.validated = ledger;
    // The next open ledger: carried + held txs in Sequence order. Past LastLedgerSequence → can never apply.
    const pending = [...carry, ...this.held].sort((x, y) => (x.account === y.account ? x.seq - y.seq : x.account < y.account ? -1 : 1));
    this.open = [];
    this.held = [];
    for (const tx of pending) {
      if (tx.lls < this.validated + 1) continue;
      const n = this.openSeq(tx.account);
      if (tx.seq === n) this.open.push(tx);
      else if (tx.seq > n) this.held.push(tx);
      // tx.seq < n: its Sequence was used by another tx → dead
    }
    this.limbo = this.limbo.filter((tx) => tx.lls >= this.validated + 1);
  }

  // ── PipelineIo ──

  async submit(blob: string) {
    this.net();
    const tx = JSON.parse(blob) as FakeTx;
    this.submits.push(tx.hash);
    this.seen.add(tx.hash);
    const f = this.faults.get(tx.hash) ?? {};
    this.faults.delete(tx.hash);
    if (f.reject) {
      // rippled caches a locally submitted tel* tx and retries it when it builds the next open ledger
      if (this.holdTel && f.reject.startsWith("tel") && this.validated + 1 <= tx.lls) this.held.push({ ...tx, delay: 0, drop: false, final: "tesSUCCESS", replace: false });
      return { engineResult: f.reject };
    }
    if (f.disconnect) {
      if (f.disconnect.received) this.accept(tx, f);
      throw new DisconnectedError("websocket closed mid-submit");
    }
    return { engineResult: this.accept(tx, f) };
  }

  async lookup(hash: string, range?: { min: number; max: number }): Promise<Lookup> {
    this.net();
    if (this.busyLookups > 0) {
      this.busyLookups--;
      throw Object.assign(new Error("Server is overloaded"), { data: { error: "tooBusy" } });
    }
    const d = this.done.get(hash);
    if (d && !this.lagging.has(hash)) {
      if (range && (d.ledger < range.min || d.ledger > range.max)) this.rangeViolations.push(`${hash}@${d.ledger} not in ${range.min}..${range.max}`);
      return { status: "validated", result: this.result(hash) };
    }
    if (this.seen.has(hash)) return { status: "pending" }; // rippled: cached, "validated: false", for as long as it's asked
    this.missingAnswers++;
    return { status: "missing", searchedAll: range !== undefined && this.completeHistory };
  }

  private result(hash: string): ValidatedTx {
    const d = this.done.get(hash)!;
    return { hash, validated: true, ledger_index: d.ledger, meta: { TransactionResult: d.result }, tx_json: { Account: d.tx.account, Sequence: d.tx.seq } };
  }

  async sequenceAt(account: string, ledgerIndex: number) {
    this.net();
    if (!this.completeHistory || ledgerIndex > this.validated) return undefined;
    let n = 0;
    for (const d of this.done.values()) if (d.tx.account === account && d.ledger <= ledgerIndex) n++;
    return this.start + n;
  }

  async txWithSequence(account: string, sequence: number, range: { min: number; max: number }) {
    this.net();
    if (!this.completeHistory) return undefined;
    for (const [hash, d] of this.done) {
      if (d.tx.account === account && d.tx.seq === sequence && d.ledger >= range.min && d.ledger <= range.max) return this.result(hash);
    }
    return undefined;
  }

  async validatedLedgerIndex() {
    this.net();
    return this.validated;
  }

  async nextSequence(account: string) {
    this.net();
    if (this.unfunded.has(account)) throw Object.assign(new Error("Account not found."), { data: { error: "actNotFound" } });
    const skew = this.nextSeqSkew;
    this.nextSeqSkew = 0;
    return this.openSeq(account) + skew;
  }

  async reconnect() {
    this.reconnects++;
  }

  /** Every sleep in the same macrotask turn shares one ledger close. */
  async sleep() {
    this.tick ??= new Promise<void>((r) =>
      setImmediate(() => {
        this.tick = undefined;
        this.close();
        r();
      }),
    );
    return this.tick;
  }
}

const FAST = { pollMs: 0, backoffMs: 0 } as const;
const T = { timeout: 15_000 };
const seqOf = (r: ValidatedTx) => (r.tx_json as { Sequence: number }).Sequence;
const range = (from: number, n: number) => Array.from({ length: n }, (_, i) => from + i);

/** Fire `n` parallel pipelined txs `${prefix}${i}` for `account`. */
function burst(L: SeqLedger, account: string, prefix: string, n: number, opts: PipelinePolicy & { margin?: number } = {}) {
  const { margin, ...policy } = opts;
  return Array.from({ length: n }, (_, i) =>
    submitPipelined({ account, txType: "Payment", prepare: L.preparer(`${prefix}${i}`, { account, ...(margin ? { margin } : {}) }) }, L, { ...FAST, window: 5, ...policy }),
  );
}

function assertAppliedOnce(L: SeqLedger, intents: string[]): void {
  for (const i of intents) assert.equal(L.applied.get(i) ?? 0, 1, `${i} applied ${L.applied.get(i) ?? 0}×`);
  for (const [i, n] of L.applied) assert.ok(n <= 1, `${i} applied ${n}×`);
  assert.deepEqual(L.rangeViolations, []);
}

function assertIdle(account: string): void {
  const s = pipelineState(account);
  assert.ok(s, "pipeline exists");
  assert.equal(s.inFlight, 0);
  assert.equal(s.parked, 0);
  assert.equal(s.dirty, undefined);
  assert.ok(!lockedAccounts().includes(account), "mutex released");
}

// ── ordering, window, throughput ──────────────────────────────────────────────────────────

test("pipelined: 20 parallel txs → 20 tesSUCCESS, contiguous Sequences in call order, ≤ window in flight, no retries", T, async () => {
  const L = new SeqLedger(1000);
  const out = await Promise.all(burst(L, "rORDER", "o", 20));
  assert.deepEqual(out.map(seqOf), range(1000, 20));
  assertAppliedOnce(L, range(0, 20).map((i) => `o${i}`));
  assert.equal(L.submits.length, 20);
  assert.equal(pipelineState("rORDER")?.maxInFlight, 5);
  assert.ok(L.maxOutstanding <= 5, `outstanding ${L.maxOutstanding}`);
  assert.ok(L.closes <= 10, `pipelined used ${L.closes} ledgers`);
  assertIdle("rORDER");
});

test("locked baseline on the same fake: ≥ 1 ledger per tx (what pipelining removes)", T, async () => {
  const L = new SeqLedger(1000);
  const acct = "rLOCKED";
  const one = (i: number) =>
    withAccountLock(acct, async () => submitReliably(await L.preparer(`l${i}`, { account: acct })(await L.nextSequence(acct)), L, FAST));
  const out = await Promise.all(range(0, 20).map(one));
  assert.deepEqual(out.map(seqOf), range(1000, 20));
  assert.ok(L.closes >= 20, `locked used ${L.closes} ledgers`);
});

test("blobs without minLedger: the engine reads the validated index itself (lookup ranges still cover every blob)", T, async () => {
  const L = new SeqLedger(1000);
  L.withMinLedger = false;
  L.faults.set("y1#1", { drop: true });
  const out = await Promise.all(burst(L, "rNOMIN", "y", 6, { margin: 5 }));
  assert.deepEqual(out.map(seqOf), range(1000, 6));
  assertAppliedOnce(L, range(0, 6).map((i) => `y${i}`));
});

test("window limit (2) holds; txs are still issued in call order", T, async () => {
  const L = new SeqLedger(1000);
  const out = await Promise.all(burst(L, "rWIN2", "w", 7, { window: 2 }));
  assert.deepEqual(out.map(seqOf), range(1000, 7));
  assert.equal(pipelineState("rWIN2")?.maxInFlight, 2);
  assert.ok(L.maxOutstanding <= 2);
  assert.deepEqual(L.submits, range(0, 7).map((i) => `w${i}#1`));
});

// ── failures in the middle of the window ─────────────────────────────────────────────────

test("tem at submit in the middle: that tx fails once (no retry), the next tx reuses its Sequence, no gap, no resync", T, async () => {
  const L = new SeqLedger(1000);
  const events: PipelineEvent[] = [];
  L.faults.set("t2#1", { reject: "temMALFORMED" });
  const res = await Promise.allSettled(burst(L, "rTEM", "t", 6, { onPipeline: (e) => events.push(e) }));
  const r2 = res[2]!;
  assert.equal(r2.status, "rejected");
  const e = (r2 as PromiseRejectedResult).reason;
  assert.ok(e instanceof XrplTxError);
  assert.equal(e.engineResult, "temMALFORMED");
  assert.equal(e.retriable, false);
  assert.equal(e.hash, undefined);
  assert.equal(L.prepares.get("t2"), 1);
  const ok = res.filter((r): r is PromiseFulfilledResult<ValidatedTx> => r.status === "fulfilled").map((r) => seqOf(r.value));
  assert.deepEqual(ok, range(1000, 5)); // t3 took t2's Sequence 1002
  assert.equal(L.seqOfIntent("t3"), 1002);
  assertAppliedOnce(L, ["t0", "t1", "t3", "t4", "t5"]);
  assert.equal(L.applied.get("t2"), undefined);
  assert.deepEqual(events, []);
  assertIdle("rTEM");
});

test("tec in the middle: final (never retried), its Sequence is consumed, later txs unaffected", T, async () => {
  const L = new SeqLedger(1000);
  const events: PipelineEvent[] = [];
  L.faults.set("c2#1", { final: "tecUNFUNDED_PAYMENT" });
  const res = await Promise.allSettled(burst(L, "rTEC", "c", 6, { onPipeline: (e) => events.push(e) }));
  const e = (res[2] as PromiseRejectedResult).reason;
  assert.ok(e instanceof XrplTxError);
  assert.equal(e.engineResult, "tecUNFUNDED_PAYMENT");
  assert.equal(e.hash, "c2#1");
  assert.equal(e.retriable, false);
  assert.ok(e.onLedger);
  assert.equal(L.seqOfIntent("c2"), 1002);
  assert.deepEqual(range(0, 6).map((i) => L.seqOfIntent(`c${i}`)), range(1000, 6));
  assert.equal(L.submits.length, 6);
  assert.deepEqual(events, []);
  assertAppliedOnce(L, range(0, 6).map((i) => `c${i}`));
});

test("tx dies after a tesSUCCESS prelim (a tef/tem at apply) → later txs stall → all settle by LLS → resync → only the unapplied are re-signed, in order", T, async () => {
  const L = new SeqLedger(1000);
  const events: PipelineEvent[] = [];
  L.faults.set("d1#1", { drop: true });
  const out = await Promise.all(burst(L, "rDIE", "d", 8, { margin: 6, onPipeline: (e) => events.push(e) }));
  assert.deepEqual(out.map(seqOf), range(1000, 8)); // re-signed in arrival order: no gap, nothing reordered
  assertAppliedOnce(L, range(0, 8).map((i) => `d${i}`));
  assert.equal(L.prepares.get("d0"), 1); // applied before the gap: never re-signed
  for (const i of [1, 2, 3, 4]) assert.equal(L.prepares.get(`d${i}`), 2, `d${i} re-signed once`); // in flight behind the gap
  assert.ok(!L.done.has("d1#1") && !L.done.has("d2#1"), "dead blobs never apply");
  assert.ok(events.some((e) => e.kind === "dirty"));
  const rs = events.filter((e) => e.kind === "resync");
  assert.equal(rs.length, 1);
  assert.equal(rs[0]!.kind === "resync" && rs[0]!.nextSequence, 1001);
  assertIdle("rDIE");
});

test("…and if the re-signed tx is now rejected tem, only it fails; the rest close the gap", T, async () => {
  const L = new SeqLedger(1000);
  L.faults.set("m1#1", { drop: true });
  L.faults.set("m1#2", { reject: "temBAD_AMOUNT" });
  const res = await Promise.allSettled(burst(L, "rDIETEM", "m", 6, { margin: 6 }));
  const e = (res[1] as PromiseRejectedResult).reason;
  assert.ok(e instanceof XrplTxError);
  assert.equal(e.engineResult, "temBAD_AMOUNT");
  assert.equal(e.retriable, false);
  const ok = res.flatMap((r) => (r.status === "fulfilled" ? [seqOf(r.value)] : []));
  assert.deepEqual(ok, range(1000, 5));
  assert.equal(L.seqOfIntent("m2"), 1001);
  assert.equal(L.applied.get("m1"), undefined);
  assertAppliedOnce(L, ["m0", "m2", "m3", "m4", "m5"]);
  assertIdle("rDIETEM");
});

test("a slow tx that validates late (before its LLS) is never re-signed; nothing behind it is either", T, async () => {
  const L = new SeqLedger(1000);
  const events: PipelineEvent[] = [];
  L.faults.set("s1#1", { delay: 3 });
  const out = await Promise.all(burst(L, "rSLOW", "s", 8, { margin: 8, onPipeline: (e) => events.push(e) }));
  assert.deepEqual(out.map(seqOf), range(1000, 8));
  for (let i = 0; i < 8; i++) assert.equal(L.prepares.get(`s${i}`), 1);
  assert.equal(L.submits.length, 8);
  assert.deepEqual(events, []);
  assertAppliedOnce(L, range(0, 8).map((i) => `s${i}`));
});

// ── sequence anomalies → dirty → resync ──────────────────────────────────────────────────

test("tefPAST_SEQ: another writer took our Sequence → drain, resync from the ledger, re-sign with a fresh Sequence", T, async () => {
  const L = new SeqLedger(1000);
  const events: PipelineEvent[] = [];
  let stolen = 0;
  L.onPrepare = (intent, n) => {
    if (intent === "x3" && n === 1) stolen = L.external("rPAST");
  };
  const out = await Promise.all(burst(L, "rPAST", "x", 7, { onPipeline: (e) => events.push(e) }));
  assert.equal(stolen, 1003);
  const seqs = out.map(seqOf);
  assert.ok(!seqs.includes(stolen));
  assert.deepEqual(seqs, [1000, 1001, 1002, 1004, 1005, 1006, 1007]);
  assert.equal(L.prepares.get("x3"), 2);
  assert.ok(!L.done.has("x3#1"));
  assert.equal(events[0]?.kind === "dirty" && events[0].reason, "tefPAST_SEQ");
  assert.ok(events.some((e) => e.kind === "resync" && e.nextSequence === 1004));
  assertAppliedOnce(L, range(0, 7).map((i) => `x${i}`));
  assertIdle("rPAST");
});

test("terPRE_SEQ: counter ahead of the ledger → the held tx is waited out (never re-signed while it may apply) → resync", T, async () => {
  const L = new SeqLedger(1000);
  const events: PipelineEvent[] = [];
  L.nextSeqSkew = 1; // e.g. the server we read the Sequence from saw a tx that then got lost
  const out = await Promise.all(burst(L, "rPRE", "p", 3, { margin: 5, onPipeline: (e) => events.push(e) }));
  assert.deepEqual(out.map(seqOf), [1000, 1001, 1002]);
  assert.equal(L.prepares.get("p0"), 2);
  assert.ok(!L.done.has("p0#1"));
  assert.equal(events[0]?.kind === "dirty" && events[0].reason, "terPRE_SEQ");
  assert.ok(L.closes >= 5, "p0#1 was held until its LastLedgerSequence (validated 100 + 5) passed; only then re-signed");
  assertAppliedOnce(L, ["p0", "p1", "p2"]);
  assertIdle("rPRE");
});

test("a persistent foreign writer: re-signs stop at maxAttempts (retriable, nothing applied), the pipeline recovers", T, async () => {
  const L = new SeqLedger(1000);
  L.onPrepare = (intent) => {
    if (intent === "f0") L.external("rFOREIGN");
  };
  const [r] = await Promise.allSettled(burst(L, "rFOREIGN", "f", 1, { maxAttempts: 3 }));
  const e = (r as PromiseRejectedResult).reason;
  assert.ok(e instanceof XrplTxError);
  assert.equal(e.engineResult, "tefPAST_SEQ");
  assert.equal(e.retriable, true);
  assert.equal(L.prepares.get("f0"), 3);
  assert.equal(L.applied.get("f0"), undefined);
  assertIdle("rFOREIGN");
  L.onPrepare = undefined;
  const [after] = await Promise.all(burst(L, "rFOREIGN", "g", 1));
  assert.equal(seqOf(after!), 1003); // three external txs took 1000..1002
});

test("incomplete server history → unknown_outcome (never re-signed); the next tx re-reads the counter", T, async () => {
  const L = new SeqLedger(1000);
  L.completeHistory = false;
  L.faults.set("u0#1", { drop: true });
  const [r] = await Promise.allSettled(burst(L, "rHIST", "u", 1, { margin: 3 }));
  const e = (r as PromiseRejectedResult).reason;
  assert.ok(e instanceof XrplTxError);
  assert.equal(e.engineResult, "unknown_outcome");
  assert.equal(e.retriable, false);
  assert.equal(e.hash, "u0#1");
  assert.equal(L.prepares.get("u0"), 1);
  assertIdle("rHIST");
  L.completeHistory = true;
  const [after] = await Promise.all(burst(L, "rHIST", "v", 1));
  assert.equal(seqOf(after!), 1000); // u0 never applied: its Sequence is reused
});

test("a prepare error (account_info actNotFound) propagates as is, like locked mode's autofill: nothing submitted", T, async () => {
  const L = new SeqLedger(1000);
  L.unfunded.add("rNOACCT");
  const [r] = await Promise.allSettled(burst(L, "rNOACCT", "a", 1));
  const e = (r as PromiseRejectedResult).reason;
  assert.ok(!(e instanceof XrplTxError));
  assert.equal(toErrorCode(e), "not_found");
  assert.deepEqual(L.submits, []);
  assertIdle("rNOACCT");
});

test("rippled never says txnNotFound for a blob it saw: a dropped blob is proven dead from the account's Sequence at its LLS", T, async () => {
  const L = new SeqLedger(1000);
  const events: PipelineEvent[] = [];
  L.faults.set("r1#1", { drop: true });
  const out = await Promise.all(burst(L, "rSTATE", "r", 4, { margin: 5, onPipeline: (e) => events.push(e) }));
  assert.deepEqual(out.map(seqOf), range(1000, 4));
  assert.equal(L.missingAnswers, 0, "every lookup of a seen blob answered 'not validated', like devnet");
  assert.equal(L.prepares.get("r1"), 2);
  assert.ok(events.some((e) => e.kind === "resync"));
  assertAppliedOnce(L, range(0, 4).map((i) => `r${i}`));
  assertIdle("rSTATE");
});

test("a tel* blob that rippled holds and applies later: the same-Sequence re-sign gets tefPAST_SEQ, the held blob is the result, applied once", T, async () => {
  const L = new SeqLedger(1000);
  L.faults.set("h0#1", { reject: "telINSUF_FEE_P" }); // held by the server, applied while we back off
  const [out] = await Promise.all(burst(L, "rTELHOLD", "h", 1));
  assert.equal(out!.hash, "h0#1");
  assert.equal(seqOf(out!), 1000);
  assert.equal(L.prepares.get("h0"), 2); // h0#2 (same Sequence) was signed and refused; never a third at a new Sequence
  assertAppliedOnce(L, ["h0"]);
  assertIdle("rTELHOLD");
});

test("another writer's tx wins a pending blob's Sequence: account_tx proves ours dead → re-signed once, applied once", T, async () => {
  const L = new SeqLedger(1000);
  const events: PipelineEvent[] = [];
  L.faults.set("w1#1", { dropAndReplace: true });
  const out = await Promise.all(burst(L, "rWIN", "w", 3, { margin: 5, onPipeline: (e) => events.push(e) }));
  const seqs = out.map(seqOf);
  assert.equal(new Set(seqs).size, 3);
  assert.ok(!seqs.includes(1001), "1001 went to the other writer");
  assert.equal(L.prepares.get("w1"), 2);
  assert.ok(events.some((e) => e.kind === "dirty"));
  assertAppliedOnce(L, ["w0", "w1", "w2"]);
  assertIdle("rWIN");
});

test("our blob validated but its tx lookup lags: the account history names it → returned as the result, never re-signed", T, async () => {
  const L = new SeqLedger(1000);
  L.faults.set("g0#1", { lagLookup: true });
  const [out] = await Promise.all(burst(L, "rLAG", "g", 1, { margin: 4 }));
  assert.equal(out!.hash, "g0#1");
  assert.equal(L.prepares.get("g0"), 1);
  assertAppliedOnce(L, ["g0"]);
  assertIdle("rLAG");
});

test("a throwing onPipeline / onRetry callback never stalls the account or replaces the tx's outcome", T, async () => {
  const L = new SeqLedger(1000);
  const boom = () => {
    throw new Error("logger exploded");
  };
  L.faults.set("q1#1", { drop: true });
  L.faults.set("q3#1", { reject: "telINSUF_FEE_P" });
  const out = await Promise.all(burst(L, "rBOOM", "q", 5, { margin: 5, onPipeline: boom, onRetry: boom }));
  assert.equal(new Set(out.map(seqOf)).size, 5);
  assertAppliedOnce(L, range(0, 5).map((i) => `q${i}`));
  assertIdle("rBOOM");
  const [after] = await Promise.all(burst(L, "rBOOM", "z", 1, { onPipeline: boom, onRetry: boom }));
  assert.ok(after);
});

// ── disconnects ──────────────────────────────────────────────────────────────────────────

test("connection lost before anything was sent → not_applied, retriable (nothing can apply), no hash", T, async () => {
  const L = new SeqLedger(1000);
  L.dropRequests = 1_000;
  const [r] = await Promise.allSettled(burst(L, "rNOCONN", "z", 1));
  const e = (r as PromiseRejectedResult).reason;
  assert.ok(e instanceof XrplTxError);
  assert.equal(e.engineResult, "not_applied");
  assert.equal(e.retriable, true);
  assert.equal(e.hash, undefined);
  assert.deepEqual(L.submits, []);
  assertIdle("rNOCONN");
});

test("socket dies mid-submit after the server took it → same blob resubmitted (tefALREADY), never re-signed or double-applied", T, async () => {
  const L = new SeqLedger(1000);
  L.faults.set("n2#1", { disconnect: { received: true } });
  const out = await Promise.all(burst(L, "rDISC1", "n", 5));
  assert.deepEqual(out.map(seqOf), range(1000, 5));
  assert.equal(L.prepares.get("n2"), 1);
  assert.equal(L.submits.filter((h) => h === "n2#1").length, 2);
  assert.ok(L.reconnects >= 1);
  assertAppliedOnce(L, range(0, 5).map((i) => `n${i}`));
});

test("socket dies mid-submit before the server took it → same blob resubmitted, applied once", T, async () => {
  const L = new SeqLedger(1000);
  L.faults.set("q1#1", { disconnect: { received: false } });
  const out = await Promise.all(burst(L, "rDISC2", "q", 4));
  assert.deepEqual(out.map(seqOf), range(1000, 4));
  assert.equal(L.prepares.get("q1"), 1);
  assertAppliedOnce(L, range(0, 4).map((i) => `q${i}`));
});

test("disconnect mid-window (5 in flight, the next requests fail) → reconnect, every tx still applied exactly once", T, async () => {
  const L = new SeqLedger(1000);
  L.onPrepare = (intent) => {
    if (intent === "k5") L.dropRequests = 4;
  };
  const out = await Promise.all(burst(L, "rDISC3", "k", 10));
  assert.deepEqual(out.map(seqOf), range(1000, 10));
  assert.ok(L.reconnects >= 1 && L.reconnects <= 4, `reconnects ${L.reconnects}`);
  for (let i = 0; i < 10; i++) assert.equal(L.prepares.get(`k${i}`), 1);
  assertAppliedOnce(L, range(0, 10).map((i) => `k${i}`));
  assertIdle("rDISC3");
});

test("server busy (tooBusy) while txs wait for validation → asked again later, nothing fails or is re-signed", T, async () => {
  const L = new SeqLedger(1000);
  L.onPrepare = (intent) => {
    if (intent === "b4") L.busyLookups = 4;
  };
  const out = await Promise.all(burst(L, "rBUSY", "b", 6));
  assert.deepEqual(out.map(seqOf), range(1000, 6));
  for (let i = 0; i < 6; i++) assert.equal(L.prepares.get(`b${i}`), 1);
  assert.equal(L.reconnects, 0);
  assertAppliedOnce(L, range(0, 6).map((i) => `b${i}`));
  assertIdle("rBUSY");
});

// ── never double-apply under random faults ───────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("chaos (drops, tem, held tel, disconnects, busy, foreign writers, lost Sequences, lagging index, delays, tec, mid-call closes; 25 seeds × 30 txs × windows 1/4/10): never double-applied, never stuck", { timeout: 120_000 }, async () => {
  // Longer local soak: CHAOS_SEEDS=2000 pnpm --filter @xrlp/xrpl test
  const seeds = Number(process.env.CHAOS_SEEDS ?? 25);
  for (let k = 0; k < seeds * 3; k++) {
    const seed = Math.floor(k / 3) + 1;
    const window = [1, 4, 10][k % 3]!;
    const rnd = mulberry32(seed);
    const L = new SeqLedger(5000);
    const acct = `rCHAOS${seed}w${window}`;
    L.closeHook = () => rnd() < 0.02; // a ledger closes in the middle of issue / resync now and then
    L.onPrepare = (intent, n) => {
      const h = `${intent}#${n}`;
      const r = rnd();
      if (r < 0.1) L.faults.set(h, { drop: true });
      else if (r < 0.15) L.faults.set(h, { reject: "temMALFORMED" });
      else if (r < 0.22) L.faults.set(h, { reject: "telINSUF_FEE_P" });
      else if (r < 0.28) L.faults.set(h, { disconnect: { received: rnd() < 0.5 } });
      else if (r < 0.31) L.external(acct);
      else if (r < 0.36) L.faults.set(h, { delay: 2 });
      else if (r < 0.4) L.faults.set(h, { final: "tecUNFUNDED_PAYMENT" });
      else if (r < 0.44) L.faults.set(h, { dropAndReplace: true });
      else if (r < 0.47) L.faults.set(h, { lagLookup: true });
      if (rnd() < 0.03) L.dropRequests = 2;
      if (rnd() < 0.03) L.busyLookups = 2;
    };
    const res = await Promise.allSettled(burst(L, acct, "c", 30, { window, margin: 5 }));
    res.forEach((r, i) => {
      const n = L.applied.get(`c${i}`) ?? 0;
      assert.ok(n <= 1, `seed ${seed} w${window}: c${i} applied ${n}×`);
      if (r.status === "fulfilled") {
        assert.equal(n, 1, `seed ${seed} w${window}: c${i} succeeded but applied ${n}×`);
        assert.equal((r.value.meta as { TransactionResult: string }).TransactionResult, "tesSUCCESS");
      } else {
        const e = r.reason;
        assert.ok(e instanceof XrplTxError, `seed ${seed}: c${i} ${String(e)}`);
        if (e.engineResult.startsWith("tec")) assert.equal(n, 1, `seed ${seed} w${window}: c${i} ${e.engineResult} (retriable ${e.retriable}) but applied ${n}×`);
        else if (e.engineResult !== "unknown_outcome" && e.engineResult !== "connection_lost") assert.equal(n, 0, `seed ${seed} w${window}: c${i} ${e.engineResult} but applied`);
        if (e.retriable) assert.equal(n, 0);
        assert.ok(!e.engineResult.startsWith("tes"), `seed ${seed} w${window}: c${i} failed with ${e.engineResult}`);
      }
    });
    const ours = [...L.done.values()].filter((d) => d.tx.intent.startsWith("c"));
    assert.equal(new Set(ours.map((d) => d.tx.seq)).size, ours.length, `seed ${seed}: a Sequence used twice`);
    assert.deepEqual(L.rangeViolations, []);
    assert.ok((pipelineState(acct)?.maxInFlight ?? 0) <= window);
    assertIdle(acct);
  }
});

// ── explicit lock sections, pre-signed blobs, mode switch ────────────────────────────────

test("withAccountLock drains the window first, runs with locked semantics, and the counter is re-read after it", T, async () => {
  const L = new SeqLedger(1000);
  const acct = "rEXCL";
  const before = burst(L, acct, "e", 5);
  let appliedAtStart: number[] = [];
  const excl = withAccountLock(acct, async () => {
    appliedAtStart = range(0, 5).map((i) => L.applied.get(`e${i}`) ?? 0);
    assert.equal(pipelineState(acct)?.inFlight, 0);
    // what loanSet / submitBatch do: autofill from the ledger under the lock, then submit the pre-signed blob
    return submitReliably(await L.preparer("self", { account: acct })(await L.nextSequence(acct)), L, FAST);
  });
  const after = submitPipelined({ account: acct, txType: "Payment", prepare: L.preparer("late", { account: acct }) }, L, { ...FAST, window: 5 });
  const [b, x, a] = await Promise.all([Promise.all(before), excl, after]);
  assert.deepEqual(appliedAtStart, [1, 1, 1, 1, 1]);
  assert.deepEqual(b.map(seqOf), range(1000, 5));
  assert.equal(seqOf(x), 1005);
  assert.equal(seqOf(a), 1006); // re-read after the section: no tefPAST_SEQ
  assert.equal(L.submits.length, 7);
  assertIdle(acct);
});

test("pre-signed blob next to a pipeline: waits for the window, keeps its own Sequence; a conflict surfaces as tefPAST_SEQ", T, async () => {
  const L = new SeqLedger(1000);
  const acct = "rPRESIGNED";
  const stale = await L.preparer("blob", { account: acct })(1000); // signed elsewhere against an older view
  const pipelined = burst(L, acct, "b", 3);
  const sub = withAccountLock(acct, () => submitReliably(stale, L, FAST));
  const [ok, r] = await Promise.all([Promise.all(pipelined), sub.then(() => undefined, (e: unknown) => e)]);
  assert.deepEqual(ok.map(seqOf), range(1000, 3));
  assert.ok(r instanceof XrplTxError);
  assert.equal(r.engineResult, "tefPAST_SEQ");
  assert.equal(r.retriable, true); // never applied; the caller must re-prepare
  assert.equal(L.prepares.get("blob"), 1);
  assert.equal(L.applied.get("blob"), undefined);
});

test("usePipeline: pipelined mode only, never inside a held lock for the account, never for Batch / own Sequence", async () => {
  try {
    setSubmitMode("locked");
    assert.ok(!usePipeline("rU", { TransactionType: "Payment" }));
    assert.deepEqual(setSubmitMode("pipelined", { window: 3 }), { mode: "pipelined", window: 3 });
    assert.deepEqual(getSubmitMode(), { mode: "pipelined", window: 3 });
    assert.ok(usePipeline("rU", { TransactionType: "Payment" }));
    assert.ok(!usePipeline("rU", { TransactionType: "Batch" }));
    assert.ok(!usePipeline("rU", { TransactionType: "Payment", Sequence: 7 }));
    assert.ok(!usePipeline("rU", { TransactionType: "Payment", TicketSequence: 7 }));
    await withAccountLock("rU", async () => {
      assert.ok(!usePipeline("rU", { TransactionType: "Payment" }));
      assert.ok(usePipeline("rOTHER", { TransactionType: "Payment" }));
    });
  } finally {
    resetSubmitMode();
  }
});

test("submit mode from env (XRPL_PIPELINE, XRPL_PIPELINE_WINDOW) and setSubmitMode validation", () => {
  assert.deepEqual(submitModeFromEnv({}), { mode: "locked", window: DEFAULT_PIPELINE_WINDOW });
  assert.deepEqual(submitModeFromEnv({ XRPL_PIPELINE: "1" }), { mode: "pipelined", window: 5 });
  assert.deepEqual(submitModeFromEnv({ XRPL_PIPELINE: "true", XRPL_PIPELINE_WINDOW: "3" }), { mode: "pipelined", window: 3 });
  assert.equal(submitModeFromEnv({ XRPL_PIPELINE: "0" }).mode, "locked");
  for (const w of ["0", "11", "2.5", "x"]) assert.throws(() => submitModeFromEnv({ XRPL_PIPELINE_WINDOW: w }), /window/);
  assert.throws(() => setSubmitMode("pipelined", { window: 11 }), /window/);
  assert.throws(() => setSubmitMode("fast" as never), /unknown mode/);
  resetSubmitMode();
});
