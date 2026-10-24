// Connection + submit helpers. One shared Client per process.
import https from "node:https";
import { Client, type SubmittableTransaction, type TxResponse, type Wallet } from "xrpl";
import { explorerTxUrl } from "@xrlp/shared";
import { config } from "./config.ts";

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

export class XrplTxError extends Error {
  constructor(
    public readonly txType: string,
    public readonly engineResult: string,
    public readonly hash?: string,
  ) {
    super(`${txType} failed: ${engineResult}${hash ? ` (${explorerTxUrl(hash)})` : ""}`);
  }
}

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

function toResult(res: TxResponse): TxResult {
  const r = res.result as unknown as Record<string, unknown> & { hash: string; ledger_index?: number; meta?: unknown };
  const meta = (r.meta ?? {}) as Record<string, unknown>;
  const result = typeof meta === "object" && meta && "TransactionResult" in meta ? String(meta.TransactionResult) : "unknown";
  const txJson = (r.tx_json ?? r) as Record<string, unknown>;
  return {
    hash: r.hash,
    explorerUrl: explorerTxUrl(r.hash),
    result,
    ledgerIndex: r.ledger_index,
    tx: txJson,
    meta,
  };
}

/** Submit an already-signed blob and wait for validation. Throws XrplTxError unless tesSUCCESS. */
export async function submitBlob(txBlob: string, txType = "tx"): Promise<TxResult> {
  const client = await getClient();
  let res: TxResponse;
  try {
    res = await client.submitAndWait(txBlob);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const hash = (e as { data?: { tx_json?: { hash?: string } } })?.data?.tx_json?.hash;
    throw new XrplTxError(txType, msg, hash);
  }
  const out = toResult(res);
  if (out.result !== "tesSUCCESS") throw new XrplTxError(txType, out.result, out.hash);
  return out;
}

/** Autofill, single-sign with `wallet`, submit, wait. */
export async function signAndSubmit<T extends SubmittableTransaction>(wallet: Wallet, tx: T): Promise<TxResult> {
  const client = await getClient();
  const prepared = await client.autofill({ ...tx, Account: tx.Account ?? wallet.classicAddress });
  const signed = wallet.sign(prepared);
  return submitBlob(signed.tx_blob, tx.TransactionType);
}

/** Close time of the latest validated ledger, in Ripple epoch seconds. Use this, not the local clock. */
export async function ledgerTime(): Promise<number> {
  const client = await getClient();
  const res = await client.request({ command: "ledger", ledger_index: "validated" });
  return res.result.ledger.close_time;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
    if (String((e as Error)?.message).includes("entryNotFound")) return undefined;
    throw e;
  }
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
