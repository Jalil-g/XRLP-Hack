// Submission hardening (XRPL-12): per-account lock, result classification, bounded retries.
// Network-free: the ledger is reached through an injected `LedgerIo` (real one lives in client.ts),
// so every retry path is unit-tested offline (test/submit.test.ts).
//
// Safety rules:
//  - Resubmitting the SAME signed blob is always safe (same hash can apply at most once).
//  - A NEW blob is only built when the previous one provably cannot apply:
//      tel* (not applied, not relayed) or LastLedgerSequence passed with no hit in a fully-searched range
//        → re-sign with the SAME Sequence (mutually exclusive with the old blob, so never a double-apply);
//      tefPAST_SEQ on a blob that never reached the ledger → re-sign with a fresh Sequence.
//  - tec* / tem* / other tef* are final; never retried.
import { AsyncLocalStorage } from "node:async_hooks";
import { ConnectionError, decode, hashes } from "xrpl";
import { XrplTxError } from "./errors.ts";

// ── Per-account async mutex ────────────────────────────────────────────────────────────────

const tails = new Map<string, Promise<void>>();
const held = new AsyncLocalStorage<ReadonlySet<string>>();

/**
 * Run `fn` while holding the lock for `account` (FIFO). Re-entrant within the same async call chain,
 * so a caller can wrap autofill→sign→`submitBlob` (which locks again) without deadlocking.
 * Do not fan out (Promise.all) txs for the same account *inside* the lock: re-entrant calls are not serialised.
 */
export async function withAccountLock<T>(account: string, fn: () => Promise<T>): Promise<T> {
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
 *  - pending   wait for the validated outcome (tesSUCCESS, terQUEUED, tefALREADY, other ter*, tec*)
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

/** The ledger operations the engine needs. Real implementation: client.ts `realLedgerIo`. */
export interface LedgerIo {
  submit(blob: string): Promise<{ engineResult: string; message?: string }>;
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

/** Final validated `tx` result (has `meta.TransactionResult`, `hash`, `ledger_index`, `tx_json`). */
export type ValidatedTx = Record<string, unknown> & { hash?: string };

const MAX_CONN_ERRORS = 5;
const MAX_INCOMPLETE_HISTORY_POLLS = 10;

function finalResult(r: Record<string, unknown>): string {
  const meta = r.meta as { TransactionResult?: string } | undefined;
  return meta?.TransactionResult ?? "unknown";
}

/**
 * Submit `first`, wait for validation, retry transient failures. Returns the validated tx on tesSUCCESS.
 * Throws `XrplTxError` otherwise; `retriable` is true only when nothing was applied and a fresh attempt may work.
 * Without `resign` (pre-signed blobs) only same-blob resubmits are possible; anything needing a new blob throws retriable.
 */
export async function submitReliably(first: SignedBlob, io: LedgerIo, opts: RetryPolicy & { resign?: Resign } = {}): Promise<ValidatedTx> {
  // A replacement EscrowFinish needs a new escrow preflight, not just autofill.
  // Return control to finishEscrow, which owns that preflight, before re-signing.
  const resign = first.txType === "EscrowFinish" ? undefined : opts.resign;
  const maxAttempts = opts.maxAttempts ?? 5;
  const pollMs = opts.pollMs ?? 1000;
  const backoff0 = opts.backoffMs ?? 500;
  const maxWaitMs = opts.maxWaitMs ?? 120_000;
  let cur = first;
  /** Hashes that may have reached a server (submit returned pending, or the socket died mid-submit). */
  const maybeSent = new Set<string>();
  /** First ledger each hash could have landed in (validated index + 1 at its first submit). */
  const firstLedger = new Map<string, number>();
  let connErrors = 0;

  const fail = (code: string, retriable: boolean, opt: { hash?: string; detail?: string; cause?: unknown } = {}) =>
    new XrplTxError(cur.txType, code, opt.hash, { retriable, ...(opt.detail ? { detail: opt.detail } : {}), ...(opt.cause !== undefined ? { cause: opt.cause } : {}) });

  const onConnError = async (e: unknown) => {
    if (++connErrors > MAX_CONN_ERRORS) throw fail("connection_lost", false, { hash: cur.hash, detail: "outcome unknown; check the hash", cause: e });
    await io.reconnect();
  };

  /** Wait until `blob` is validated (→ result) or provably expired (→ "expired"). */
  const waitFinal = async (blob: SignedBlob, minLedger: number): Promise<ValidatedTx | "expired"> => {
    const started = Date.now();
    let incomplete = 0;
    for (;;) {
      try {
        const v = await io.validatedLedgerIndex();
        const lls = blob.lastLedgerSequence;
        const closedOut = lls !== undefined && v >= lls;
        const range = closedOut ? { min: Math.max(minLedger, lls - 999), max: lls } : undefined;
        const lk = await io.lookup(blob.hash, range);
        if (lk.status === "validated") return lk.result;
        if (closedOut && lk.status === "missing") {
          if (lk.searchedAll) return "expired";
          if (++incomplete > MAX_INCOMPLETE_HISTORY_POLLS)
            throw fail("unknown_outcome", false, { hash: blob.hash, detail: "server history incomplete; check the hash" });
        }
        if (lls === undefined && Date.now() - started > maxWaitMs)
          throw fail("unknown_outcome", false, { hash: blob.hash, detail: "no LastLedgerSequence; gave up waiting" });
      } catch (e) {
        if (e instanceof XrplTxError || !isConnectionError(e)) throw e;
        await onConnError(e);
      }
      await io.sleep(pollMs);
    }
  };

  for (let attempt = 1; ; attempt++) {
    let prelim: string;
    let detail: string | undefined;
    try {
      const minLedger = (await io.validatedLedgerIndex()) + 1;
      if (!firstLedger.has(cur.hash)) firstLedger.set(cur.hash, minLedger);
      const r = await io.submit(cur.blob);
      prelim = r.engineResult;
      detail = r.message;
    } catch (e) {
      if (isConnectionError(e)) {
        maybeSent.add(cur.hash);
        await onConnError(e);
        prelim = "connection_lost";
      } else if (isTransientRpcError(e)) {
        prelim = String((e as { data: { error: string } }).data.error);
      } else {
        throw fail(String((e as { data?: { error?: string } })?.data?.error ?? (e instanceof Error ? e.message : e)), false, { cause: e });
      }
    }

    let next: RetryEvent["action"];
    const cls: PreliminaryClass | "conn" | "busy" =
      prelim === "connection_lost" ? "conn" : isTransientRpcError({ data: { error: prelim } }) ? "busy" : classifyPreliminary(prelim);

    if (cls === "pending" || (maybeSent.has(cur.hash) && (cls !== "conn" || attempt >= maxAttempts))) {
      // Possibly applied: only the ledger can tell. Never build a new blob until this one is provably dead.
      if (cls === "pending") maybeSent.add(cur.hash);
      const out = await waitFinal(cur, Math.min(firstLedger.get(cur.hash) ?? 1, cur.lastLedgerSequence ?? Infinity));
      if (out !== "expired") {
        const res = finalResult(out);
        if (res === "tesSUCCESS") return out;
        throw fail(res, false, { hash: String(out.hash ?? cur.hash) });
      }
      maybeSent.delete(cur.hash);
      prelim = "tefMAX_LEDGER";
      next = "same_seq";
    } else if (cls === "fatal") {
      throw fail(prelim, false, detail ? { detail } : {});
    } else if (cls === "past_seq") {
      next = "new_seq"; // never reached a ledger and its Sequence is gone → cannot apply
    } else if (cls === "expired") {
      next = "same_seq";
    } else if (cls === "conn") {
      next = "resubmit_same_blob"; // same hash: idempotent, and lets tefALREADY/tefPAST_SEQ reveal an earlier apply
    } else {
      next = resign ? "same_seq" : "resubmit_same_blob"; // resubmit/busy: fresh Fee if we can re-sign
    }

    if (attempt >= maxAttempts) throw fail(prelim, true, { detail: `gave up after ${attempt} attempts` });
    if (next !== "resubmit_same_blob" && !resign) throw fail(prelim, true, { detail: "pre-signed blob must be re-prepared" });

    opts.onRetry?.({ attempt, reason: prelim, hash: cur.hash, action: next });
    await io.sleep(Math.min(backoff0 * 2 ** (attempt - 1), 4000));
    if (next !== "resubmit_same_blob") cur = await resign!(next);
  }
}
