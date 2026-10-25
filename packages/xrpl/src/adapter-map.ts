// XRPL-10 pure helpers for XrplLedgerAdapter (src/adapter.ts): package results -> shared LedgerPort shapes, error
// mapping, SPV signer choice. No network: unit-tested offline (test/adapter.test.ts).
import { LedgerError, TooSoonError, type ChainEventKind, type ErrorCode, type TxResult as PortTxResult } from "@xrlp/shared";
import { rippleTimeToISOTime } from "xrpl";
import type { TxResult } from "./client.ts";
import { toErrorCode, toLedgerError, XrplTxError } from "./errors.ts";
import { LoanPayAmountError } from "./loan.ts";
import { CloseValidationError } from "./loan-close.ts";

// ---------------------------------------------------------------- tx results

/** Our validated TxResult -> shared TxResult (+ suggested ChainEvent kind, + ledger close time when rippled sent it). */
export function toPortTx(tx: TxResult, kind?: ChainEventKind): PortTxResult {
  const date = tx.tx?.date;
  return {
    hash: tx.hash,
    explorerUrl: tx.explorerUrl,
    result: tx.result,
    ...(kind ? { kind } : {}),
    ...(typeof date === "number" ? { at: rippleTimeToISOTime(date) } : {}),
  };
}

// ---------------------------------------------------------------- errors

/**
 * Shared `LedgerError` whose `apiCode` is the full API ErrorCode (docs/05-api.md §1). `code` stays inside the shared
 * contract's union (`too_soon | ledger_error | unsafe_release`); `not_found` / `validation` ride on `apiCode` only.
 * TODO(#53): widen shared LedgerError.code to include not_found / validation, then drop `apiCode`.
 */
export class XrplLedgerError extends LedgerError {
  readonly apiCode: ErrorCode;
  /** PreflightReason for unsafe_release, rippled engine result otherwise. */
  readonly reason?: string;
  constructor(apiCode: ErrorCode, message: string, opts: { txResult?: string; txHash?: string; reason?: string; cause?: unknown } = {}) {
    super(apiCode === "too_soon" || apiCode === "unsafe_release" ? apiCode : "ledger_error", message, opts);
    this.name = "XrplLedgerError";
    this.apiCode = apiCode;
    if (opts.reason) this.reason = opts.reason;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

/** API ErrorCode of anything the adapter may throw (shared LedgerError, XrplLedgerError, or a raw package error). */
export function apiCodeOf(e: unknown): ErrorCode {
  if (e instanceof XrplLedgerError) return e.apiCode;
  if (e instanceof LedgerError) return e.code;
  return apiCodeOf(toAdapterError(e));
}

/** Plain `Error`s this package throws for bad input before any tx (lending-math, api.ts, compliance.ts, attest.ts). */
const VALIDATION_MESSAGE =
  /must be|must fit|missing condition|missing spv|not in the future|protocol minimum|too early for|duplicate|invalid|malformed|no demo wallet|does not match escrow condition|not a PREIMAGE|attest memo|expected .* got/i;

const rpcErrorOf = (e: unknown): string | undefined => (e as { data?: { error?: string } } | null)?.data?.error;

/**
 * API ErrorCode of a raw package error: the client-side input refusals (`CloseValidationError`, `LoanPayAmountError`)
 * are `validation`; then errors.ts `toErrorCode` (engine results, rippled not-found RPC errors, refused preflights);
 * a plain Error whose message reads as bad input is `validation`; anything else `ledger_error`.
 */
function packageErrorCode(e: unknown): ErrorCode {
  if (e instanceof CloseValidationError || e instanceof LoanPayAmountError) return "validation";
  const code = toErrorCode(e);
  if (code !== "ledger_error" || e instanceof XrplTxError || rpcErrorOf(e)) return code;
  return VALIDATION_MESSAGE.test(e instanceof Error ? e.message : String(e)) ? "validation" : "ledger_error";
}

/**
 * Map any error from this package to what the adapter throws. Shared `LedgerError`s pass through unchanged
 * (`TooSoonError`, preflight's `UnsafeReleaseError`, `CloseLoanPartialError` (ledger_error, keeps loanId / created /
 * pending), `XrplLedgerError`). Anything else goes through errors.ts `toLedgerError` (tecTOO_SOON -> `TooSoonError`;
 * txResult / txHash kept) and becomes an `XrplLedgerError` carrying the finer `apiCode`. The original is the `cause`.
 */
export function toAdapterError(e: unknown, context?: string): LedgerError {
  if (e instanceof LedgerError) return e;
  const shared = toLedgerError(e);
  const message = `${context ? `${context}: ` : ""}${shared.message}`;
  const txResult = shared.txResult ?? rpcErrorOf(e);
  const opts = { ...(txResult ? { txResult } : {}), ...(shared.txHash ? { txHash: shared.txHash } : {}) };
  if (shared instanceof TooSoonError) {
    const t = new TooSoonError(message, opts);
    t.cause = e;
    return t;
  }
  const apiCode = packageErrorCode(e);
  // A refused PreflightResult / unsafeReleaseError() body carries its PreflightReason.
  const o = e as { reason?: unknown; error?: { reason?: unknown } } | null;
  const reason = apiCode === "unsafe_release" ? (o?.reason ?? o?.error?.reason) : undefined;
  return new XrplLedgerError(apiCode, message, { ...opts, ...(typeof reason === "string" ? { reason } : {}), cause: e });
}

// ---------------------------------------------------------------- which key may sign what (security review M4)

const INVESTORS = ["investor1", "investor2", "investor3"] as const;
const INSPECTORS = ["inspector1", "inspector2", "inspector3"] as const;

/**
 * Demo roles whose key may sign for each adapter input. Core passes addresses (some straight from HTTP, e.g.
 * registerInvestor), and the store holds every demo key: without this an "investor" equal to the issuer's address
 * would make the issuer sign a VaultDeposit of freshly minted RLUSD.
 */
export const SIGNING_ROLES = {
  investor: INVESTORS,
  builder: ["builder"],
  KYC_INVESTOR: INVESTORS,
  VERIFIED_BUILDER: ["builder"],
  VERIFIED_INSPECTOR: INSPECTORS,
  /** shared `AttestSigner`: platform-held attestation keys. */
  attest: ["aiAgent", "platform", "releaseService"],
} as const;

/** Keys never picked as SPV multisig signers (security review M6), even if an on-ledger list named them. */
export const NEVER_SPV_SIGNERS = ["aiAgent", "releaseService", "issuer"] as const;

/** The store's wallets that may countersign for an SPV: every role but NEVER_SPV_SIGNERS. Pure. */
export function spvSignerCandidates<W>(wallets: Record<string, W>): W[] {
  return Object.entries(wallets).flatMap(([role, w]) => ((NEVER_SPV_SIGNERS as readonly string[]).includes(role) ? [] : [w]));
}

/**
 * The wallet of one of `allowed` roles whose address is `address`. An address that belongs to another role → validation
 * error naming it ("refusing to sign as investor"); an unknown address → validation error. Nothing is signed either way.
 */
export function keyForRole<W extends { classicAddress: string }>(wallets: Record<string, W>, address: string, allowed: readonly string[], label: string, store = "the wallet store"): W {
  for (const role of allowed) if (wallets[role]?.classicAddress === address) return wallets[role]!;
  const other = Object.entries(wallets).find(([, w]) => w.classicAddress === address)?.[0];
  if (other) throw new XrplLedgerError("validation", `${label} ${address} is the demo ${other} key; refusing to sign as ${label} (allowed roles: ${allowed.join(", ")})`);
  throw new XrplLedgerError("validation", `no key for ${label} ${address} in ${store} (devnet demo: every signing account must be a bootstrapped wallet)`);
}

// ---------------------------------------------------------------- SPV signers

/**
 * Pick SPV multisig signers we hold keys for, reaching `quorum` from the ON-LEDGER signer list. `prefer` first (e.g. the
 * project's builder, platform, trustee), then the rest in list order. Throws if the keys we hold cannot reach quorum.
 */
export function pickQuorumSigners<W extends { classicAddress: string }>(
  list: { quorum: number; signers: { account: string; weight: number }[] },
  held: (address: string) => W | undefined,
  prefer: string[] = [],
): W[] {
  const rank = (a: string) => {
    const i = prefer.indexOf(a);
    return i < 0 ? prefer.length : i;
  };
  const ordered = [...list.signers].map((s, i) => ({ ...s, i })).sort((a, b) => rank(a.account) - rank(b.account) || a.i - b.i);
  const out: W[] = [];
  let weight = 0;
  for (const s of ordered) {
    if (weight >= list.quorum) break;
    const w = held(s.account);
    if (!w) continue;
    out.push(w);
    weight += s.weight;
  }
  if (weight < list.quorum) {
    throw new XrplLedgerError(
      "validation",
      `SPV quorum ${list.quorum} not reachable with held keys (have weight ${weight} from ${out.map((w) => w.classicAddress).join(", ") || "none"}; list ${list.signers.map((s) => s.account).join(", ")})`,
    );
  }
  return out;
}
