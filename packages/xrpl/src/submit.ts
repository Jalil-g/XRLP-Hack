// Submission hardening (XRPL-12): per-account lock, result classification, bounded retries.
// Network-free: the ledger is reached through an injected `LedgerIo` (real one lives in client.ts),
// so every retry path is unit-tested offline (test/submit.test.ts).
//
// Safety rules:
//  - Resubmitting the SAME signed blob is always safe (same hash can apply at most once).
//  - A NEW blob is only built when the previous one provably cannot apply:
//      tel* (not applied, not relayed, not retried: client.ts submits with fail_hard, without which rippled HOLDS such a
//        blob and re-applies it at later ledgers) or LastLedgerSequence passed with no hit in a fully-searched range
//        → re-sign with the SAME Sequence (mutually exclusive with the old blob, so never a double-apply);
//      tefPAST_SEQ on a blob that never reached the ledger → re-sign with a fresh Sequence, but only once every
//        other blob of this intent that may have reached a server is settled (validated or provably expired).
//        "Never reached": for a blob signed in this call, not tracked as maybe-applied and its lookup isn't validated
//        (rippled's cache answers "not validated" for the refused blob itself); for a pre-signed blob, which may have
//        an earlier history, proven from account state (who used the Sequence), never from a `tx` lookup.
//  - tec* / tem* / other tef* are final; never retried.
//  - tec* under fail_hard: rippled answers the tec but applies NOTHING (no fee, Sequence untouched, not relayed, not
//    held), so an intended on-ledger failure (wrong fulfillment, tecNO_AUTH deposit, tecTOO_SOON) would never land.
//    The SAME blob is resubmitted at once without fail_hard (`softResubmit`): same hash → it applies at most once, and
//    its Sequence S is still free (the tec answer proves it), so it's the only blob of the intent that can take S.
//    From then on rippled may hold/relay it: it is tracked as possibly applied until validated or provably expired,
//    whatever that second answer is, and nothing with a fresh Sequence is signed meanwhile.
//  - `retriable: true` only when no blob of the intent can still apply. Anything else whose outcome isn't known is
//    `unknown_outcome` / `connection_lost` (non-retriable): the caller must look the hash up, not re-run.
// Opt-in pipelined mode (XRPL-17, bottom of this file): the lock covers only prepare→sign→submit, up to `window`
// txs per account wait for validation together. Default stays locked.
import { AsyncLocalStorage } from "node:async_hooks";
import { ConnectionError, decode, hashes } from "xrpl";
import { redactedCause, redactSecrets, XrplTxError } from "./errors.ts";

/**
 * Largest LastLedgerSequence margin (ledgers) the engine accepts. "Provably not applied" is a ranged `tx` lookup from the
 * first ledger the tx could land in to its LastLedgerSequence, and rippled searches at most 1000 ledgers per lookup.
 */
export const MAX_LLS_MARGIN = 500;

/** Throws unless `margin` is an integer in 1..MAX_LLS_MARGIN (`what` names the setting). Returns it. */
export function assertLlsMargin(margin: unknown, what = "lastLedgerMargin"): number {
  if (typeof margin !== "number" || !Number.isInteger(margin) || margin < 1 || margin > MAX_LLS_MARGIN) {
    throw new Error(`${what} must be an integer in 1..${MAX_LLS_MARGIN} ledgers, got ${JSON.stringify(margin)}`);
  }
  return margin;
}

// ── Per-account async mutex ────────────────────────────────────────────────────────────────

const tails = new Map<string, Promise<void>>();
const held = new AsyncLocalStorage<ReadonlySet<string>>();

/**
 * Run `fn` while holding the lock for `account` (FIFO). Re-entrant within the same async call chain,
 * so a caller can wrap autofill→sign→`submitBlob` (which locks again) without deadlocking.
 * Do not fan out (Promise.all) txs for the same account *inside* the lock: re-entrant calls are not serialised.
 * If the account has pipelined txs in flight (XRPL-17), it first waits for them to settle, and the pipeline re-reads
 * the account's Sequence afterwards, so an explicit lock section keeps exactly the locked semantics.
 */
export async function withAccountLock<T>(account: string, fn: () => Promise<T>): Promise<T> {
  if (held.getStore()?.has(account)) return fn();
  const pipe = pipes.get(account);
  if (!pipe) return lockAccount(account, fn);
  pipe.exclusive++;
  try {
    await pipe.until(() => pipe.tickets.size === 0);
    return await lockAccount(account, fn);
  } finally {
    pipe.exclusive--;
    pipe.nextSeq = undefined; // fn may have used Sequences the pipeline did not count
    pipe.wake();
  }
}

/** The raw FIFO mutex (re-entrant). Pipelined submits hold it only across prepare→sign→submit. */
async function lockAccount<T>(account: string, fn: () => Promise<T>): Promise<T> {
  const mine = held.getStore();
  if (mine?.has(account)) return fn();
  const prev = tails.get(account) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const tail = prev.then(() => gate);
  tails.set(account, tail);
  await prev;
  try {
    return await held.run(new Set([...(mine ?? []), account]), fn);
  } finally {
    release();
    if (tails.get(account) === tail) tails.delete(account);
  }
}

/** Accounts with a held or queued lock (for tests/diagnostics). */
export function lockedAccounts(): string[] {
  return [...tails.keys()];
}

// ── Classification ─────────────────────────────────────────────────────────────────────────

/**
 * What to do with a preliminary `submit` engine result:
 *  - pending   wait for the validated outcome (tesSUCCESS, terQUEUED, tefALREADY, other ter*, tec*; a tec* from a
 *              fail_hard submit is first resubmitted without fail_hard, see isDiscardedTec)
 *  - resubmit  transient, not applied: back off and resubmit (telINSUF_FEE_P, telCAN_NOT_QUEUE*)
 *  - past_seq  tefPAST_SEQ: sequence consumed (maybe by this very tx on an earlier submit)
 *  - expired   tefMAX_LEDGER: LastLedgerSequence already passed, not applied
 *  - fatal     tem*, other tef* and tel*: never retried
 */
export type PreliminaryClass = "pending" | "resubmit" | "past_seq" | "expired" | "fatal";

export function classifyPreliminary(engineResult: string): PreliminaryClass {
  if (engineResult === "tesSUCCESS" || engineResult === "tefALREADY") return "pending";
  if (engineResult === "tefPAST_SEQ") return "past_seq";
  if (engineResult === "tefMAX_LEDGER") return "expired";
  if (engineResult === "telINSUF_FEE_P" || engineResult.startsWith("telCAN_NOT_QUEUE")) return "resubmit";
  if (engineResult.startsWith("ter") || engineResult.startsWith("tec")) return "pending";
  return "fatal";
}

const TRANSIENT_RPC = new Set(["tooBusy", "noNetwork", "noCurrent", "noClosed", "slowDown", "notReady", "amendmentBlocked"]);

/** rippled RPC errors that mean "the server did not process the request, try again later". */
export function isTransientRpcError(e: unknown): boolean {
  const code = (e as { data?: { error?: string } })?.data?.error;
  return typeof code === "string" && TRANSIENT_RPC.has(code);
}

/** Websocket-level failures (disconnect, not connected, request timeout). Outcome of an in-flight submit is unknown. */
export function isConnectionError(e: unknown): boolean {
  if (e instanceof ConnectionError) return true;
  const msg = e instanceof Error ? e.message : String(e);
  return /websocket|not connected|disconnected|ECONNRESET|ECONNREFUSED|socket hang up|ETIMEDOUT/i.test(msg);
}

// ── Retry engine ───────────────────────────────────────────────────────────────────────────

export interface SignedBlob {
  blob: string;
  hash: string;
  account: string;
  txType: string;
  sequence?: number;
  lastLedgerSequence?: number;
  /** Pipelined: earliest ledger the blob can be in (validated index + 1 when prepared); saves a round trip. */
  minLedger?: number;
}

/** Decode a signed blob into what the retry engine needs. */
export function describeBlob(blob: string, txType?: string): SignedBlob {
  const tx = decode(blob) as { Account?: string; TransactionType?: string; Sequence?: number; LastLedgerSequence?: number };
  return {
    blob,
    hash: hashes.hashSignedTx(blob),
    account: String(tx.Account ?? ""),
    txType: txType ?? String(tx.TransactionType ?? "tx"),
    ...(tx.Sequence !== undefined ? { sequence: tx.Sequence } : {}),
    ...(tx.LastLedgerSequence !== undefined ? { lastLedgerSequence: tx.LastLedgerSequence } : {}),
  };
}

export type Lookup =
  | { status: "validated"; result: Record<string, unknown> }
  | { status: "pending" }
  | { status: "missing"; searchedAll: boolean };

/** Options of one `submit`. */
export interface SubmitCallOptions {
  /** Default true (security review H1b). false only for `softResubmit` of a blob whose fail_hard answer was tec*. */
  failHard?: boolean;
}

/**
 * The provisional result of a fail_hard submit says "this tx would fail with a tec" but rippled applied nothing
 * (TapFAIL_HARD: the tec is discarded, no fee claimed, Sequence not consumed, not relayed, not held).
 */
export function isDiscardedTec(engineResult: string): boolean {
  return engineResult.startsWith("tec");
}

/**
 * How to read the answer to a resubmit WITHOUT fail_hard (after a discarded tec). Without fail_hard rippled holds
 * ter* / tel* / tef* (except tefPAST_SEQ) and may relay a local tx, so anything it may have taken is "pending" (may apply);
 * only tefMAX_LEDGER (LastLedgerSequence passed: can't apply anywhere) and tem* (malformed: never applies) are not.
 */
export function classifySoftResubmit(engineResult: string): PreliminaryClass {
  if (engineResult === "tefMAX_LEDGER") return "expired";
  if (engineResult.startsWith("tem")) return "fatal";
  return "pending";
}

/** The ledger operations the engine needs. Real implementation: client.ts `realLedgerIo`. */
export interface LedgerIo {
  submit(blob: string, opts?: SubmitCallOptions): Promise<{ engineResult: string; message?: string }>;
  /** `tx` by hash; when `range` is given rippled reports whether it searched all of it. */
  lookup(hash: string, range?: { min: number; max: number }): Promise<Lookup>;
  validatedLedgerIndex(): Promise<number>;
  reconnect(): Promise<void>;
  sleep(ms: number): Promise<void>;
}

export type ResignMode = "same_seq" | "new_seq";
/** Re-prepare (fresh Fee + LastLedgerSequence; Sequence kept for same_seq) and re-sign the same intent. */
export type Resign = (mode: ResignMode) => Promise<SignedBlob>;

export interface RetryEvent {
  attempt: number;
  reason: string;
  hash: string;
  action: "resubmit_same_blob" | ResignMode;
}

export interface RetryPolicy {
  /** Total submit attempts incl. the first. Default 5. */
  maxAttempts?: number;
  /** Poll interval while waiting for validation. Default 1000ms. */
  pollMs?: number;
  /** First backoff between attempts, doubled each time, capped at 4s. Default 500ms. */
  backoffMs?: number;
  /** Give up waiting on a blob with no LastLedgerSequence after this long. Default 120s. */
  maxWaitMs?: number;
  onRetry?: (e: RetryEvent) => void;
}

/** submitReliably-only options. */
export interface ReliableOptions extends RetryPolicy {
  resign?: Resign;
  /**
   * `first` was signed for this call and never submitted before (submitWithSigner). Then a `tefPAST_SEQ` on a blob of
   * this call that was never tracked as maybe-applied proves it dead at once (under fail_hard nothing is held).
   * Unset (pre-signed blobs, submitBlob): `first` may have an earlier history (an earlier call, another process), so
   * "known, not validated" may be a provisional apply in an open ledger, and account state decides (see pastSeqOwner).
   */
  freshFirst?: boolean;
}

/** The optional account-state reads (PipelineIo) the locked engine uses for pre-signed `tefPAST_SEQ` proofs. */
type AccountStateIo = Pick<PipelineIo, "sequenceAt" | "txWithSequence">;
const hasAccountState = (io: LedgerIo): io is LedgerIo & AccountStateIo =>
  typeof (io as Partial<AccountStateIo>).sequenceAt === "function" && typeof (io as Partial<AccountStateIo>).txWithSequence === "function";

/** Final validated `tx` result (has `meta.TransactionResult`, `hash`, `ledger_index`, `tx_json`). */
export type ValidatedTx = Record<string, unknown> & { hash?: string };

const MAX_CONN_ERRORS = 5;
const MAX_INCOMPLETE_HISTORY_POLLS = 10;
/** `tooBusy`-style answers to a `tx` lookup tolerated while waiting for a result (polled through, then unknown_outcome). */
const MAX_BUSY_POLLS = 20;
/** Widest `tx` range rippled searches in one lookup. */
const MAX_LOOKUP_SPAN = 999;

function finalResult(r: Record<string, unknown>): string {
  const meta = r.meta as { TransactionResult?: string } | undefined;
  return meta?.TransactionResult ?? "unknown";
}

/**
 * Submit `first`, wait for validation, retry transient failures. Returns the validated tx on tesSUCCESS.
 * Throws `XrplTxError` otherwise; `retriable` is true only when NO blob of this intent can still apply (every one was
 * refused before reaching a ledger, or provably expired), so re-preparing from scratch is safe. A failure whose outcome is
 * unknown is `connection_lost` / `unknown_outcome` (non-retriable, with the hash to look up).
 * Every blob that may have reached a server stays tracked until it validates or provably expires; a fresh Sequence is
 * only signed, and a retriable or definite failure only thrown, once all of them are settled (security review H1/H2).
 * Without `resign` (pre-signed blobs) only same-blob resubmits are possible; anything needing a new blob throws retriable.
 */
export async function submitReliably(first: SignedBlob, io: LedgerIo, opts: ReliableOptions = {}): Promise<ValidatedTx> {
  const maxAttempts = opts.maxAttempts ?? 5;
  const pollMs = opts.pollMs ?? 1000;
  const backoff0 = opts.backoffMs ?? 500;
  const maxWaitMs = opts.maxWaitMs ?? 120_000;
  let cur = first;
  /**
   * Blobs of this intent that may have reached a server (submit answered pending, or the socket died mid-submit) and are
   * not yet settled. They all share one Sequence (same-Sequence re-signs), so at most one of them can apply.
   */
  const live = new Map<string, SignedBlob>();
  /** First ledger each hash could have landed in (validated index + 1 at its first submit). */
  const firstLedger = new Map<string, number>();
  let connErrors = 0;
  /**
   * This call handed some blob to `io.submit` (it may have reached a server). While false, every error says `notSent`:
   * finishEscrow, whose blob was signed just before, then reports its fulfillment as never revealed (unsafe_release).
   */
  let everSent = false;

  const fail = (code: string, retriable: boolean, opt: { hash?: string; detail?: string; cause?: unknown } = {}) =>
    new XrplTxError(cur.txType, redactSecrets(code), opt.hash, {
      retriable,
      ...(everSent ? {} : { notSent: true }),
      ...(opt.detail ? { detail: opt.detail } : {}),
      ...(opt.cause !== undefined ? { cause: redactedCause(opt.cause) } : {}),
    });

  /** Hashes of this intent that may still apply, oldest first (for "check the hash" messages). */
  const unsettled = () => [...new Set([...live.keys(), cur.hash])];
  // Before this call's first submit it is still connection_lost (a pre-signed blob may have an earlier history), but
  // flagged notSent: a caller that knows the blob is fresh (finishEscrow) can tell its secret never left the process.
  const lost = (e: unknown) =>
    fail("connection_lost", false, {
      hash: cur.hash,
      detail: everSent ? `outcome unknown; check ${unsettled().join(", ")}` : "connection lost before this call submitted anything",
      cause: e,
    });

  const onConnError = async (e: unknown) => {
    if (++connErrors > MAX_CONN_ERRORS) throw lost(e);
    try {
      await io.reconnect();
    } catch (re) {
      // A failed reconnect is one more connection error, never a raw throw that loses the hash.
      if (++connErrors > MAX_CONN_ERRORS) throw lost(re);
    }
  };

  /** Wait until `blob` is validated (→ result) or provably expired (→ "expired"). */
  const waitFinal = async (blob: SignedBlob, minLedger: number): Promise<ValidatedTx | "expired"> => {
    const started = Date.now();
    let incomplete = 0;
    let busy = 0;
    let lastValidated = -1;
    let progressAt = started;
    for (;;) {
      try {
        const v = await io.validatedLedgerIndex();
        if (v > lastValidated) {
          lastValidated = v;
          progressAt = Date.now();
        } else if (Date.now() - progressAt > maxWaitMs) {
          throw fail("unknown_outcome", false, { hash: blob.hash, detail: `no new validated ledger for ${Math.round(maxWaitMs / 1000)}s; check the hash` });
        }
        const lls = blob.lastLedgerSequence;
        const closedOut = lls !== undefined && v >= lls;
        const range = closedOut ? { min: Math.max(minLedger, lls - MAX_LOOKUP_SPAN), max: lls } : undefined;
        const lk = await io.lookup(blob.hash, range);
        if (lk.status === "validated") return lk.result;
        if (closedOut) {
          // Proof only if the searched range starts where the tx could first have landed (L1: margins > 999 ledgers).
          if (lk.status === "missing" && lk.searchedAll && range!.min <= minLedger) return "expired";
          // Missing without a full search, or "known, not validated" past LastLedgerSequence (rippled answers a
          // never-included tx from its cache): neither is proof. Bounded, then unknown_outcome (review finding 2).
          if (++incomplete > MAX_INCOMPLETE_HISTORY_POLLS) {
            const why = lk.status === "pending" ? "still known but not validated past its LastLedgerSequence (server cache)" : "server history incomplete";
            throw fail("unknown_outcome", false, { hash: blob.hash, detail: `${why}; check the hash` });
          }
        }
        if (lls === undefined && Date.now() - started > maxWaitMs)
          throw fail("unknown_outcome", false, { hash: blob.hash, detail: "no LastLedgerSequence; gave up waiting" });
      } catch (e) {
        if (e instanceof XrplTxError) throw e;
        if (isConnectionError(e)) await onConnError(e);
        else if (!(isTransientRpcError(e) && ++busy <= MAX_BUSY_POLLS))
          throw fail("unknown_outcome", false, { hash: blob.hash, detail: "could not look the tx up; check the hash", cause: e });
      }
      await io.sleep(pollMs);
    }
  };

  const waitFor = (b: SignedBlob) => waitFinal(b, Math.min(firstLedger.get(b.hash) ?? 1, b.lastLedgerSequence ?? Infinity));

  /** One unranged lookup: "missing" only when the server says txnNotFound; any error counts as "maybe applied". */
  const peek = async (hash: string): Promise<Lookup["status"]> => {
    try {
      return (await io.lookup(hash)).status;
    } catch {
      return "pending";
    }
  };

  /**
   * tefPAST_SEQ on a blob that may have been submitted before this call (pre-signed): did IT take its Sequence S?
   * A `tx` lookup can't tell (rippled answers "known, not validated" for any cached blob, and also for one sitting
   * provisionally applied in an open ledger), so account state decides, as in pipelined R5: S used in a validated
   * ledger → `account_tx` names the taker (ours → that's the result; another tx → ours can never apply); the account's
   * Sequence at our LastLedgerSequence L still ≤ S → nothing used S by L, and the blob can't apply after L → dead.
   * undefined: this io can't read account state → the caller waits for the blob instead (safe, slower).
   */
  const pastSeqOwner = async (b: SignedBlob): Promise<ValidatedTx | "dead" | undefined> => {
    const S = b.sequence;
    if (!hasAccountState(io) || !S) return undefined; // Sequence 0 = a Ticket: not a Sequence question
    const L = b.lastLedgerSequence;
    const started = Date.now();
    let incomplete = 0;
    let busy = 0;
    for (;;) {
      try {
        const v = await io.validatedLedgerIndex();
        const lk = await io.lookup(b.hash);
        if (lk.status === "validated") return lk.result;
        const at = L !== undefined && v >= L ? L : v;
        const seqAt = await io.sequenceAt(b.account, at);
        if (seqAt !== undefined && seqAt > S) {
          const taker = await io.txWithSequence(b.account, S, { min: Math.max(1, at - MAX_LOOKUP_SPAN), max: at });
          if (taker) return taker.hash === b.hash ? taker : "dead";
          if (++incomplete > MAX_INCOMPLETE_HISTORY_POLLS) throw fail("unknown_outcome", false, { hash: b.hash, detail: "tefPAST_SEQ: Sequence used, but the tx that used it isn't in the account history; check the hash" });
        } else if (seqAt !== undefined) {
          if (at === L) return "dead"; // S still unused in ledger L: the blob never applied and can't any more
          // S is only used in the open ledger so far: wait for the ledger that validates it
        } else if (++incomplete > MAX_INCOMPLETE_HISTORY_POLLS) {
          throw fail("unknown_outcome", false, { hash: b.hash, detail: "tefPAST_SEQ: the server can't show the account's past state; check the hash" });
        }
        if (L === undefined && Date.now() - started > maxWaitMs) throw fail("unknown_outcome", false, { hash: b.hash, detail: "tefPAST_SEQ, no LastLedgerSequence; gave up waiting; check the hash" });
      } catch (e) {
        if (e instanceof XrplTxError) throw e;
        if (isConnectionError(e)) await onConnError(e);
        else if (!(isTransientRpcError(e) && ++busy <= MAX_BUSY_POLLS))
          throw fail("unknown_outcome", false, { hash: b.hash, detail: "could not read the account state; check the hash", cause: e });
      }
      await io.sleep(pollMs);
    }
  };

  /**
   * Wait until every live blob (except `skip`) has validated or provably expired. A validated one decides the intent:
   * tesSUCCESS is returned, tec* thrown (final). undefined = none of them applied, and none can any more.
   */
  const settle = async (skip?: string): Promise<ValidatedTx | undefined> => {
    for (const b of [...live.values()]) {
      if (b.hash === skip) continue;
      const out = await waitFor(b);
      live.delete(b.hash);
      if (out === "expired") continue;
      const res = finalResult(out);
      if (res === "tesSUCCESS") return out;
      throw fail(res, false, { hash: String(out.hash ?? b.hash) });
    }
    return undefined;
  };

  /** A pre-signed `first` may have been submitted before this call; every other blob was signed here. */
  const mayHaveHistory = (b: SignedBlob) => !opts.freshFirst && b.hash === first.hash;

  for (let attempt = 1; ; attempt++) {
    let prelim: string;
    let detail: string | undefined;
    let sending = false;
    /** The tec* a fail_hard submit answered (discarded by rippled) before this attempt's soft resubmit. */
    let discardedTec: string | undefined;
    try {
      const minLedger = (await io.validatedLedgerIndex()) + 1;
      if (!firstLedger.has(cur.hash)) firstLedger.set(cur.hash, minLedger);
      sending = true; // from here on the blob may reach a server
      everSent = true;
      let r = await io.submit(cur.blob);
      if (isDiscardedTec(r.engineResult)) {
        // Nothing applied (see the header): send the SAME blob again without fail_hard so the tec lands on-ledger.
        // Still inside the account lock and the same attempt, so nothing of ours can take S in between.
        discardedTec = r.engineResult;
        r = await io.submit(cur.blob, { failHard: false });
      }
      prelim = r.engineResult;
      detail = r.message;
    } catch (e) {
      if (isConnectionError(e)) {
        if (sending) live.set(cur.hash, cur); // incl. a soft resubmit: the server may hold/relay it
        await onConnError(e);
        prelim = "connection_lost";
      } else if (isTransientRpcError(e)) {
        prelim = String((e as { data: { error: string } }).data.error); // not processed (also for a soft resubmit)
      } else {
        // Refused by the RPC layer. An earlier attempt of this intent may still apply: settle it before saying "failed".
        const won = await settle();
        if (won) return won;
        const code = String((e as { data?: { error?: string } })?.data?.error ?? (e instanceof Error ? e.message : e));
        if (discardedTec) {
          // The tx fails with this tec; it just isn't on the ledger. Keep the tec so callers map it (TooSoonError, …).
          throw fail(discardedTec, false, { detail: `not applied: rippled discarded the provisional ${discardedTec} under fail_hard and refused the resubmit without it (${code})`, cause: e });
        }
        throw fail(code, false, { cause: e });
      }
    }

    let next: RetryEvent["action"];
    let cls: PreliminaryClass | "conn" | "busy" =
      prelim === "connection_lost" ? "conn" : isTransientRpcError({ data: { error: prelim } }) ? "busy" : classifyPreliminary(prelim);
    // An answer to the soft resubmit: rippled may hold or relay it, so whatever it says (tel*, tef*, even tefPAST_SEQ:
    // relayed while the server isn't synced) it may still apply → wait for it like any pending blob.
    if (discardedTec && cls !== "conn" && cls !== "busy") cls = classifySoftResubmit(prelim);

    if (cls === "fatal") {
      const won = await settle(); // this blob was refused; an earlier one may still apply
      if (won) return won;
      throw fail(prelim, false, detail ? { detail } : {});
    }

    // tefPAST_SEQ on a blob not tracked as maybe-applied: did this very blob take the Sequence?
    //  - Signed in this call: every submit that could have left it alive (provisional apply, soft resubmit, lost
    //    socket) put it in `live`, and under fail_hard nothing else is held or relayed, so only "validated" can be
    //    ours; "known, not validated" is just rippled's cache of the refused blob (review issue 2).
    //  - Pre-signed (may have an earlier history): "not validated" may be a provisional apply in an open ledger, so
    //    account state decides (pastSeqOwner); an io without account reads waits for the blob (never retriable early).
    let pastSeq: "wait" | "dead" | undefined;
    if (cls === "past_seq" && !live.has(cur.hash)) {
      const own = await peek(cur.hash);
      if (own === "validated") pastSeq = "wait";
      else if (own === "missing" || !mayHaveHistory(cur)) pastSeq = "dead";
      else {
        const owner = await pastSeqOwner(cur);
        if (owner === undefined) pastSeq = "wait";
        else if (owner === "dead") pastSeq = "dead";
        else {
          const res = finalResult(owner);
          if (res === "tesSUCCESS") return owner;
          throw fail(res, false, { hash: String(owner.hash ?? cur.hash) });
        }
      }
    }
    if (cls === "pending" || (cls === "past_seq" && pastSeq !== "dead")) {
      // Possibly applied: only the ledger can tell. Never build a new blob until this one is provably dead.
      live.set(cur.hash, cur);
      const out = await waitFor(cur);
      live.delete(cur.hash);
      if (out !== "expired") {
        const res = finalResult(out);
        if (res === "tesSUCCESS") return out;
        throw fail(res, false, { hash: String(out.hash ?? cur.hash) });
      }
      prelim = "tefMAX_LEDGER";
      next = "same_seq";
    } else if (cls === "past_seq") {
      // This blob never reached a ledger and its Sequence is gone: taken by an earlier blob of this intent (then that one
      // decides) or by another tx. Only a fresh Sequence can go on, and only once no earlier blob can still apply.
      const won = await settle();
      if (won) return won;
      next = "new_seq";
    } else if (cls === "expired") {
      next = "same_seq";
    } else if (cls === "conn") {
      next = "resubmit_same_blob"; // same hash: idempotent, and lets tefALREADY/tefPAST_SEQ reveal an earlier apply
    } else {
      next = opts.resign ? "same_seq" : "resubmit_same_blob"; // resubmit/busy: fresh Fee if we can re-sign
    }

    if (attempt >= maxAttempts || (next !== "resubmit_same_blob" && !opts.resign)) {
      // Giving up is only "retriable" once nothing of this intent can still apply; settle() waits that out.
      const won = await settle();
      if (won) return won;
      const why = attempt >= maxAttempts ? `gave up after ${attempt} attempts` : "pre-signed blob must be re-prepared";
      // After settle() nothing can apply: a lost connection is no longer an unknown outcome, so don't report it as one.
      if (prelim === "connection_lost") throw fail("not_applied", true, { detail: `connection lost; every attempt refused or provably expired; ${why}` });
      throw fail(prelim, true, { detail: why });
    }

    opts.onRetry?.({ attempt, reason: prelim, hash: cur.hash, action: next });
    await io.sleep(Math.min(backoff0 * 2 ** (attempt - 1), 4000));
    if (next !== "resubmit_same_blob") {
      try {
        cur = await opts.resign!(next);
      } catch (e) {
        if (!live.size) throw e;
        const pending = [...live.keys()];
        throw fail("unknown_outcome", false, { hash: pending[pending.length - 1]!, detail: `re-sign failed while ${pending.join(", ")} may still apply; check the hash`, cause: e });
      }
    }
  }
}

// ── Pipelined mode (XRPL-17, opt-in) ───────────────────────────────────────────────────────
//
// Locked mode (above, the default) holds the account lock from autofill until validation: ~1 tx per ledger per account.
// Pipelined mode (XRPL_PIPELINE=1, or setSubmitMode("pipelined", { window })) holds the account mutex only across
// prepare(Sequence) → sign → submit, keeps the next Sequence locally, and lets up to `window` txs per account wait for
// validation at the same time. Rules (each one is tested in test/pipeline.test.ts):
//
//  R1  Sequences are assigned and submitted under the mutex, in arrival order. The local counter only advances when the
//      server took the blob (tesSUCCESS, terQUEUED, tec*, tefALREADY, other ter*). A tem/tef/tel at submit therefore
//      never leaves a gap: nothing later has been signed yet, and the next tx reuses that Sequence.
//  R2  tec* (Sequence consumed, later txs unaffected) and tem* are final and never retried. Under fail_hard rippled
//      DISCARDS a tec (no fee, Sequence not consumed, not relayed, not held), so the same blob is resubmitted once
//      without fail_hard, still under the mutex (nothing later is signed yet; S is free, the tec answer proves it):
//      same hash → applies at most once, and it is then the tx that takes S. That blob counts as sent whatever the
//      second answer is (rippled may hold or relay it), so only R5 can call it dead.
//  R3  Every blob a ticket may have sent carries ONE Sequence. Same-Sequence re-signs (tel*, tefMAX_LEDGER at submit)
//      are always safe: at most one of them can apply. A tel* blob still counts as sent: rippled may hold it and apply
//      it later (xrpl.org: tel results are provisional). A ticket only gets a different Sequence once every blob it may
//      have sent is provably dead (R5).
//  R4  tefPAST_SEQ on a never-sent blob (another writer used the Sequence), terPRE_SEQ (a gap before us), and a blob
//      that died unapplied (later txs now stall behind its Sequence) mark the account dirty: nothing new is issued,
//      every in-flight tx settles (validated, or provably dead), the counter is re-read from the ledger, and only the
//      dead tickets are re-signed, in arrival order. A tx that may still apply is never re-signed with a new Sequence.
//  R5  Every pipelined blob has a LastLedgerSequence L, so "dead" is provable from account STATE once the validated
//      ledger reaches L: the account's Sequence in ledger L ≤ S (nothing used S by L, and no blob can apply after L),
//      or `account_tx` shows another tx used S. Not from `tx` lookups: rippled answers "validated: false" (never
//      txnNotFound + searched_all) for any blob it has seen, for as long as it stays cached (devnet: protocol notes
//      §0a). Missing history, a failing lookup or a lost connection → `unknown_outcome` / `connection_lost` (never
//      re-signed), and the account resyncs before reuse.
//  R6  Explicit `withAccountLock` sections (self-autofilled or pre-signed blobs, Batch, loan close) are exclusive: they
//      wait for the window to drain, run with locked semantics, and the counter is re-read after them. So pre-signed
//      blobs just submit with their own Sequence; a conflict surfaces as their error. Multisig is just another signer.

export type SubmitModeName = "locked" | "pipelined";

export interface SubmitMode {
  mode: SubmitModeName;
  /** Pipelined: max txs per account between submit and final result. */
  window: number;
}

/** Default pipelined window (txs in flight per account). */
export const DEFAULT_PIPELINE_WINDOW = 5;
/** rippled's TxQ holds at most 10 txs per account, so a bigger window buys nothing. */
export const MAX_PIPELINE_WINDOW = 10;

function checkWindow(w: unknown, from: string): number {
  const n = typeof w === "string" ? Number(w.trim()) : w;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > MAX_PIPELINE_WINDOW) {
    throw new Error(`${from}: pipeline window must be an integer 1..${MAX_PIPELINE_WINDOW}, got ${String(w)}`);
  }
  return n;
}

/** Pure: XRPL_PIPELINE=1|true|yes|on → pipelined; XRPL_PIPELINE_WINDOW=N (default 5). */
export function submitModeFromEnv(env: Record<string, string | undefined> = process.env): SubmitMode {
  const on = /^(1|true|yes|on)$/i.test((env.XRPL_PIPELINE ?? "").trim());
  const w = env.XRPL_PIPELINE_WINDOW;
  return { mode: on ? "pipelined" : "locked", window: w ? checkWindow(w, "XRPL_PIPELINE_WINDOW") : DEFAULT_PIPELINE_WINDOW };
}

let modeOverride: SubmitMode | undefined;

/** Pick the submission mode for this process (overrides XRPL_PIPELINE). Txs already in flight finish as they started. */
export function setSubmitMode(mode: SubmitModeName, opts: { window?: number } = {}): SubmitMode {
  if (mode !== "locked" && mode !== "pipelined") throw new Error(`setSubmitMode: unknown mode ${String(mode)}`);
  modeOverride = { mode, window: opts.window === undefined ? submitModeFromEnv().window : checkWindow(opts.window, "setSubmitMode") };
  return { ...modeOverride };
}

/** Drop the setSubmitMode override: XRPL_PIPELINE decides again. */
export function resetSubmitMode(): void {
  modeOverride = undefined;
}

export function getSubmitMode(): SubmitMode {
  return { ...(modeOverride ?? submitModeFromEnv()) };
}

/**
 * Should this submit take the pipelined path? Only in pipelined mode, never inside a held lock for the account (an
 * explicit `withAccountLock` section keeps locked semantics), and never for a tx with its own Sequence/TicketSequence
 * or a Batch (its inner txs consume Sequences of possibly several accounts, how many depends on its outcome).
 */
export function usePipeline(account: string, tx: { TransactionType: string; Sequence?: number; TicketSequence?: number }): boolean {
  if (getSubmitMode().mode !== "pipelined" || held.getStore()?.has(account)) return false;
  return tx.TransactionType !== "Batch" && tx.Sequence == null && tx.TicketSequence == null;
}

/** LedgerIo plus account state. Real implementation: client.ts `realLedgerIo`. */
export interface PipelineIo extends LedgerIo {
  /** Next Sequence for `account` on the open ledger, after its queued txs (`account_info` current, `queue: true`). */
  nextSequence(account: string): Promise<number>;
  /** `account`'s Sequence in validated ledger `ledgerIndex`; undefined when the server can't say (no such ledger). */
  sequenceAt(account: string, ledgerIndex: number): Promise<number | undefined>;
  /** The validated tx from `account` that used `sequence`, within ledgers `range` (`account_tx`); undefined if none found. */
  txWithSequence(account: string, sequence: number, range: { min: number; max: number }): Promise<ValidatedTx | undefined>;
}

export type PipelineEvent =
  | { kind: "dirty"; account: string; reason: string; hash?: string; sequence?: number }
  | { kind: "resync"; account: string; reason: string; nextSequence?: number; resign: number };

export interface PipelinePolicy extends RetryPolicy {
  /** Max in-flight txs for this account. Default `getSubmitMode().window`. */
  window?: number;
  // pollMs (pipelined): validated-index poll, shared by every pipelined tx on the connection; default 250ms. `tx`
  // lookups only run once a new ledger is validated, so a full window costs ~4 + window/3 requests per second.
  onPipeline?: (e: PipelineEvent) => void;
}

export interface PipelineRequest {
  account: string;
  txType: string;
  /** Build and sign the tx at exactly this Sequence, with a LastLedgerSequence (fresh Fee each call). */
  prepare: (sequence: number) => Promise<SignedBlob>;
}

type TicketState = "waiting" | "issuing" | "in_flight" | "parked" | "done";

interface SentBlob {
  hash: string;
  sequence: number;
  lastLedgerSequence: number;
  /** Validated index + 1 at its first submit: the earliest ledger it could be in. */
  firstLedger: number;
}

interface Ticket {
  readonly id: number;
  readonly req: PipelineRequest;
  readonly io: PipelineIo;
  readonly opts: PipelinePolicy;
  state: TicketState;
  cur?: SignedBlob;
  /** Blobs that may have reached a server. They all carry cur.sequence (R3); cleared once validated or all dead. */
  sent: SentBlob[];
  /** Prepare/submit attempts over the ticket's life (bounded by maxAttempts, re-signs after a resync included). */
  attempts: number;
  /** Last preliminary result or error code (for the give-up message). */
  reason: string;
  /** When every sent blob is provably dead: re-sign after the resync, or fail with this error. */
  onDead: "park" | XrplTxError;
  /** Set by the resync when re-signing this parked ticket failed. */
  error?: unknown;
}

class AccountPipe {
  nextSeq: number | undefined;
  /** Tickets holding a window slot (issuing, in flight or parked). */
  readonly tickets = new Set<Ticket>();
  /** Why the counter can't be trusted; set → nothing new is issued until the resync. */
  dirty: string | undefined;
  /** withAccountLock sections waiting or running: nothing new is issued. */
  exclusive = 0;
  resyncing = false;
  maxInFlight = 0;
  private waiters: Array<() => void> = [];

  constructor(readonly account: string) {}

  wake(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  /** Resolve once `ok()` holds; re-checked on every wake(). `ok` may claim a slot (it runs synchronously). */
  async until(ok: () => boolean): Promise<void> {
    while (!ok()) await new Promise<void>((r) => this.waiters.push(r));
  }

  live(): number {
    let n = 0;
    for (const t of this.tickets) if (t.state === "issuing" || t.state === "in_flight") n++;
    return n;
  }
}

const pipes = new Map<string, AccountPipe>();
let lastTicketId = 0;

export interface PipelineState {
  nextSequence?: number;
  /** Tickets submitting or waiting for validation. */
  inFlight: number;
  /** Provably dead tickets waiting for the resync. */
  parked: number;
  dirty?: string;
  exclusive: number;
  /** High-water mark of inFlight. */
  maxInFlight: number;
}

/** Diagnostics: the pipeline of `account`, if it ever ran. */
export function pipelineState(account: string): PipelineState | undefined {
  const p = pipes.get(account);
  if (!p) return undefined;
  let parked = 0;
  for (const t of p.tickets) if (t.state === "parked") parked++;
  return {
    ...(p.nextSeq !== undefined ? { nextSequence: p.nextSeq } : {}),
    inFlight: p.live(),
    parked,
    ...(p.dirty ? { dirty: p.dirty } : {}),
    exclusive: p.exclusive,
    maxInFlight: p.maxInFlight,
  };
}

/**
 * Pipelined submit: wait for a window slot, sign at the local next Sequence and submit under the account mutex, then
 * wait for the validated result outside it. Returns the validated tx on tesSUCCESS; throws `XrplTxError` otherwise
 * (`retriable` only when nothing was applied). See R1-R6 above.
 */
export async function submitPipelined(req: PipelineRequest, io: PipelineIo, opts: PipelinePolicy = {}): Promise<ValidatedTx> {
  const window = opts.window === undefined ? getSubmitMode().window : checkWindow(opts.window, "submitPipelined");
  let pipe = pipes.get(req.account);
  if (!pipe) pipes.set(req.account, (pipe = new AccountPipe(req.account)));
  const p = pipe;
  const t: Ticket = { id: ++lastTicketId, req, io, opts, state: "waiting", sent: [], attempts: 0, reason: "not_submitted", onDead: "park" };
  await p.until(() => !p.dirty && p.exclusive === 0 && p.tickets.size < window && !!p.tickets.add(t));
  try {
    await lockAccount(req.account, async () => {
      if (p.dirty) t.state = "parked"; // never sent: re-signed by the resync, in order
      else await issue(p, t);
    });
    for (;;) {
      if (t.state === "parked") {
        maybeResync(p, t);
        // Not just "!== parked": the resync marks it issuing before its new blob is submitted.
        await p.until(() => t.state === "in_flight" || t.error !== undefined);
        if (t.error !== undefined) throw t.error;
      }
      const out = await settle(t);
      t.sent = [];
      if (out !== "dead") {
        const res = finalResult(out);
        if (res === "tesSUCCESS") return out;
        throw new XrplTxError(req.txType, res, String(out.hash ?? t.cur?.hash)); // R2: tec* is final
      }
      markDirty(p, t, "expired unapplied"); // R4: its Sequence is free again; later txs stall behind it
      t.reason = "tefMAX_LEDGER"; // not its last preliminary (a provisional tesSUCCESS/tec* that never validated)
      if (t.onDead !== "park") throw t.onDead;
      t.state = "parked";
    }
  } catch (e) {
    if (t.sent.length) markDirty(p, t, `outcome unknown (${e instanceof XrplTxError ? e.engineResult : "error"})`); // R5
    throw e;
  } finally {
    t.state = "done";
    p.tickets.delete(t);
    if (!p.tickets.size && !p.dirty && !p.exclusive) p.nextSeq = undefined; // idle: re-read next time (other writers)
    maybeResync(p, t);
    p.wake();
  }
}

/** Run a caller's onRetry/onPipeline: a throwing logger must never break the engine's state. */
function emit(f: () => void): void {
  try {
    f();
  } catch {
    // ignored
  }
}

function markDirty(p: AccountPipe, t: Ticket, reason: string): void {
  if (p.dirty) return;
  p.dirty = reason;
  const cur = t.cur;
  emit(() => t.opts.onPipeline?.({ kind: "dirty", account: p.account, reason, ...(cur ? { hash: cur.hash } : {}), ...(cur?.sequence !== undefined ? { sequence: cur.sequence } : {}) }));
}

/**
 * Under the account mutex: sign at the local counter, submit, classify (R1). Leaves the ticket in flight or parked,
 * or throws when nothing of it can apply (the counter then still points at the free Sequence).
 */
async function issue(p: AccountPipe, t: Ticket): Promise<void> {
  const { io, opts, req } = t;
  const maxAttempts = opts.maxAttempts ?? 5;
  const backoff0 = opts.backoffMs ?? 500;
  const fail = (code: string, retriable: boolean, o: { hash?: string; detail?: string; cause?: unknown } = {}) =>
    new XrplTxError(req.txType, redactSecrets(code), o.hash, {
      retriable,
      ...(o.detail ? { detail: o.detail } : {}),
      ...(o.cause !== undefined ? { cause: redactedCause(o.cause) } : {}),
    });
  /** One of its blobs may apply: wait (outside the mutex); `onDead` once all are provably dead. */
  const inFlight = (onDead: Ticket["onDead"]) => {
    p.nextSeq = t.cur!.sequence! + 1;
    t.onDead = onDead;
    t.state = "in_flight";
    p.maxInFlight = Math.max(p.maxInFlight, p.live());
  };
  const markSent = (firstLedger: number) => {
    const cur = t.cur!;
    if (!t.sent.some((s) => s.hash === cur.hash)) t.sent.push({ hash: cur.hash, sequence: cur.sequence!, lastLedgerSequence: cur.lastLedgerSequence!, firstLedger });
  };

  t.state = "issuing";
  let fresh = true;
  let connErrors = 0;
  for (let attempt = 1; ; attempt++) {
    if (attempt > 1 && p.dirty) {
      // Another tx died while this one backed off: stop issuing (R4). A live blob of ours is left to settle.
      if (t.sent.length) return inFlight("park");
      t.state = "parked";
      return;
    }
    if (t.attempts >= maxAttempts) {
      // Thrown only once nothing of it can apply (now, or after its sent blobs die), so a lost connection is no longer
      // an unknown outcome (as in submitReliably).
      const lost = t.reason === "connection_lost";
      const err = fail(lost ? "not_applied" : t.reason, true, { detail: `${lost ? "connection lost; " : ""}gave up after ${t.attempts} attempts` });
      if (t.sent.length) return inFlight(err);
      throw err;
    }
    t.attempts++;
    let prelim: string;
    let detail: string | undefined;
    let firstLedger = 0;
    let preparing = fresh;
    let discardedTec: string | undefined;
    try {
      if (fresh) {
        if (p.nextSeq === undefined) p.nextSeq = await io.nextSequence(req.account);
        const seq = p.nextSeq;
        const b = await req.prepare(seq);
        if (b.sequence !== seq || b.lastLedgerSequence === undefined) {
          throw new Error(`${req.txType}: pipelined prepare must sign at Sequence ${seq} with a LastLedgerSequence`);
        }
        t.cur = b;
        fresh = false;
      }
      preparing = false;
      firstLedger = t.cur!.minLedger ?? (await io.validatedLedgerIndex()) + 1; // any index seen before submit is a safe floor
      try {
        let r = await io.submit(t.cur!.blob);
        if (isDiscardedTec(r.engineResult)) {
          // R2: fail_hard discarded the tec; the same blob again without it, still under the mutex (nothing later is
          // signed yet, and S is still free: the tec answer proves it).
          discardedTec = r.engineResult;
          r = await io.submit(t.cur!.blob, { failHard: false });
        }
        prelim = r.engineResult;
        detail = r.message;
      } catch (e) {
        if (isConnectionError(e)) markSent(firstLedger); // the server may have taken it
        throw e;
      }
    } catch (e) {
      if (isConnectionError(e)) {
        if (++connErrors > MAX_CONN_ERRORS) {
          // Nothing sent → nothing can apply → retriable. Possibly sent → outcome unknown, and the account resyncs
          // before anyone else takes this Sequence.
          if (!t.sent.length) throw fail("not_applied", true, { detail: "connection lost before the blob was sent", cause: e });
          markDirty(p, t, "outcome unknown (connection_lost)");
          p.nextSeq = undefined;
          throw fail("connection_lost", false, { hash: t.cur!.hash, detail: "outcome unknown; check the hash", cause: e });
        }
        await io.reconnect();
        prelim = "connection_lost";
      } else if (isTransientRpcError(e)) {
        prelim = String((e as { data: { error: string } }).data.error);
      } else {
        if (preparing && !t.sent.length) throw e; // e.g. actNotFound from account_info: raw, as locked mode's autofill
        const code = String((e as { data?: { error?: string } })?.data?.error ?? (e instanceof Error ? e.message : e));
        const err = discardedTec
          ? fail(discardedTec, false, { detail: `not applied: rippled discarded the provisional ${discardedTec} under fail_hard and refused the resubmit without it (${code})`, cause: e })
          : fail(code, false, { cause: e });
        if (t.sent.length) return inFlight(err);
        throw err;
      }
    }
    t.reason = prelim;

    let cls: PreliminaryClass | "conn" | "busy" =
      prelim === "connection_lost" ? "conn" : isTransientRpcError({ data: { error: prelim } }) ? "busy" : classifyPreliminary(prelim);
    if (discardedTec && cls !== "conn" && cls !== "busy") {
      // R2/R3: the soft resubmit may be held or relayed, so it counts as sent whatever it answered; only account state
      // can call it dead (R5). A tel* keeps its same-Sequence re-sign path; everything else waits.
      const soft = classifySoftResubmit(prelim);
      if (soft === "pending") {
        markSent(firstLedger);
        if (cls !== "resubmit") cls = "pending";
      } else cls = soft;
    }
    if (cls === "pending") {
      markSent(firstLedger);
      inFlight("park");
      if (prelim === "terPRE_SEQ") markDirty(p, t, "terPRE_SEQ"); // held by the server until the gap before it fills
      return;
    }
    if (cls === "past_seq" || cls === "expired") {
      if (t.sent.length) return inFlight("park"); // an earlier submit of this Sequence may have applied: settle decides
      if (cls === "past_seq") {
        // Never sent and its Sequence is used: cannot apply. Someone else used it, so the counter is behind.
        markDirty(p, t, "tefPAST_SEQ");
        p.nextSeq = undefined;
        t.state = "parked";
        return;
      }
      fresh = true; // tefMAX_LEDGER, never sent: same Sequence, fresh LastLedgerSequence
    } else if (cls === "resubmit") {
      markSent(firstLedger); // tel*: not applied now, but rippled may hold and retry it until its LastLedgerSequence
      fresh = true; // same Sequence, fresh Fee: at most one of the two can apply
    } else if (cls === "fatal") {
      const err = fail(prelim, false, detail ? { detail } : {});
      if (t.sent.length) return inFlight(err);
      throw err; // R1: not applied, the Sequence stays free for the next tx
    }
    // conn / busy: the same blob again (same hash: idempotent); if prepare itself failed, prepare again

    const cur = t.cur;
    if (cur) emit(() => opts.onRetry?.({ attempt: t.attempts, reason: prelim, hash: cur.hash, action: fresh ? "same_seq" : "resubmit_same_blob" }));
    await io.sleep(Math.min(backoff0 * 2 ** (attempt - 1), 4000));
  }
}

/** Default validated-index poll in pipelined mode (one poller per connection). */
export const PIPELINE_POLL_MS = 250;

/**
 * One validated-ledger poller per LedgerIo, shared by every pipelined tx waiting on it: they all wake right after a
 * ledger validates (so freed window slots refill into the next open ledger), and run their lookups once per ledger
 * instead of once per poll. Runs only while someone waits, outside any caller's lock context.
 */
class LedgerWatch {
  ms = PIPELINE_POLL_MS;
  private seen = 0;
  private waiters: Array<{ after: number; resolve: (v: number) => void; reject: (e: unknown) => void }> = [];
  private running = false;

  constructor(private readonly io: LedgerIo) {}

  /** The validated index once it is above `after` (at once if already known). */
  next(after: number): Promise<number> {
    if (this.seen > after) return Promise.resolve(this.seen);
    return new Promise((resolve, reject) => {
      this.waiters.push({ after, resolve, reject });
      if (!this.running) {
        this.running = true;
        held.exit(() => void this.run());
      }
    });
  }

  private async run(): Promise<void> {
    try {
      while (this.waiters.length) {
        let v: number;
        try {
          v = await this.io.validatedLedgerIndex();
        } catch (e) {
          const all = this.waiters; // each waiter handles it (reconnect / back off, bounded)
          this.waiters = [];
          for (const w of all) w.reject(e);
          return;
        }
        const back = v < this.seen; // a devnet reset, or a server behind the last one: wake everyone with the new index
        this.seen = v;
        const ready = back ? this.waiters : this.waiters.filter((w) => v > w.after);
        this.waiters = back ? [] : this.waiters.filter((w) => !(v > w.after));
        for (const w of ready) w.resolve(v);
        if (this.waiters.length) await this.io.sleep(this.ms);
      }
    } finally {
      this.running = false;
    }
  }
}

const watches = new WeakMap<LedgerIo, LedgerWatch>();

/**
 * Outside the mutex: wait until one sent blob is validated (→ result) or all are provably dead (R3, R5). All sent blobs
 * carry one Sequence S. While the validated ledger is below their highest LastLedgerSequence L, only the blob lookups
 * can decide (validated → result). From L on, account state decides: Sequence in ledger L ≤ S → none applied (dead);
 * > S → S was used by some tx by L: `account_tx` names it (ours → that's the result; another → ours are dead).
 */
async function settle(t: Ticket): Promise<ValidatedTx | "dead"> {
  const { io, opts, req } = t;
  if (!t.sent.length) throw new Error(`${req.txType}: settle with nothing sent (pipeline bug)`); // "dead" must be proven
  const seq = t.sent[0]!.sequence;
  if (t.sent.some((s) => s.sequence !== seq)) throw new Error(`${req.txType}: sent blobs with different Sequences (pipeline bug)`);
  let watch = watches.get(io);
  if (!watch) watches.set(io, (watch = new LedgerWatch(io)));
  if (opts.pollMs !== undefined) watch.ms = Math.min(watch.ms, opts.pollMs);
  const last = () => t.sent[t.sent.length - 1]!.hash;
  const unknown = (detail: string, cause?: unknown) =>
    new XrplTxError(req.txType, "unknown_outcome", last(), { detail, ...(cause !== undefined ? { cause: redactedCause(cause) } : {}) });
  let connErrors = 0;
  let incomplete = 0;
  let busy = 0;
  let seen = 0;
  for (;;) {
    try {
      const v = (seen = await watch.next(seen)); // a stale cached index only delays the proof: never wrongly dead
      for (const s of t.sent) {
        const lk = await io.lookup(s.hash);
        if (lk.status === "validated") return lk.result;
      }
      const lls = Math.max(...t.sent.map((s) => s.lastLedgerSequence));
      if (v >= lls) {
        const at = await io.sequenceAt(req.account, lls);
        if (at !== undefined && at <= seq) return "dead"; // nothing used S by L, and no blob can apply after its LLS
        if (at !== undefined) {
          const floor = Math.min(...t.sent.map((s) => Math.min(s.firstLedger, s.lastLedgerSequence)));
          const taker = await io.txWithSequence(req.account, seq, { min: floor, max: lls });
          if (taker && t.sent.some((s) => s.hash === taker.hash)) return taker; // ours (its tx lookup lagged)
          if (taker) return "dead"; // another tx used S: none of ours can ever apply
        }
        if (++incomplete > MAX_INCOMPLETE_HISTORY_POLLS) {
          throw unknown(at === undefined ? "server can't show the account at the LastLedgerSequence ledger; check the hash" : "Sequence used but the tx isn't in the account history yet; check the hash");
        }
      }
    } catch (e) {
      if (e instanceof XrplTxError) throw e;
      if (isConnectionError(e)) {
        if (++connErrors > MAX_CONN_ERRORS) throw new XrplTxError(req.txType, "connection_lost", last(), { detail: "outcome unknown; check the hash", cause: redactedCause(e) });
        await io.reconnect();
      } else if (isTransientRpcError(e) && ++busy <= MAX_BUSY_POLLS) {
        await io.sleep(1000); // tooBusy / noNetwork …: says nothing about the tx, ask again later
      } else {
        throw unknown("could not look the tx up; check the hash", e);
      }
      seen = 0; // look again right away
    }
  }
}

/**
 * R4: once the account is dirty and nothing of it may still apply (no ticket issuing or in flight), re-read the
 * counter from the ledger and re-sign the parked tickets in arrival order, all under the mutex. Detached from the
 * caller's lock context; state changes happen before any callback runs.
 */
function maybeResync(p: AccountPipe, trigger: Ticket): void {
  if (!p.dirty || p.resyncing || p.live() > 0) return;
  if (![...p.tickets].some((x) => x.state === "parked")) {
    // Nothing to re-sign: forget the counter, the next issue re-reads it under the mutex.
    const reason = p.dirty;
    p.dirty = undefined;
    p.nextSeq = undefined;
    p.wake();
    emit(() => trigger.opts.onPipeline?.({ kind: "resync", account: p.account, reason, resign: 0 }));
    return;
  }
  p.resyncing = true;
  const run = async () => {
    try {
      await lockAccount(p.account, async () => {
        const reason = p.dirty ?? "";
        const parked = [...p.tickets].filter((x) => x.state === "parked").sort((a, b) => a.id - b.id);
        p.dirty = undefined;
        p.nextSeq = undefined;
        try {
          p.nextSeq = await trigger.io.nextSequence(p.account);
        } catch {
          // issue() reads it again (with its own connection handling)
        }
        const next = p.nextSeq;
        emit(() => trigger.opts.onPipeline?.({ kind: "resync", account: p.account, reason, ...(next !== undefined ? { nextSequence: next } : {}), resign: parked.length }));
        for (const x of parked) {
          if (p.dirty) break; // a re-sign hit a new anomaly: the rest wait for the next round
          const cur = x.cur;
          if (cur) emit(() => x.opts.onRetry?.({ attempt: x.attempts, reason: `resync (${reason})`, hash: cur.hash, action: "new_seq" }));
          try {
            await issue(p, x);
          } catch (e) {
            x.error = e;
            x.state = "done";
          }
          p.wake();
        }
      });
    } catch {
      // lockAccount only rethrows fn's errors, and fn catches its own
    } finally {
      p.resyncing = false;
      p.wake();
      maybeResync(p, trigger);
    }
  };
  held.exit(() => void run());
}
