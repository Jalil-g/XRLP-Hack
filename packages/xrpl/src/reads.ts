// XRPL-09 read models: vault, loan, escrow, balances. Each read is a PURE parser (raw rippled JSON → model,
// unit-tested on recorded devnet responses in test/fixtures/) plus a thin fetch that issues the requests
// against ONE validated ledger and hands the raw results to the parser.
//
// Conventions:
//  - "now" is the validated ledger close time (Ripple epoch s), never the local clock.
//  - rippled omits zero/default fields (e.g. Vault.AssetsAvailable, Loan.PaymentRemaining) → read as 0.
//  - RLUSD amounts are shared `Rlusd` strings: plain decimal, ≤ 6 decimals, truncated (never rounded up).
import type { Rlusd } from "@xrlp/shared";
import { rippleTimeToISOTime } from "xrpl";
import { getClient } from "./client.ts";
import { RLUSD_CURRENCY } from "./config.ts";
import type { LoanEntry } from "./loan.ts";
import { vaultPhase, type VaultLedgerEntry } from "./vault.ts";

// ---------------------------------------------------------------------------------------------------------
// Snapshot types. Mirror docs/05-api.md §2 exactly; not in @xrlp/shared yet — switch to the shared import
// once core adds them (contract change goes through issue #53).

export type VaultSnapshot = {
  assetsTotal: Rlusd;
  assetsAvailable: Rlusd;
  /** Raw share MPT units (MPTokenIssuance.OutstandingAmount), integer string. 1 whole share = 10^Scale units. */
  sharesOutstanding: string;
  /** RLUSD per whole share = assetsTotal / (sharesOutstanding / 10^Scale), ≤ 6 decimals. "1" when no shares. */
  sharePrice: string;
  subscriptionDate: string;
  redemptionDate: string;
  phase: "subscription" | "investment" | "redemption";
};

export type LoanSnapshot = {
  principalOutstanding: Rlusd;
  totalValueOutstanding: Rlusd;
  periodicPayment: Rlusd;
  paymentRemaining: number;
  /** ISO; "" once no payment remains (rippled drops NextPaymentDueDate when the loan is paid off). */
  nextPaymentDueDate: string;
};

// ---------------------------------------------------------------------------------------------------------
// Raw response plumbing

type Json = Record<string, unknown>;
/** A rippled `result` object, or the error payload rippled sent back (`{ error: "entryNotFound", ... }`). */
export type RawResult = Json & { error?: string };

const NOT_FOUND = new Set(["entryNotFound", "actNotFound", "objectNotFound"]);

function isNotFoundResult(r: RawResult | undefined): boolean {
  return !r || (typeof r.error === "string" && NOT_FOUND.has(r.error));
}

function assertOk(r: RawResult, what: string): void {
  if (r.error) throw new Error(`${what}: rippled error ${r.error}${r.error_message ? ` (${String(r.error_message)})` : ""}`);
}

/** `client.request`, but rippled errors come back as their payload (so parsers see what the fixtures recorded). */
async function rawRequest(req: Json): Promise<RawResult> {
  const client = await getClient();
  try {
    const res = (await client.request(req as never)) as { result: RawResult };
    return res.result;
  } catch (e) {
    const data = (e as { data?: RawResult }).data;
    if (data && typeof data.error === "string") return data;
    throw e;
  }
}

/** Validated ledger header (index + close time) so every read in one snapshot comes from the same ledger. */
async function validatedLedger(): Promise<RawResult> {
  const r = await rawRequest({ command: "ledger", ledger_index: "validated" });
  assertOk(r, "ledger");
  return r.ledger as RawResult;
}

const ledgerIndexOf = (ledger: RawResult): number => Number(ledger.ledger_index);
const closeTimeOf = (ledger: RawResult): number => Number(ledger.close_time);
const nodeOf = <T>(r: RawResult): T => r.node as T;

// ---------------------------------------------------------------------------------------------------------
// Decimals (no floats: amounts go through BigInt)

/** Expand rippled number text ("1.5e-7", "-2E3", "1000.0002853880939045") to a plain decimal string. */
export function toPlainDecimal(v: string): string {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(v.trim());
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) throw new Error(`not a decimal: ${JSON.stringify(v)}`);
  const sign = m[1] === "-" ? "-" : "";
  let int = m[2] ?? "";
  let frac = m[3] ?? "";
  const exp = Number(m[4] ?? 0);
  if (exp > 0) {
    frac = frac.padEnd(exp, "0");
    int += frac.slice(0, exp);
    frac = frac.slice(exp);
  } else if (exp < 0) {
    int = int.padStart(-exp, "0");
    frac = int.slice(int.length + exp) + frac;
    int = int.slice(0, int.length + exp);
  }
  int = int.replace(/^0+/, "") || "0";
  frac = frac.replace(/0+$/, "");
  const out = frac ? `${int}.${frac}` : int;
  return out === "0" ? "0" : sign + out;
}

/** Decimal string → scaled BigInt (value × 10^dp), truncated toward zero. */
function toScaled(v: string, dp: number): bigint {
  const plain = toPlainDecimal(v);
  const neg = plain.startsWith("-");
  const [i = "0", f = ""] = (neg ? plain.slice(1) : plain).split(".");
  const n = BigInt(i + f.padEnd(dp, "0").slice(0, dp));
  return neg ? -n : n;
}

/** Scaled BigInt (×10^dp) → plain decimal with trailing zeros trimmed. */
function fromScaled(n: bigint, dp: number): string {
  const neg = n < 0n;
  const s = (neg ? -n : n).toString().padStart(dp + 1, "0");
  const int = s.slice(0, s.length - dp);
  const frac = s.slice(s.length - dp).replace(/0+$/, "");
  const out = frac ? `${int}.${frac}` : int;
  return neg && out !== "0" ? `-${out}` : out;
}

const RLUSD_DP = 6;

/**
 * Ledger IOU value → shared `Rlusd` (≤ 6 decimals, truncated). `undefined` (field omitted by rippled) → "0".
 * Throws on negatives: `Rlusd` can't represent them (clamp first if a negative is meaningful, e.g. issuer side).
 */
export function toRlusd(v: string | undefined): Rlusd {
  if (v == null) return "0";
  const out = fromScaled(toScaled(v, RLUSD_DP), RLUSD_DP);
  if (out.startsWith("-")) throw new Error(`negative RLUSD amount ${v}`);
  return out;
}

/** Drops (integer string) → XRP decimal string. */
export function dropsToXrpDecimal(drops: string): string {
  return fromScaled(BigInt(drops), 6);
}

/** a / b, truncated to `dp` decimals. Both are decimal strings; b must be non-zero. */
export function divDecimal(a: string, b: string, dp: number): string {
  // a/b = (A/10^k) / (B/10^k) = A/B with both scaled to a common k.
  const k = 18;
  const A = toScaled(a, k);
  const B = toScaled(b, k);
  if (B === 0n) throw new Error("division by zero");
  return fromScaled((A * 10n ** BigInt(dp)) / B, dp);
}

const isoOrEmpty = (rippleTime: number | undefined): string => (rippleTime ? rippleTimeToISOTime(rippleTime) : "");

// ---------------------------------------------------------------------------------------------------------
// Vault

/** Vault ledger entry fields this module reads on top of vault.ts's `VaultLedgerEntry`. */
export type VaultNode = VaultLedgerEntry & { Scale?: number };
export interface MptIssuanceNode {
  OutstandingAmount?: string;
  AssetScale?: number;
  [k: string]: unknown;
}

/** Recorded / fetched inputs for one vault snapshot, all from the same validated ledger. */
export interface VaultSnapshotRaw {
  /** `ledger` command → `result.ledger` (needs `close_time`). */
  ledger: RawResult;
  /** `ledger_entry { index: vaultId }` result. */
  vault: RawResult;
  /** `ledger_entry { mpt_issuance: Vault.ShareMPTID }` result. */
  shareIssuance?: RawResult;
}

/**
 * Phase of a closed-ended vault at ledger time `nowRipple` (Subscription while now ≤ SubscriptionDate, Redemption
 * from RedemptionDate). An open-ended vault (no dates; can't back a LoanBroker on devnet) reads as "subscription".
 */
export function snapshotPhase(vault: VaultNode, nowRipple: number): VaultSnapshot["phase"] {
  const p = vaultPhase(vault, nowRipple);
  return p === "open" ? "subscription" : p;
}

/** Pure: raw ledger JSON → `VaultSnapshot`. `undefined` if the vault doesn't exist (entryNotFound). */
export function parseVaultSnapshot(raw: VaultSnapshotRaw): VaultSnapshot | undefined {
  if (isNotFoundResult(raw.vault)) return undefined;
  assertOk(raw.vault, "ledger_entry vault");
  const v = nodeOf<VaultNode>(raw.vault);
  const issuance = raw.shareIssuance && !isNotFoundResult(raw.shareIssuance) ? nodeOf<MptIssuanceNode>(raw.shareIssuance) : undefined;
  const scale = v.Scale ?? issuance?.AssetScale ?? 0;
  const assetsTotal = toRlusd(v.AssetsTotal);
  const shares = BigInt(issuance?.OutstandingAmount ?? "0");
  const sharePrice = shares === 0n ? "1" : divDecimal(toPlainDecimal(v.AssetsTotal ?? "0"), fromScaled(shares, scale), RLUSD_DP);
  return {
    assetsTotal,
    assetsAvailable: toRlusd(v.AssetsAvailable),
    sharesOutstanding: shares.toString(),
    sharePrice,
    subscriptionDate: isoOrEmpty(v.SubscriptionDate),
    redemptionDate: isoOrEmpty(v.RedemptionDate),
    phase: snapshotPhase(v, closeTimeOf(raw.ledger)),
  };
}

export async function fetchVaultSnapshotRaw(vaultId: string): Promise<VaultSnapshotRaw> {
  const ledger = await validatedLedger();
  const at = ledgerIndexOf(ledger);
  const vault = await rawRequest({ command: "ledger_entry", index: vaultId, ledger_index: at });
  if (isNotFoundResult(vault) || vault.error) return { ledger, vault };
  const mptId = nodeOf<VaultNode>(vault).ShareMPTID;
  const shareIssuance = await rawRequest({ command: "ledger_entry", mpt_issuance: mptId, ledger_index: at });
  return { ledger, vault, shareIssuance };
}

/** Vault snapshot at the latest validated ledger, or `undefined` if the vault doesn't exist. */
export async function getVaultSnapshot(vaultId: string): Promise<VaultSnapshot | undefined> {
  return parseVaultSnapshot(await fetchVaultSnapshotRaw(vaultId));
}

// ---------------------------------------------------------------------------------------------------------
// Loan

/** Pure: `ledger_entry` result for a Loan → `LoanSnapshot`. `undefined` if deleted / never existed. */
export function parseLoanSnapshot(loanResult: RawResult): LoanSnapshot | undefined {
  if (isNotFoundResult(loanResult)) return undefined;
  assertOk(loanResult, "ledger_entry loan");
  const l = nodeOf<LoanEntry>(loanResult);
  const paymentRemaining = l.PaymentRemaining ?? 0;
  return {
    principalOutstanding: toRlusd(l.PrincipalOutstanding),
    totalValueOutstanding: toRlusd(l.TotalValueOutstanding),
    periodicPayment: toRlusd(l.PeriodicPayment),
    paymentRemaining,
    nextPaymentDueDate: paymentRemaining > 0 ? isoOrEmpty(l.NextPaymentDueDate) : "",
  };
}

export async function getLoanSnapshot(loanId: string): Promise<LoanSnapshot | undefined> {
  return parseLoanSnapshot(await rawRequest({ command: "ledger_entry", index: loanId, ledger_index: "validated" }));
}

// ---------------------------------------------------------------------------------------------------------
// Escrow

interface EscrowNode {
  index: string;
  Account: string;
  Destination: string;
  Amount: string | { currency: string; issuer: string; value: string } | { mpt_issuance_id: string; value: string };
  Condition?: string;
  CancelAfter?: number;
  FinishAfter?: number;
  /** Present on devnet (fixIncludeKeyletFields): the EscrowCreate sequence = OfferSequence. */
  Sequence?: number;
  PreviousTxnID?: string;
  [k: string]: unknown;
}

export interface EscrowView {
  /** Ledger object ID. */
  index: string;
  owner: string;
  /** OfferSequence for EscrowFinish/EscrowCancel (Escrow.Sequence, else the one the caller asked for). */
  offerSequence: number | undefined;
  destination: string;
  /** "RLUSD" | "XRP" | other currency code / MPT id. */
  currency: string;
  issuer?: string;
  /** Rlusd for RLUSD escrows (≤ 6 decimals, truncated); XRP decimal for XRP escrows; raw value otherwise. */
  amount: string;
  condition?: string;
  cancelAfter?: string;
  finishAfter?: string;
  cancelAfterRipple?: number;
  finishAfterRipple?: number;
  /**
   * open    — on ledger and not past CancelAfter (finish possible with the fulfillment).
   * expired — on ledger but past CancelAfter: finish fails (tecNO_PERMISSION), anyone can EscrowCancel.
   * A consumed (finished or cancelled) escrow is gone from the ledger: the getters return `undefined`.
   */
  status: "open" | "expired";
  /** now > FinishAfter (or none) and not expired. */
  finishable: boolean;
  /** CancelAfter set and now > CancelAfter. */
  cancellable: boolean;
}

/** Pure: one Escrow ledger node → `EscrowView` at ledger time `nowRipple`. */
export function parseEscrowNode(node: EscrowNode, nowRipple: number, offerSequence?: number): EscrowView {
  let currency: string;
  let issuer: string | undefined;
  let amount: string;
  if (typeof node.Amount === "string") {
    currency = "XRP";
    amount = dropsToXrpDecimal(node.Amount);
  } else if ("mpt_issuance_id" in node.Amount) {
    currency = node.Amount.mpt_issuance_id;
    amount = node.Amount.value;
  } else {
    issuer = node.Amount.issuer;
    const isRlusd = node.Amount.currency === RLUSD_CURRENCY;
    currency = isRlusd ? "RLUSD" : node.Amount.currency;
    amount = isRlusd ? toRlusd(node.Amount.value) : toPlainDecimal(node.Amount.value);
  }
  // rippled: finish/cancel compare the parent close time strictly against the mark ("after").
  const expired = node.CancelAfter != null && nowRipple > node.CancelAfter;
  const pastFinishAfter = node.FinishAfter == null || nowRipple > node.FinishAfter;
  return {
    index: node.index,
    owner: node.Account,
    offerSequence: node.Sequence ?? offerSequence,
    destination: node.Destination,
    currency,
    ...(issuer ? { issuer } : {}),
    amount,
    ...(node.Condition ? { condition: node.Condition } : {}),
    ...(node.CancelAfter != null ? { cancelAfter: rippleTimeToISOTime(node.CancelAfter), cancelAfterRipple: node.CancelAfter } : {}),
    ...(node.FinishAfter != null ? { finishAfter: rippleTimeToISOTime(node.FinishAfter), finishAfterRipple: node.FinishAfter } : {}),
    status: expired ? "expired" : "open",
    finishable: !expired && pastFinishAfter,
    cancellable: expired,
  };
}

/** Pure: `ledger_entry { escrow: {owner, seq} }` result → view, or `undefined` if consumed / never existed. */
export function parseEscrow(escrowResult: RawResult, nowRipple: number, offerSequence?: number): EscrowView | undefined {
  if (isNotFoundResult(escrowResult)) return undefined;
  assertOk(escrowResult, "ledger_entry escrow");
  return parseEscrowNode(nodeOf<EscrowNode>(escrowResult), nowRipple, offerSequence);
}

/** Pure: `account_objects { type: "escrow" }` result → views (owned AND incoming escrows of the account). */
export function parseEscrowList(accountObjectsResult: RawResult, nowRipple: number): EscrowView[] {
  if (isNotFoundResult(accountObjectsResult)) return [];
  assertOk(accountObjectsResult, "account_objects");
  const objs = (accountObjectsResult.account_objects ?? []) as EscrowNode[];
  return objs.filter((o) => o.LedgerEntryType === "Escrow").map((o) => parseEscrowNode(o, nowRipple));
}

/** Escrow `owner`/`offerSequence` at the latest validated ledger; `undefined` = consumed (finished/cancelled) or never created. */
export async function getEscrow(owner: string, offerSequence: number): Promise<EscrowView | undefined> {
  const ledger = await validatedLedger();
  const res = await rawRequest({ command: "ledger_entry", escrow: { owner, seq: offerSequence }, ledger_index: ledgerIndexOf(ledger) });
  return parseEscrow(res, closeTimeOf(ledger), offerSequence);
}

/** Escrows OWNED by `owner` (account_objects also lists escrows where it is the destination; those are dropped). */
export async function listEscrowsParsed(owner: string): Promise<EscrowView[]> {
  const ledger = await validatedLedger();
  const at = ledgerIndexOf(ledger);
  const out: EscrowView[] = [];
  let marker: unknown;
  do {
    const res = await rawRequest({ command: "account_objects", account: owner, type: "escrow", ledger_index: at, limit: 200, ...(marker ? { marker } : {}) });
    out.push(...parseEscrowList(res, closeTimeOf(ledger)));
    marker = res.marker;
  } while (marker);
  return out.filter((e) => e.owner === owner);
}

// ---------------------------------------------------------------------------------------------------------
// Balances

interface TrustLine {
  account: string;
  balance: string;
  currency: string;
  limit: string;
  limit_peer: string;
  freeze?: boolean;
  freeze_peer?: boolean;
  [k: string]: unknown;
}

export interface RlusdTrustline {
  issuer: string;
  /** Holder balance (Rlusd). Negative balances (the account is the issuer side) read as "0". */
  balance: Rlusd;
  /** The account's own limit on the line. "0" = the account never opted in (e.g. the issuer's side). */
  limit: string;
  /** Issuer froze the line (freeze_peer): payments / escrow finishes to it fail. */
  frozen: boolean;
}

/** Pure: `account_lines` result → the RLUSD line (optionally from a given issuer), or `undefined`. actNotFound → `undefined`. */
export function parseRlusdTrustline(accountLinesResult: RawResult, issuer?: string): RlusdTrustline | undefined {
  if (isNotFoundResult(accountLinesResult)) return undefined;
  assertOk(accountLinesResult, "account_lines");
  const lines = (accountLinesResult.lines ?? []) as TrustLine[];
  const line = lines.find((l) => l.currency === RLUSD_CURRENCY && (!issuer || l.account === issuer));
  if (!line) return undefined;
  const bal = toPlainDecimal(line.balance);
  return {
    issuer: line.account,
    balance: bal.startsWith("-") ? "0" : toRlusd(bal),
    limit: toPlainDecimal(line.limit),
    frozen: Boolean(line.freeze_peer),
  };
}

/** Pure: RLUSD balance from `account_lines` ("0" if no line / unfunded account). */
export function parseRlusdBalance(accountLinesResult: RawResult, issuer?: string): Rlusd {
  return parseRlusdTrustline(accountLinesResult, issuer)?.balance ?? "0";
}

/** Pure: true when the account has opted into RLUSD (own limit > 0) and the issuer hasn't frozen the line. */
export function parseHasRlusdTrustline(accountLinesResult: RawResult, issuer?: string): boolean {
  const line = parseRlusdTrustline(accountLinesResult, issuer);
  return !!line && line.limit !== "0" && !line.limit.startsWith("-") && !line.frozen;
}

/** Pure: XRP balance (total, incl. reserve) from `account_info`; "0" for an unfunded account. */
export function parseXrpBalance(accountInfoResult: RawResult): string {
  if (isNotFoundResult(accountInfoResult)) return "0";
  assertOk(accountInfoResult, "account_info");
  const data = accountInfoResult.account_data as { Balance?: string } | undefined;
  return dropsToXrpDecimal(data?.Balance ?? "0");
}

async function fetchAccountLines(account: string, issuer?: string): Promise<RawResult> {
  // With `peer` the result is a single small page; without it, walk the pages and merge.
  const base = { command: "account_lines", account, ledger_index: "validated", ...(issuer ? { peer: issuer } : {}) };
  const first = await rawRequest(base);
  if (first.error || issuer) return first;
  const lines = [...((first.lines ?? []) as TrustLine[])];
  let marker = first.marker;
  while (marker) {
    const page = await rawRequest({ ...base, ledger_index: first.ledger_index, marker });
    assertOk(page, "account_lines");
    lines.push(...((page.lines ?? []) as TrustLine[]));
    marker = page.marker;
  }
  return { ...first, lines, marker: undefined };
}

/**
 * Balance of `account` as a decimal string: RLUSD (≤ 6 decimals; `issuer` narrows to one issuer, default = any
 * RLUSD line) or XRP (total incl. reserve). Unfunded account / no trust line → "0".
 */
export async function getBalance(account: string, currency: "RLUSD" | "XRP", opts: { issuer?: string } = {}): Promise<string> {
  if (currency === "XRP") return parseXrpBalance(await rawRequest({ command: "account_info", account, ledger_index: "validated" }));
  return parseRlusdBalance(await fetchAccountLines(account, opts.issuer), opts.issuer);
}

/** Does `account` hold an open (limit > 0, not frozen) RLUSD trust line? Used by preflightFinish (XRPL-14). */
export async function hasRlusdTrustline(account: string, issuer?: string): Promise<boolean> {
  return parseHasRlusdTrustline(await fetchAccountLines(account, issuer), issuer);
}
