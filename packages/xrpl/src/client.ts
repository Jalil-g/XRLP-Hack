// Connection + submit helpers. One shared Client per process.
// Submission is hardened (XRPL-12): per-account lock, LastLedgerSequence always set, bounded retries. See submit.ts.
import https from "node:https";
import { Client, type SubmittableTransaction, type Wallet } from "xrpl";
import { explorerTxUrl } from "@xrlp/shared";
import { config } from "./config.ts";
import { XrplTxError } from "./errors.ts";
import { describeBlob, submitReliably, withAccountLock, type LedgerIo, type Lookup, type ResignMode, type RetryPolicy, type ValidatedTx } from "./submit.ts";

export { XrplTxError, toErrorCode } from "./errors.ts";
export type { ApiErrorCode, XrplTxErrorOptions } from "./errors.ts";
export { withAccountLock } from "./submit.ts";

export interface TxResult {
  hash: string;
  explorerUrl: string;
  /** Engine result, e.g. "tesSUCCESS". */
  result: string;
  ledgerIndex?: number;
  /** Validated tx JSON as returned by rippled. */
  tx: Record<string, unknown>;
  meta: Record<string, unknown>;
}

/**
 * Ledgers between "now" (latest validated) and a tx's LastLedgerSequence. xrpl.js autofill uses 20 (~60-80s on devnet).
 * Override per call with `{ lastLedgerMargin }` (e.g. 60+ for EscrowFinish) or globally with XRPL_LLS_MARGIN.
 */
export const DEFAULT_LLS_MARGIN = Number(process.env.XRPL_LLS_MARGIN ?? 20);

export interface SubmitOptions extends RetryPolicy {
  /** LastLedgerSequence = validated index + margin. Default DEFAULT_LLS_MARGIN. Ignored if the tx sets LastLedgerSequence. */
  lastLedgerMargin?: number;
  /** Multisig: number of signers, so autofill charges the right Fee. */
  signersCount?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

let shared: Client | undefined;
let connecting: Promise<Client> | undefined;

function proxyAgent(): https.Agent | undefined {
  // Node >= 24.5 understands proxyEnv; lets the websocket go through HTTPS_PROXY in sandboxes / corp nets.
  if (!process.env.HTTPS_PROXY && !process.env.https_proxy) return undefined;
  return new https.Agent({ proxyEnv: process.env } as https.AgentOptions);
}

/** Get (and lazily connect) the shared devnet client. */
export async function getClient(): Promise<Client> {
  if (shared?.isConnected()) return shared;
  if (connecting) return connecting;
  connecting = (async () => {
    const agent = proxyAgent();
    const client = new Client(config.wsUrl, { connectionTimeout: 20_000, ...(agent ? { agent } : {}) } as never);
    await client.connect();
    shared = client;
    return client;
  })();
  try {
    return await connecting;
  } finally {
    connecting = undefined;
  }
}

export async function disconnect(): Promise<void> {
  if (shared?.isConnected()) await shared.disconnect();
  shared = undefined;
}

/**
 * Restore the shared connection after a websocket failure. xrpl.js auto-reconnects on unexpected closes,
 * so give it a few seconds first; then drop the old client and dial a fresh one.
 */
export async function reconnect(): Promise<Client> {
  for (let i = 0; i < 10 && shared && !shared.isConnected(); i++) await sleep(500);
  if (shared?.isConnected()) return shared;
  const old = shared;
  shared = undefined;
  if (old) await old.disconnect().catch(() => undefined);
  return getClient();
}

const rpcError = (e: unknown) => (e as { data?: { error?: string; searched_all?: boolean } })?.data;

/** The real `LedgerIo` for submit.ts: shared client, re-fetched per call so a reconnect is picked up. */
export const realLedgerIo: LedgerIo = {
  async submit(blob) {
    const client = await getClient();
    const res = await client.request({ command: "submit", tx_blob: blob });
    return { engineResult: res.result.engine_result, message: res.result.engine_result_message };
  },
  async lookup(hash, range): Promise<Lookup> {
    const client = await getClient();
    try {
      const res = await client.request({
        command: "tx",
        transaction: hash,
        ...(range ? { min_ledger: range.min, max_ledger: range.max } : {}),
      });
      const r = res.result as unknown as Record<string, unknown>;
      return r.validated ? { status: "validated", result: r } : { status: "pending" };
    } catch (e) {
      const d = rpcError(e);
      if (d?.error === "txnNotFound") return { status: "missing", searchedAll: d.searched_all === true };
      throw e;
    }
  },
  async validatedLedgerIndex() {
    return (await getClient()).getLedgerIndex();
  },
  async reconnect() {
    await reconnect();
  },
  sleep,
};

function toResult(r: ValidatedTx): TxResult {
  const meta = (r.meta ?? {}) as Record<string, unknown>;
  const result = typeof meta === "object" && meta && "TransactionResult" in meta ? String(meta.TransactionResult) : "unknown";
  const txJson = (r.tx_json ?? r) as Record<string, unknown>;
  const hash = String(r.hash ?? txJson.hash);
  return {
    hash,
    explorerUrl: explorerTxUrl(hash),
    result,
    ledgerIndex: r.ledger_index as number | undefined,
    tx: txJson,
    meta,
  };
}

/** Optional retry log: XRPL_SUBMIT_LOG=1 prints every retry decision. */
function withLog(opts: SubmitOptions): SubmitOptions {
  if (opts.onRetry || !process.env.XRPL_SUBMIT_LOG) return opts;
  return { ...opts, onRetry: (e) => console.warn(`  ↻ retry #${e.attempt} ${e.reason} → ${e.action} (${explorerTxUrl(e.hash)})`) };
}

/**
 * Submit an already-signed blob and wait for validation. Throws XrplTxError unless tesSUCCESS.
 * Locked per `Account` (re-entrant). Retries only by resubmitting the same blob; if the tx needs re-preparing
 * (expired LastLedgerSequence, sequence taken) it throws with `retriable: true`. To make autofill→sign→submitBlob
 * race-free against other submits from the same account, wrap the whole thing in `withAccountLock(account, …)`.
 */
export async function submitBlob(txBlob: string, txType = "tx", opts: SubmitOptions = {}): Promise<TxResult> {
  const first = describeBlob(txBlob, txType);
  return withAccountLock(first.account, async () => toResult(await submitReliably(first, realLedgerIo, withLog(opts))));
}

/**
 * Autofill (LastLedgerSequence = validated + margin), sign with `sign`, submit, wait — holding the `account` lock
 * the whole time, re-preparing on transient failures. Use for multisig: prepare with `SigningPubKey: ""`,
 * `signersCount`, and a `sign` that combines the signers' blobs.
 */
export async function submitWithSigner<T extends SubmittableTransaction>(
  account: string,
  tx: T,
  sign: (prepared: T) => string,
  opts: SubmitOptions = {},
): Promise<TxResult> {
  const margin = opts.lastLedgerMargin ?? DEFAULT_LLS_MARGIN;
  return withAccountLock(account, async () => {
    let lastSeq: number | undefined;
    const prepare = async (mode: "first" | ResignMode) => {
      const client = await getClient();
      const base: T = { ...tx, Account: account };
      if (mode !== "first") {
        if (tx.Fee === undefined) delete base.Fee;
        delete base.LastLedgerSequence;
        if (mode === "same_seq" && lastSeq !== undefined) base.Sequence = lastSeq;
        else delete base.Sequence;
      }
      if (base.LastLedgerSequence === undefined) base.LastLedgerSequence = (await client.getLedgerIndex()) + margin;
      const prepared = await client.autofill(base, opts.signersCount);
      lastSeq = prepared.Sequence;
      return describeBlob(sign(prepared), tx.TransactionType);
    };
    const first = await prepare("first");
    return toResult(await submitReliably(first, realLedgerIo, { ...withLog(opts), resign: prepare }));
  });
}

/** Autofill, single-sign with `wallet`, submit, wait (per-account locked, retried). */
export async function signAndSubmit<T extends SubmittableTransaction>(wallet: Wallet, tx: T, opts: SubmitOptions = {}): Promise<TxResult> {
  return submitWithSigner(tx.Account ?? wallet.classicAddress, tx, (p) => wallet.sign(p).tx_blob, opts);
}

/** Close time of the latest validated ledger, in Ripple epoch seconds. Use this, not the local clock. */
export async function ledgerTime(): Promise<number> {
  const client = await getClient();
  const res = await client.request({ command: "ledger", ledger_index: "validated" });
  return res.result.ledger.close_time;
}

/** Wait until the validated ledger close time is strictly greater than `rippleTime`. */
export async function waitForLedgerTimeAfter(rippleTime: number, onTick?: (remaining: number) => void): Promise<void> {
  for (;;) {
    const now = await ledgerTime();
    if (now > rippleTime) return;
    const remaining = rippleTime - now;
    onTick?.(remaining);
    await sleep(Math.min(Math.max(remaining * 1000, 2000), 10_000));
  }
}

/** Fetch a ledger entry by index (object ID). Returns undefined if not found. */
export async function getLedgerEntry<T = Record<string, unknown>>(index: string): Promise<T | undefined> {
  const client = await getClient();
  try {
    const res = await client.request({ command: "ledger_entry", index, ledger_index: "validated" });
    return res.result.node as T;
  } catch (e) {
    if (isNotFound(e)) return undefined;
    throw e;
  }
}

/** True for rippled "not found" errors (entryNotFound / actNotFound). */
export function isNotFound(e: unknown): boolean {
  const code = (e as { data?: { error?: string } })?.data?.error;
  return code === "entryNotFound" || code === "actNotFound" || /not found/i.test(String((e as Error)?.message));
}

/** Find the object ID created by a tx of the given ledger entry type (from metadata). */
export function createdNodeId(result: TxResult, ledgerEntryType: string): string | undefined {
  const nodes = (result.meta.AffectedNodes ?? []) as Array<Record<string, { LedgerEntryType?: string; LedgerIndex?: string }>>;
  for (const n of nodes) {
    const c = n.CreatedNode;
    if (c?.LedgerEntryType === ledgerEntryType) return c.LedgerIndex;
  }
  return undefined;
}
