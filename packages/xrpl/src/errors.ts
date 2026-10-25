// Typed ledger errors + mapping to the shared HTTP `ErrorCode` (docs/05-api.md §1) and the shared LedgerPort
// `LedgerError` / `TooSoonError`. Pure (no network).
import { explorerTxUrl, LedgerError, TooSoonError, type ErrorCode } from "@xrlp/shared";

/** @deprecated Use `ErrorCode` from `@xrlp/shared` (same union). */
export type ApiErrorCode = ErrorCode;

export interface XrplTxErrorOptions {
  /** True when the same intent may succeed if re-prepared and resubmitted (nothing was applied on-ledger). */
  retriable?: boolean;
  /** Extra detail appended to the message (e.g. rippled's engine_result_message). */
  detail?: string;
  cause?: unknown;
  /** True when no blob of this intent was ever handed to a server (failed before the first submit request). */
  notSent?: boolean;
}

export class XrplTxError extends Error {
  readonly explorerUrl?: string;
  readonly retriable: boolean;
  /** No blob of this intent ever left the process (see XrplTxErrorOptions.notSent). */
  readonly notSent: boolean;

  constructor(
    public readonly txType: string,
    /** Engine result (`tecTOO_SOON`, `tefPAST_SEQ`, …) or an RPC/network error string. */
    public readonly engineResult: string,
    public readonly hash?: string,
    opts: XrplTxErrorOptions = {},
  ) {
    super(
      `${txType} failed: ${engineResult}${opts.detail ? ` — ${opts.detail}` : ""}${hash ? ` (${explorerTxUrl(hash)})` : ""}`,
      opts.cause !== undefined ? { cause: opts.cause } : undefined,
    );
    this.name = "XrplTxError";
    this.retriable = opts.retriable ?? false;
    this.notSent = opts.notSent ?? false;
    if (hash) this.explorerUrl = explorerTxUrl(hash);
  }

  /** True when the tx is in a validated ledger (tec*): fee was claimed, state did not change. */
  get onLedger(): boolean {
    return this.engineResult.startsWith("tec") && !!this.hash;
  }
}

// ── secret redaction (security review M3) ──────────────────────────────────────────────────
// xrpl.js errors carry the request: a `submit` TimeoutError's message is `Timeout for request: {"command":"submit",
// "tx_blob":"…"}` and a RippledError's `data.request.tx_blob` echoes it. For an EscrowFinish that blob holds the
// fulfillment. Errors kept as `cause` (and printed by `console.error(e)`) go through `redactedCause` first.

/** Hex runs at least this long are signed blobs or fulfillments (a 32-byte fulfillment is 72 hex); tx hashes (64) stay readable. */
const LONG_HEX = /[0-9A-Fa-f]{72,}/g;
const SECRET_KEYS = /^(tx_blob|blob|fulfillment|preimage|seed|secret|master_seed|master_key|private_?key)$/i;

/** `s` with every long hex run (signed blob, fulfillment) replaced by `[redacted N hex]`. */
export function redactSecrets(s: string): string {
  return s.replace(LONG_HEX, (m) => `[redacted ${m.length} hex]`);
}

function redactDeep(v: unknown, depth = 0): unknown {
  if (typeof v === "string") return redactSecrets(v);
  if (!v || typeof v !== "object" || depth > 8) return v;
  if (Array.isArray(v)) return v.map((x) => redactDeep(x, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) out[k] = SECRET_KEYS.test(k) ? "[redacted]" : redactDeep(x, depth + 1);
  return out;
}

/**
 * A copy of `e` that is safe to keep as a `cause` or to log: same name, message and stack with long hex runs redacted,
 * and `data` (xrpl.js errors) with `tx_blob` / `Fulfillment` / `seed` / … fields replaced. Classify the original first.
 */
export function redactedCause(e: unknown): Error {
  const src = e instanceof Error ? e : new Error(String(e));
  const out = new Error(redactSecrets(src.message));
  out.name = src.name;
  if (src.stack) out.stack = redactSecrets(src.stack);
  const data = (e as { data?: unknown } | null)?.data;
  if (data !== undefined) (out as Error & { data?: unknown }).data = redactDeep(data);
  return out;
}

/** xrpl.js errors (`XrplError`: RippledError, TimeoutError, …) carry `data` that may echo a signed blob. */
const carriesRequest = (e: unknown): boolean => !!e && typeof e === "object" && "data" in e && !(e instanceof XrplTxError) && !(e instanceof LedgerError);

/** `e` as a cause: raw xrpl.js errors (they echo the request) redacted; this package's errors and plain values as is. */
export function safeCause(e: unknown): unknown {
  if (carriesRequest(e)) return redactedCause(e);
  return typeof e === "string" ? redactSecrets(e) : e;
}

const NOT_FOUND_RESULTS = new Set(["tecNO_ENTRY", "tecNO_TARGET", "tecNO_DST", "tecOBJECT_NOT_FOUND", "tecNO_LINE"]);
const NOT_FOUND_RPC = new Set(["entryNotFound", "actNotFound", "txnNotFound", "objectNotFound"]);

/**
 * A pre-reveal refusal from this package (`UnsafeReleaseError`, a refused `PreflightResult`, or an
 * `unsafeReleaseError()` body), detected by shape so errors.ts doesn't import preflight.ts (import cycle via client.ts).
 */
function isUnsafeRelease(e: unknown): boolean {
  const o = e as { code?: unknown; ok?: unknown; error?: { code?: unknown } } | null;
  return !!o && typeof o === "object" && (o.code === "unsafe_release" || o.error?.code === "unsafe_release");
}

/** Map any error from this package to the shared `ErrorCode`. Default `ledger_error`. */
export function toErrorCode(e: unknown): ErrorCode {
  if (e instanceof LedgerError) return e.code;
  if (isUnsafeRelease(e)) return "unsafe_release";
  if (e instanceof XrplTxError) {
    const r = e.engineResult;
    if (r === "tecTOO_SOON") return "too_soon";
    if (NOT_FOUND_RESULTS.has(r)) return "not_found";
    if (r.startsWith("tem")) return "validation";
    return "ledger_error";
  }
  const rpc = (e as { data?: { error?: string } })?.data?.error;
  if (rpc && NOT_FOUND_RPC.has(rpc)) return "not_found";
  return "ledger_error";
}

/**
 * Convert anything this package throws into the shared LedgerPort error (what the adapter must throw):
 *  - a `LedgerError` (incl. `TooSoonError` and preflight's `UnsafeReleaseError`) is returned as is;
 *  - `XrplTxError` tecTOO_SOON → `TooSoonError`; any other XrplTxError → `LedgerError("ledger_error")`,
 *    both carrying `txResult` (engine result) and `txHash` (when the tx reached a ledger);
 *  - a refused preflight (`PreflightResult` / `unsafeReleaseError()` body) → `LedgerError("unsafe_release")`;
 *  - anything else → `LedgerError("ledger_error")` with the original message.
 * The original error is kept as `cause`. Not-found / validation results stay `ledger_error` here (LedgerError has no
 * such codes); use `toErrorCode(e.cause)` if you need the finer HTTP code.
 */
export function toLedgerError(e: unknown): LedgerError {
  if (e instanceof LedgerError) return e;
  let out: LedgerError;
  if (e instanceof XrplTxError) {
    const opts = { txResult: e.engineResult, ...(e.hash ? { txHash: e.hash } : {}) };
    out = e.engineResult === "tecTOO_SOON" ? new TooSoonError(e.message, opts) : new LedgerError("ledger_error", e.message, opts);
  } else if (isUnsafeRelease(e)) {
    const o = e as { message?: unknown; error?: { message?: unknown } };
    const msg = typeof o.message === "string" ? o.message : typeof o.error?.message === "string" ? o.error.message : "pre-reveal safety refused the finish";
    out = new LedgerError("unsafe_release", msg);
  } else {
    out = new LedgerError("ledger_error", redactSecrets(e instanceof Error ? e.message : String(e)));
  }
  out.cause = safeCause(e);
  return out;
}

/** Run `fn`, rethrowing any failure as a shared `LedgerError` (see `toLedgerError`). For LedgerPort adapter methods. */
export async function withLedgerErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw toLedgerError(e);
  }
}
