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
//  - tec* / tem* / other tef* are final; never retried.
//  - `retriable: true` only when no blob of the intent can still apply. Anything else whose outcome isn't known is
//    `unknown_outcome` / `connection_lost` (non-retriable): the caller must look the hash up, not re-run.
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
export async function submitReliably(first: SignedBlob, io: LedgerIo, opts: RetryPolicy & { resign?: Resign } = {}): Promise<ValidatedTx> {
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

  const fail = (code: string, retriable: boolean, opt: { hash?: string; detail?: string; cause?: unknown } = {}) =>
    new XrplTxError(cur.txType, redactSecrets(code), opt.hash, {
      retriable,
      ...(opt.detail ? { detail: opt.detail } : {}),
      ...(opt.cause !== undefined ? { cause: redactedCause(opt.cause) } : {}),
    });

  /** Hashes of this intent that may still apply, oldest first (for "check the hash" messages). */
  const unsettled = () => [...new Set([...live.keys(), cur.hash])];
  const lost = (e: unknown) => fail("connection_lost", false, { hash: cur.hash, detail: `outcome unknown; check ${unsettled().join(", ")}`, cause: e });

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

  for (let attempt = 1; ; attempt++) {
    let prelim: string;
    let detail: string | undefined;
    let sending = false;
    try {
      const minLedger = (await io.validatedLedgerIndex()) + 1;
      if (!firstLedger.has(cur.hash)) firstLedger.set(cur.hash, minLedger);
      sending = true; // from here on the blob may reach a server
      const r = await io.submit(cur.blob);
      prelim = r.engineResult;
      detail = r.message;
    } catch (e) {
      if (isConnectionError(e)) {
        if (sending) live.set(cur.hash, cur);
        await onConnError(e);
        prelim = "connection_lost";
      } else if (isTransientRpcError(e)) {
        prelim = String((e as { data: { error: string } }).data.error);
      } else {
        // Refused by the RPC layer. An earlier attempt of this intent may still apply: settle it before saying "failed".
        const won = await settle();
        if (won) return won;
        throw fail(String((e as { data?: { error?: string } })?.data?.error ?? (e instanceof Error ? e.message : e)), false, { cause: e });
      }
    }

    let next: RetryEvent["action"];
    const cls: PreliminaryClass | "conn" | "busy" =
      prelim === "connection_lost" ? "conn" : isTransientRpcError({ data: { error: prelim } }) ? "busy" : classifyPreliminary(prelim);

    if (cls === "fatal") {
      const won = await settle(); // this blob was refused; an earlier one may still apply
      if (won) return won;
      throw fail(prelim, false, detail ? { detail } : {});
    }

    // tefPAST_SEQ: maybe this very blob took the Sequence (an earlier call submitted it, or a server held it). Ask first.
    const own = cls === "past_seq" && !live.has(cur.hash) ? await peek(cur.hash) : undefined;
    if (cls === "pending" || (cls === "past_seq" && (live.has(cur.hash) || own !== "missing"))) {
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
