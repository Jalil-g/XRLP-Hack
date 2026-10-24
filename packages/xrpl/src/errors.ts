// Typed ledger errors + mapping to the HTTP ErrorCode of docs/05-api.md §1. Pure (no network).
import { explorerTxUrl } from "@xrlp/shared";

/** docs/05-api.md §1 `ErrorCode` (not in @xrlp/shared yet). */
export type ApiErrorCode =
  | "not_found"
  | "invalid_state"
  | "validation"
  | "checks_failed"
  | "needs_human"
  | "too_soon"
  | "ledger_error"
  | "verifier_error"
  | "unsafe_release";

export interface XrplTxErrorOptions {
  /** True when the same intent may succeed if re-prepared and resubmitted (nothing was applied on-ledger). */
  retriable?: boolean;
  /** Extra detail appended to the message (e.g. rippled's engine_result_message). */
  detail?: string;
  cause?: unknown;
}

export class XrplTxError extends Error {
  readonly explorerUrl?: string;
  readonly retriable: boolean;

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
    if (hash) this.explorerUrl = explorerTxUrl(hash);
  }

  /** True when the tx is in a validated ledger (tec*): fee was claimed, state did not change. */
  get onLedger(): boolean {
    return this.engineResult.startsWith("tec") && !!this.hash;
  }
}

const NOT_FOUND_RESULTS = new Set(["tecNO_ENTRY", "tecNO_TARGET", "tecNO_DST", "tecOBJECT_NOT_FOUND", "tecNO_LINE"]);

/** Map any error from this package to the API `ErrorCode`. Default `ledger_error`. */
export function toErrorCode(e: unknown): ApiErrorCode {
  if (e instanceof XrplTxError) {
    const r = e.engineResult;
    if (r === "tecTOO_SOON") return "too_soon";
    if (NOT_FOUND_RESULTS.has(r)) return "not_found";
    if (r.startsWith("tem")) return "validation";
    return "ledger_error";
  }
  const rpc = (e as { data?: { error?: string } })?.data?.error;
  if (rpc === "entryNotFound" || rpc === "actNotFound" || rpc === "txnNotFound" || rpc === "objectNotFound") return "not_found";
  return "ledger_error";
}
