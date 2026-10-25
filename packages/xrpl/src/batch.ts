// XRPL-13: XLS-56 Batch (BatchV1_1) for the loan close.
//
// Goal: `LoanSet + EscrowCreate×N` in one all-or-nothing Batch, so the SPV never holds liquid principal.
// Devnet finding (rippled 3.4.1, see docs/xrpl-protocol-notes.md §2d): every SAV/Lending tx type, LoanSet included, is in
// `Batch::kDisabledTxTypes` and is rejected as an inner tx with `temINVALID_INNER_BATCH`. rippled `develop` lifts that
// behind `LendingProtocolV1_2`, which devnet does not have. So today:
//   - closeLoanAtomic({ mode: "escrows" }) (default): LoanSet, then ONE Batch with every EscrowCreate (tfAllOrNothing).
//     2 txs instead of 1+N, and either every milestone escrow exists or none does. The SPV holds the principal for
//     ~1 ledger.
//   - closeLoanAtomic({ mode: "full" }): the real atomic close. Outer = platform (broker owner), inners = LoanSet
//     (Counterparty = SPV, no CounterpartySignature) + EscrowCreate×N from the SPV, BatchSigners = SPV multisig.
//     Fails with temINVALID_INNER_BATCH until LendingProtocolV1_2 is on the network.
// XRPL-13b: closeLoanAndCreateEscrows (api.ts) uses createEscrowsAtomic by default for 2..8 milestones. Every escrow
// goes through validateEscrowSpecs before anything is signed; inner results are looked up in the Batch's own ledger
// (`searched_all` makes "not applied" provable) and every created escrow is checked against its metadata.
import {
  BatchFlags,
  convertStringToHex,
  decodeAccountID,
  GlobalFlags,
  hashes,
  LoanSetFlags,
  multisign,
  signMultiBatch,
  type Batch,
  type BatchSigner,
  type EscrowCreate,
  type LoanSet,
  type Signer,
  type SubmittableTransaction,
  type Wallet,
} from "xrpl";
import { explorerTxUrl } from "@xrlp/shared";
import { createdNodeId, DEFAULT_LLS_MARGIN, getClient, ledgerTime, submitBlob, withAccountLock, XrplTxError, type TxResult } from "./client.ts";
import { normalizeCondition } from "./condition.ts";
import { loanSet, type LoanSetParams } from "./loan.ts";
import {
  CloseLoanPartialError,
  CloseValidationError,
  validateEscrowSpecs,
  type ClosePartialContext,
  type CreatedEscrowRef,
  type PlannedEscrow,
} from "./loan-close.ts";
import { rlusdAmount } from "./rlusd.ts";

/** XLS-56: 2..8 inner transactions. */
export const BATCH_MIN_INNER = 2;
export const BATCH_MAX_INNER = 8;
/** XLS-56: at most 8 BatchSigners entries (rippled kMaxBatchSigners). */
export const BATCH_MAX_SIGNERS = 8;
export const TF_INNER_BATCH_TXN = GlobalFlags.tfInnerBatchTxn; // 0x40000000
export const TF_ALL_OR_NOTHING = BatchFlags.tfAllOrNothing; // 0x00010000

/** Fields an inner tx must not carry (XLS-56 §2.1.2; xrpl.js validateBatch). */
const STRIP_INNER = ["TxnSignature", "Signers", "LastLedgerSequence", "CounterpartySignature"] as const;

/**
 * Pure: turn a normal tx into a Batch inner tx: `tfInnerBatchTxn`, `Fee "0"`, `SigningPubKey ""`, no signatures,
 * no LastLedgerSequence (only the outer tx expires). Keeps an explicit Sequence if given.
 */
export function toInnerTx<T extends SubmittableTransaction>(tx: T): T {
  if (tx.TransactionType === ("Batch" as string)) throw new Error("Batch: inner tx cannot be a Batch");
  const flags = typeof tx.Flags === "number" ? tx.Flags : 0;
  if (tx.Flags !== undefined && typeof tx.Flags !== "number") throw new Error("Batch: inner tx Flags must be numeric");
  const inner = { ...tx, Flags: (flags | TF_INNER_BATCH_TXN) >>> 0, Fee: "0", SigningPubKey: "" } as T & Record<string, unknown>;
  for (const k of STRIP_INNER) delete inner[k];
  return inner;
}

/**
 * Pure: assign inner Sequences like xrpl.js autofillBatchTxn: per account, consecutive; an inner from the outer
 * account starts at outerSequence + 1 (the outer tx consumes outerSequence). Inner txs that already have a Sequence
 * keep it.
 */
export function assignInnerSequences<T extends SubmittableTransaction>(
  inners: T[],
  outer: { account: string; sequence: number },
  nextSequence: Record<string, number>,
): T[] {
  const next: Record<string, number> = { ...nextSequence, [outer.account]: outer.sequence + 1 };
  return inners.map((tx) => {
    if (tx.Sequence != null || tx.TicketSequence != null) return tx;
    const seq = next[tx.Account];
    if (seq == null) throw new Error(`Batch: no next Sequence for inner account ${tx.Account}`);
    next[tx.Account] = seq + 1;
    return { ...tx, Sequence: seq };
  });
}

/**
 * Pure: the fee rippled 3.4.1 charges for a Batch (Batch::calculateBaseFeeImpl):
 *   base (batch) + base × (1 + outerSigners) + Σ inner base fees + base × (signatures inside BatchSigners)
 * `outerSigners` = 0 for a single-signed outer tx, N for an N-signer multisig outer. Each of our inner types
 * (Payment, EscrowCreate, unsigned LoanSet) costs `base`.
 */
export function batchFee(p: { baseDrops: number; innerCount: number; outerSigners?: number; batchSignatures?: number }): string {
  const { baseDrops: b } = p;
  return String(b + b * (1 + (p.outerSigners ?? 0)) + b * p.innerCount + b * (p.batchSignatures ?? 0));
}

/** Account IDs compare as 160-bit numbers (rippled sorts signers this way, not by r-address string). */
export function compareAccounts(a: string, b: string): number {
  const x = Buffer.from(decodeAccountID(a)).toString("hex");
  const y = Buffer.from(decodeAccountID(b)).toString("hex");
  return x < y ? -1 : x > y ? 1 : 0;
}

/**
 * Pure: who must appear in BatchSigners (rippled Batch::preflightSigValidated): every inner `Account` (or `Delegate`)
 * and every inner `Counterparty`, minus the outer Account, sorted by AccountID, de-duplicated.
 */
export function requiredBatchSigners(outerAccount: string, inners: SubmittableTransaction[]): string[] {
  const set = new Set<string>();
  for (const tx of inners) {
    const r = tx as SubmittableTransaction & { Delegate?: string; Counterparty?: string };
    set.add(r.Delegate ?? r.Account);
    if (typeof r.Counterparty === "string") set.add(r.Counterparty);
  }
  set.delete(outerAccount);
  return [...set].sort(compareAccounts);
}

/** Pure: unsigned Batch with `tfAllOrNothing` (default). Validates the inner count and that inners are inner-shaped. */
export function buildBatch(p: { account: string; inners: SubmittableTransaction[]; flags?: number }): Batch {
  const n = p.inners.length;
  if (n < BATCH_MIN_INNER || n > BATCH_MAX_INNER) throw new Error(`Batch: needs ${BATCH_MIN_INNER}..${BATCH_MAX_INNER} inner txs, got ${n}`);
  const inners = p.inners.map((tx) => (((tx.Flags as number | undefined) ?? 0) & TF_INNER_BATCH_TXN ? tx : toInnerTx(tx)));
  return {
    TransactionType: "Batch",
    Account: p.account,
    Flags: p.flags ?? TF_ALL_OR_NOTHING,
    RawTransactions: inners.map((RawTransaction) => ({ RawTransaction })),
  };
}

/** Hash of an inner tx as it appears on-ledger (its own tx, with ParentBatchID in the metadata). */
export function innerTxHash(tx: SubmittableTransaction): string {
  return hashes.hashSignedTx(tx);
}

/**
 * Pure: merge BatchSigner fragments into the on-ledger shape: one entry per Account, ascending by AccountID; for a
 * multisig account, all its nested `Signers` merged and sorted.
 * NOTE: xrpl.js 5.3.0 `combineBatchSigners` de-duplicates by BatchSigner.Account and keeps only the FIRST fragment,
 * which drops all but one signer of a multisig account (→ tefBAD_QUORUM). Use this instead.
 */
export function mergeBatchSigners(fragments: BatchSigner[]): BatchSigner[] {
  const byAccount = new Map<string, BatchSigner["BatchSigner"]>();
  for (const { BatchSigner: s } of fragments) {
    const cur = byAccount.get(s.Account);
    if (!cur) {
      byAccount.set(s.Account, s.Signers ? { Account: s.Account, Signers: [...s.Signers] } : { ...s });
      continue;
    }
    if (!cur.Signers || !s.Signers) throw new Error(`Batch: ${s.Account} given both as single-sig and multisig BatchSigner`);
    for (const x of s.Signers) if (!cur.Signers.some((y) => y.Signer.Account === x.Signer.Account)) cur.Signers.push(x);
  }
  return [...byAccount.values()]
    .map((s) => (s.Signers ? { ...s, Signers: [...s.Signers].sort((a: Signer, b: Signer) => compareAccounts(a.Signer.Account, b.Signer.Account)) } : s))
    .sort((a, b) => compareAccounts(a.Account, b.Account))
    .map((BatchSigner) => ({ BatchSigner }));
}

/**
 * Pure: BatchSigner for `account` from its signers. One wallet whose address is `account` → single-sig entry;
 * otherwise each wallet signs as a multisig signer of `account` (account must have a SignerList).
 * The batch must be fully prepared (inner Sequences, outer Sequence/Flags): the signature binds them.
 */
export function signBatchFor(batch: Batch, account: string, wallets: Wallet[]): BatchSigner {
  if (!wallets.length) throw new Error(`Batch: no signers for ${account}`);
  const single = wallets.length === 1 && wallets[0]!.classicAddress === account;
  const fragments = wallets.map((w) => {
    const copy: Batch = structuredClone({ ...batch, BatchSigners: undefined });
    delete copy.BatchSigners;
    signMultiBatch(w, copy, single ? { batchAccount: account } : { batchAccount: account, multisign: true });
    return copy.BatchSigners![0]!;
  });
  const merged = mergeBatchSigners(fragments);
  if (merged.length !== 1) throw new Error("Batch: signBatchFor produced more than one entry");
  return merged[0]!;
}

// ---------------------------------------------------------------- network

export interface InnerResult {
  hash: string;
  explorerUrl: string;
  transactionType: string;
  account: string;
  sequence: number;
  /**
   * Engine result of the inner tx as applied by THIS Batch (`tesSUCCESS`, or a recorded `tec*`), or
   * "not_applied" (provably absent from the Batch's ledger: tfAllOrNothing rolled back, or skipped), or
   * "unknown" (not found but the server could not say it searched the whole ledger, or found outside this Batch).
   */
  result: string;
  tx?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  ledgerIndex?: number;
  /** ISO close time of the inner tx's ledger. */
  closeTime?: string;
}

/**
 * all_applied: every inner tx is tesSUCCESS in this Batch's ledger. rolled_back: every inner tx is provably absent
 * (tfAllOrNothing). partial: some applied, some not. unknown: at least one lookup could not tell.
 */
export type BatchOutcome = "all_applied" | "rolled_back" | "partial" | "unknown";

export interface BatchResult {
  tx: TxResult;
  inners: InnerResult[];
  /** True when every inner tx is on-ledger with tesSUCCESS. */
  allApplied: boolean;
  outcome: BatchOutcome;
}

export interface SubmitBatchParams {
  /** Outer Account: pays the whole fee. */
  account: string;
  /** How the outer tx is signed: by `account`'s own key, or multisigned by its SignerList. */
  outerSigner: { single: Wallet } | { multisig: Wallet[] };
  inners: SubmittableTransaction[];
  /**
   * Signers for every other account that must authorize an inner tx (inner Account or Counterparty).
   * One wallet with the account's own address = single-sig; otherwise multisig signers of that account.
   */
  batchSigners?: Record<string, Wallet[]>;
  flags?: number;
  /** Override the computed fee (drops). */
  fee?: string;
  lastLedgerMargin?: number;
  /** Called with the signed Batch right before it is submitted (its hash + LastLedgerSequence: the in-flight window). */
  onPrepared?: (b: { hash: string; lastLedgerSequence: number; batch: Batch }) => void;
}

async function nextSequence(account: string): Promise<number> {
  const client = await getClient();
  const r = await client.request({ command: "account_info", account, ledger_index: "current" });
  return r.result.account_data.Sequence;
}

async function baseFeeDrops(): Promise<number> {
  const client = await getClient();
  const r = await client.request({ command: "fee" });
  return Math.max(Number(r.result.drops.base_fee), Number(r.result.drops.open_ledger_fee));
}

/**
 * Pure-ish core of submitBatch: given the network facts, produce the fully prepared + signed Batch blob.
 * Exported for tests; `prepareSignedBatch` below fetches the facts.
 */
export function signPreparedBatch(
  p: SubmitBatchParams,
  facts: { outerSequence: number; nextSequence: Record<string, number>; baseDrops: number; lastLedgerSequence: number; networkId?: number },
): { batch: Batch; blob: string; hash: string } {
  const inners = assignInnerSequences(
    p.inners.map((t) => toInnerTx(t)),
    { account: p.account, sequence: facts.outerSequence },
    facts.nextSequence,
  ).map((t) => (facts.networkId != null && facts.networkId > 1024 ? { ...t, NetworkID: facts.networkId } : t));
  const required = requiredBatchSigners(p.account, inners);
  const provided = Object.keys(p.batchSigners ?? {});
  const missing = required.filter((a) => !provided.includes(a));
  const extra = provided.filter((a) => !required.includes(a));
  if (missing.length || extra.length) {
    throw new XrplTxError("Batch", `temBAD_SIGNER (local check: missing ${missing.join(",") || "-"}, extra ${extra.join(",") || "-"})`);
  }
  const outerSigners = "multisig" in p.outerSigner ? p.outerSigner.multisig.length : 0;
  const batchSignatures = required.reduce((a, acct) => {
    const ws = p.batchSigners![acct]!;
    return a + (ws.length === 1 && ws[0]!.classicAddress === acct ? 1 : ws.length);
  }, 0);
  const unsigned: Batch = {
    ...buildBatch({ account: p.account, inners, ...(p.flags !== undefined ? { flags: p.flags } : {}) }),
    Sequence: facts.outerSequence,
    Fee: p.fee ?? batchFee({ baseDrops: facts.baseDrops, innerCount: inners.length, outerSigners, batchSignatures }),
    LastLedgerSequence: facts.lastLedgerSequence,
    ...(facts.networkId != null && facts.networkId > 1024 ? { NetworkID: facts.networkId } : {}),
  };
  if (required.length) {
    const entries = required.map((acct) => signBatchFor(unsigned, acct, p.batchSigners![acct]!));
    unsigned.BatchSigners = mergeBatchSigners(entries);
  }
  let blob: string;
  if ("single" in p.outerSigner) {
    blob = p.outerSigner.single.sign(unsigned).tx_blob;
  } else {
    const prepared = { ...unsigned, SigningPubKey: "" };
    blob = multisign(p.outerSigner.multisig.map((w) => w.sign(prepared, true).tx_blob));
  }
  return { batch: unsigned, blob, hash: hashes.hashSignedTx(blob) };
}

/** What a `tx` lookup of one inner hash returned. `searchedAll` = rippled's flag on a ranged txnNotFound. */
export type InnerLookup = { found: true; result: Record<string, unknown> } | { found: false; searchedAll: boolean };

/**
 * Pure: one inner tx's fate. Applied by THIS Batch = validated, `meta.ParentBatchID` = the Batch hash, and (when the
 * Batch ledger is known) in that same ledger. Not found with `searchedAll` → "not_applied"; anything else → "unknown".
 */
export function classifyInnerLookup(
  batch: { hash?: string; ledgerIndex?: number },
  base: Pick<InnerResult, "hash" | "explorerUrl" | "transactionType" | "account" | "sequence">,
  lookup: InnerLookup,
): InnerResult {
  if (!lookup.found) return { ...base, result: lookup.searchedAll ? "not_applied" : "unknown" };
  const r = lookup.result;
  const meta = (r.meta ?? {}) as Record<string, unknown>;
  const tx = (r.tx_json ?? r.tx ?? r) as Record<string, unknown>;
  const ledgerIndex = typeof r.ledger_index === "number" ? r.ledger_index : undefined;
  const closeTime = typeof r.close_time_iso === "string" ? r.close_time_iso : undefined;
  const ours =
    r.validated === true &&
    (batch.hash == null || meta.ParentBatchID === batch.hash) &&
    (batch.ledgerIndex == null || ledgerIndex === batch.ledgerIndex);
  return {
    ...base,
    result: ours ? String(meta.TransactionResult ?? "unknown") : "unknown",
    tx,
    meta,
    ...(ledgerIndex != null ? { ledgerIndex } : {}),
    ...(closeTime ? { closeTime } : {}),
  };
}

/** Pure: the Batch as a whole from its inner results (see BatchOutcome). */
export function batchOutcome(inners: Pick<InnerResult, "result">[]): BatchOutcome {
  if (!inners.length || inners.some((i) => i.result === "unknown")) return "unknown";
  if (inners.every((i) => i.result === "tesSUCCESS")) return "all_applied";
  if (inners.every((i) => i.result === "not_applied")) return "rolled_back";
  return "partial";
}

/** An inner result as this package's TxResult (its own hash / explorer link / metadata). */
export function innerTxResult(i: InnerResult): TxResult {
  return { hash: i.hash, explorerUrl: i.explorerUrl, result: i.result, ...(i.ledgerIndex != null ? { ledgerIndex: i.ledgerIndex } : {}), tx: i.tx ?? {}, meta: i.meta ?? {} };
}

/**
 * Look up every inner tx of a validated Batch by its hash. With `at.ledgerIndex` the lookup is pinned to the Batch's
 * ledger (inner txs apply in the same ledger), so a missing inner comes back with `searched_all` → provably
 * "not_applied"; `at.hash` also requires `meta.ParentBatchID` to match. Without `at` (legacy): plain lookups, and a
 * missing inner reads "not_applied".
 */
export async function fetchInnerResults(batch: Batch, at?: { hash?: string; ledgerIndex?: number }): Promise<InnerResult[]> {
  const client = await getClient();
  const ranged = at?.ledgerIndex != null;
  const out: InnerResult[] = [];
  for (const { RawTransaction: t } of batch.RawTransactions) {
    const hash = innerTxHash(t);
    const base = { hash, explorerUrl: explorerTxUrl(hash), transactionType: t.TransactionType, account: t.Account, sequence: Number(t.Sequence) };
    const lookupOnce = async (): Promise<InnerLookup> => {
      try {
        const range = ranged ? { min_ledger: at!.ledgerIndex!, max_ledger: at!.ledgerIndex! } : {};
        const res = await client.request({ command: "tx", transaction: hash, ...range });
        return { found: true, result: res.result as unknown as Record<string, unknown> };
      } catch (e) {
        const d = (e as { data?: { error?: string; searched_all?: boolean } })?.data;
        if (d?.error !== "txnNotFound") throw e;
        return { found: false, searchedAll: ranged ? d.searched_all === true : true };
      }
    };
    // A just-validated ledger can lag in the tx index for a moment: retry an "unknown" twice before reporting it.
    let result = classifyInnerLookup(at ?? {}, base, await lookupOnce());
    for (let retry = 0; retry < 2 && result.result === "unknown"; retry++) {
      await new Promise((r) => setTimeout(r, 1000));
      result = classifyInnerLookup(at ?? {}, base, await lookupOnce());
    }
    out.push(result);
  }
  return out;
}

/**
 * Prepare (sequences, fee, LastLedgerSequence), sign (outer + BatchSigners), submit, wait. Holds the per-account
 * submit lock of the outer account and of every inner account, so no other submit races for their Sequences.
 * Throws XrplTxError on tem/tef (nothing on ledger). On tesSUCCESS returns the inner results: with tfAllOrNothing
 * a failing inner tx means the Batch is still `tesSUCCESS` on-ledger (fee paid) but NO inner tx is applied
 * (`outcome: "rolled_back"`).
 */
export async function submitBatch(p: SubmitBatchParams): Promise<BatchResult> {
  const accounts = [...new Set([p.account, ...p.inners.map((t) => t.Account)])].sort();
  const run = async (): Promise<BatchResult> => {
    const client = await getClient();
    const nextSeq: Record<string, number> = {};
    for (const a of accounts) nextSeq[a] = await nextSequence(a);
    const outerSequence = nextSeq[p.account]!;
    const lastLedgerSequence = (await client.getLedgerIndex()) + (p.lastLedgerMargin ?? DEFAULT_LLS_MARGIN);
    const { batch, blob, hash } = signPreparedBatch(p, {
      outerSequence,
      nextSequence: nextSeq,
      baseDrops: await baseFeeDrops(),
      lastLedgerSequence,
      ...(client.networkID != null ? { networkId: client.networkID } : {}),
    });
    p.onPrepared?.({ hash, lastLedgerSequence, batch });
    const tx = await submitBlob(blob, "Batch");
    const inners = await fetchInnerResults(batch, { hash: tx.hash, ...(tx.ledgerIndex != null ? { ledgerIndex: tx.ledgerIndex } : {}) });
    return { tx, inners, allApplied: inners.every((i) => i.result === "tesSUCCESS"), outcome: batchOutcome(inners) };
  };
  // Nested per-account locks, always taken in sorted order.
  const locked = accounts.reduceRight<() => Promise<BatchResult>>((inner, a) => () => withAccountLock(a, inner), run);
  return locked();
}

/**
 * A validated Batch (outer tesSUCCESS, fee paid) whose inner txs did not all apply: tfAllOrNothing rolled them back
 * (`batch.outcome` "rolled_back"), or their fate is unknown. `engineResult` is "inner_failed".
 */
export class BatchNotAppliedError extends XrplTxError {
  constructor(
    readonly batch: BatchResult,
    what: string,
  ) {
    const bad = batch.inners.filter((i) => i.result !== "tesSUCCESS").map((i) => `${i.transactionType}#${i.sequence}=${i.result}`);
    super("Batch", "inner_failed", batch.tx.hash, {
      detail: `${what}: ${bad.join(", ")}; outcome ${batch.outcome}${batch.outcome === "rolled_back" ? " (tfAllOrNothing: nothing applied)" : ""}`,
    });
    this.name = "BatchNotAppliedError";
  }
}

// ---------------------------------------------------------------- loan close

export interface AtomicMilestone {
  milestoneId: string;
  amount: string;
  /** Hex PREIMAGE-SHA-256 condition (from core's release service). */
  condition: string;
  /** Ripple-epoch seconds. */
  cancelAfter: number;
}

export interface AtomicEscrow {
  milestoneId: string;
  owner: string;
  offerSequence: number;
  condition: string;
  amount: string;
  cancelAfter: number;
  /** Hash of the inner EscrowCreate (its own on-ledger tx). */
  createTx: string;
  explorerUrl: string;
  /** The inner EscrowCreate as a TxResult (its hash, metadata, ledger). */
  tx: TxResult;
}

function escrowCreateTx(spv: string, builder: string, issuer: string, m: AtomicMilestone): EscrowCreate {
  return {
    TransactionType: "EscrowCreate",
    Account: spv,
    Destination: builder,
    Amount: rlusdAmount(issuer, m.amount),
    Condition: m.condition,
    CancelAfter: m.cancelAfter,
  };
}

/** The Escrow ledger object an EscrowCreate's metadata created (NewFields + LedgerIndex), if any. Pure. */
export function createdEscrowFromMeta(meta: Record<string, unknown> | undefined): { index: string; account: string; destination: string; amount: unknown; condition?: string; cancelAfter?: number; sequence?: number } | undefined {
  const nodes = (meta?.AffectedNodes ?? []) as { CreatedNode?: { LedgerEntryType?: string; LedgerIndex?: string; NewFields?: Record<string, unknown> } }[];
  const n = nodes.find((x) => x.CreatedNode?.LedgerEntryType === "Escrow")?.CreatedNode;
  if (!n?.NewFields || !n.LedgerIndex) return undefined;
  const f = n.NewFields;
  return {
    index: n.LedgerIndex,
    account: String(f.Account),
    destination: String(f.Destination),
    amount: f.Amount,
    ...(typeof f.Condition === "string" ? { condition: f.Condition } : {}),
    ...(typeof f.CancelAfter === "number" ? { cancelAfter: f.CancelAfter } : {}),
    ...(typeof f.Sequence === "number" ? { sequence: f.Sequence } : {}),
  };
}

/**
 * Map the applied EscrowCreate inners (in order) to the milestones, checking each one's metadata: it must have
 * created an Escrow owned by the SPV, to the builder, with the milestone's condition. Pure.
 */
export function escrowsFromBatch(spv: string, builder: string, milestones: AtomicMilestone[], inners: InnerResult[]): AtomicEscrow[] {
  const escrowInners = inners.filter((i) => i.transactionType === "EscrowCreate");
  if (escrowInners.length !== milestones.length) throw new Error(`Batch: ${escrowInners.length} EscrowCreate inners for ${milestones.length} milestones`);
  return milestones.map((m, i) => {
    const inner = escrowInners[i]!;
    const node = createdEscrowFromMeta(inner.meta);
    const ok = inner.result === "tesSUCCESS" && node && node.account === spv && node.destination === builder && normalizeCondition(node.condition ?? "") === normalizeCondition(m.condition);
    if (!ok) throw new Error(`Batch inner ${inner.hash} (${inner.result}): metadata shows no Escrow ${spv} -> ${builder} with milestone ${m.milestoneId}'s condition`);
    return { ...m, owner: spv, offerSequence: node.sequence ?? inner.sequence, createTx: inner.hash, explorerUrl: inner.explorerUrl, tx: innerTxResult(inner) };
  });
}

/** Network seam of createEscrowsAtomic (tests inject a fake). */
export interface CreateEscrowsAtomicDeps {
  submitBatch: typeof submitBatch;
}

export interface CreateEscrowsAtomicParams {
  spv: string;
  builder: string;
  issuer: string;
  /** 2..8 milestones (XLS-56 inner-tx limit). */
  milestones: AtomicMilestone[];
  /** SPV quorum: the outer Batch is multisigned by these (any 3 of {platform, builder, inspector, trustee}). */
  spvSigners?: Wallet[];
  /** Fallback: the SPV's own key while its master key is still enabled (outer single-signed). */
  spvSingleKey?: Wallet;
  /** Ledger now (Ripple s): also refuse a CancelAfter within MIN_ESCROW_LIFETIME_S of it. */
  now?: number;
  /** Called with the signed Batch's hash + LastLedgerSequence right before it is submitted. */
  onPrepared?: (b: { hash: string; lastLedgerSequence: number }) => void;
  deps?: Partial<CreateEscrowsAtomicDeps>;
}

/**
 * Every milestone EscrowCreate from the SPV in ONE Batch (tfAllOrNothing): outer Account = SPV, multisigned by the
 * SPV quorum (or its own key), no BatchSigners needed. 2..8 milestones. Either all escrows exist afterwards or none.
 * Every milestone passes validateEscrowSpecs BEFORE anything is signed (CloseValidationError, nothing submitted).
 * A validated Batch whose inners did not all apply → BatchNotAppliedError (`batch.outcome`).
 */
export async function createEscrowsAtomic(p: CreateEscrowsAtomicParams): Promise<{ batch: BatchResult; escrows: AtomicEscrow[] }> {
  const milestones = validateEscrowSpecs(p.milestones, {
    min: BATCH_MIN_INNER,
    max: BATCH_MAX_INNER,
    ...(p.now != null ? { now: p.now } : {}),
    what: "createEscrowsAtomic",
  });
  if (!p.spvSingleKey && !p.spvSigners?.length) throw new CloseValidationError(["no SPV signers (spvSigners or spvSingleKey)"], "createEscrowsAtomic");
  const batch = await (p.deps?.submitBatch ?? submitBatch)({
    account: p.spv,
    outerSigner: p.spvSingleKey ? { single: p.spvSingleKey } : { multisig: p.spvSigners! },
    inners: milestones.map((m) => escrowCreateTx(p.spv, p.builder, p.issuer, m)),
    ...(p.onPrepared ? { onPrepared: ({ hash, lastLedgerSequence }) => p.onPrepared!({ hash, lastLedgerSequence }) } : {}),
  });
  if (batch.outcome !== "all_applied") throw new BatchNotAppliedError(batch, "EscrowCreate batch");
  return { batch, escrows: escrowsFromBatch(p.spv, p.builder, milestones, batch.inners) };
}

/**
 * True when a failed submit's outcome is unknown, i.e. the tx may still validate until its LastLedgerSequence:
 * connection lost mid-submit, server history incomplete, or an unexpected (non-ledger) error. A validated result
 * (tec*, a rolled-back Batch), a tem/tef/tel refusal and a local CloseValidationError are definite.
 */
export function isUncertainSubmitFailure(e: unknown): boolean {
  if (e instanceof BatchNotAppliedError || e instanceof CloseValidationError) return false;
  if (e instanceof XrplTxError) return e.engineResult === "connection_lost" || e.engineResult === "unknown_outcome";
  return true;
}

/**
 * Build the CloseLoanPartialError for a failure after LoanSet: `pending` = planned minus `created`, plus the context
 * resumeEscrowCreation needs (planned escrows, mode, the Batch's hash / LastLedgerSequence / outcome, and whether a
 * tx may still be in flight). Pure.
 */
export function closePartialError(p: {
  loanId: string;
  loanSetTx: string;
  created: CreatedEscrowRef[];
  failure: unknown;
  context: Omit<ClosePartialContext, "batch" | "uncertain" | "inFlightUntilLedger">;
  /** The escrow Batch, if one was signed (from onPrepared). */
  prepared?: { hash: string; lastLedgerSequence: number };
  /** Force the in-flight flag (e.g. false for an error thrown by a caller's hook). Default: isUncertainSubmitFailure. */
  uncertain?: boolean;
}): CloseLoanPartialError {
  const done = new Set(p.created.map((c) => c.milestoneId));
  const pending = p.context.planned.filter((e) => !done.has(e.milestoneId)).map((e) => e.milestoneId);
  const b = p.failure instanceof BatchNotAppliedError ? p.failure.batch : undefined;
  const uncertain = p.uncertain ?? isUncertainSubmitFailure(p.failure);
  const batch: ClosePartialContext["batch"] =
    b || p.prepared
      ? {
          ...(b?.tx.hash ?? p.prepared?.hash ? { hash: b?.tx.hash ?? p.prepared!.hash } : {}),
          ...(p.prepared ? { lastLedgerSequence: p.prepared.lastLedgerSequence } : {}),
          ...(b?.tx.ledgerIndex != null ? { ledgerIndex: b.tx.ledgerIndex } : {}),
          outcome: b?.outcome ?? "unknown",
        }
      : undefined;
  const inFlightUntilLedger = uncertain && !b ? p.prepared?.lastLedgerSequence : undefined;
  return new CloseLoanPartialError(p.loanId, p.loanSetTx, p.created, pending, p.failure, {
    ...p.context,
    ...(batch ? { batch } : {}),
    ...(uncertain && !b ? { uncertain: true } : {}),
    ...(inFlightUntilLedger != null ? { inFlightUntilLedger } : {}),
  });
}

/** Pure: the inner LoanSet for the full atomic close (Counterparty = SPV; its approval comes from BatchSigners). */
export function innerLoanSetTx(p: Omit<LoanSetParams, "borrowerSig" | "fee">): LoanSet {
  return {
    TransactionType: "LoanSet",
    Account: p.brokerOwner.classicAddress,
    LoanBrokerID: p.loanBrokerId,
    Counterparty: p.borrower,
    PrincipalRequested: p.principal,
    InterestRate: p.interestRate,
    PaymentTotal: p.paymentTotal,
    PaymentInterval: p.paymentIntervalS,
    GracePeriod: p.gracePeriodS ?? Math.min(p.paymentIntervalS, 60),
    ...(p.allowOverpayment ? { Flags: LoanSetFlags.tfLoanOverpayment } : {}),
    ...(p.originationFee ? { LoanOriginationFee: p.originationFee } : {}),
    ...(p.serviceFee ? { LoanServiceFee: p.serviceFee } : {}),
    ...(p.data ? { Data: convertStringToHex(p.data.slice(0, 200)) } : {}),
  };
}

export type AtomicCloseMode = "full" | "escrows";

export interface CloseLoanAtomicParams {
  /** Same as loan.ts loanSet(), minus the borrower signature (the SPV signs via spvSigners). borrower = SPV. */
  loan: Omit<LoanSetParams, "borrowerSig" | "fee">;
  builder: string;
  issuer: string;
  /** 2..8 milestones for "escrows", 1..7 for "full" (LoanSet takes one inner slot). */
  milestones: AtomicMilestone[];
  /** SPV quorum (any 3 of {platform, builder, inspector, trustee}). */
  spvSigners: Wallet[];
  /**
   * "escrows" (default, works on devnet 3.4.1): LoanSet (countersigned) then ONE all-or-nothing Batch of EscrowCreates.
   * "full": LoanSet + EscrowCreates in one Batch. Needs LendingProtocolV1_2; devnet today → temINVALID_INNER_BATCH.
   */
  mode?: AtomicCloseMode;
}

export interface CloseLoanAtomicResult {
  mode: AtomicCloseMode;
  loanId: string;
  /** "full": the inner LoanSet. "escrows": the standalone countersigned LoanSet. */
  loanSetTx: { hash: string; explorerUrl: string; result: string; ledgerIndex?: number };
  /** The Batch tx (outer). */
  batchTx: TxResult;
  escrows: AtomicEscrow[];
}

/**
 * Close the loan and create every milestone escrow with as much atomicity as the network allows (see file header).
 * Every milestone passes validateEscrowSpecs (against ledger now) BEFORE the LoanSet. "escrows" mode: a failure after
 * LoanSet → CloseLoanPartialError (loanId, pending milestones, Batch outcome), resumable with resumeEscrowCreation.
 */
export async function closeLoanAtomic(p: CloseLoanAtomicParams): Promise<CloseLoanAtomicResult> {
  const mode = p.mode ?? "escrows";
  const spv = p.loan.borrower;
  const now = await ledgerTime();
  const milestones =
    mode === "escrows"
      ? validateEscrowSpecs(p.milestones, { min: BATCH_MIN_INNER, max: BATCH_MAX_INNER, now, what: "closeLoanAtomic" })
      : validateEscrowSpecs(p.milestones, { min: 1, max: BATCH_MAX_INNER - 1, now, what: "closeLoanAtomic full" });
  if (mode === "escrows") {
    const loan = await loanSet({ ...p.loan, borrowerSig: { multisig: p.spvSigners } });
    let prepared: { hash: string; lastLedgerSequence: number } | undefined;
    let r: Awaited<ReturnType<typeof createEscrowsAtomic>>;
    try {
      r = await createEscrowsAtomic({ spv, builder: p.builder, issuer: p.issuer, milestones, spvSigners: p.spvSigners, onPrepared: (b) => (prepared = b) });
    } catch (failure) {
      const planned: PlannedEscrow[] = milestones.map((m, index) => ({ milestoneId: m.milestoneId, index, amount: m.amount, condition: m.condition, cancelAfter: m.cancelAfter }));
      throw closePartialError({
        loanId: loan.loanId,
        loanSetTx: loan.tx.hash,
        created: [],
        failure,
        context: {
          spv,
          builder: p.builder,
          issuer: p.issuer,
          escrowMode: "batch",
          planned,
          maturity: now + p.loan.paymentIntervalS * p.loan.paymentTotal,
          ...(p.loan.originationFee ? { originationFee: p.loan.originationFee } : {}),
        },
        ...(prepared ? { prepared } : {}),
      });
    }
    return {
      mode,
      loanId: loan.loanId,
      loanSetTx: { hash: loan.tx.hash, explorerUrl: loan.tx.explorerUrl, result: loan.tx.result, ...(loan.tx.ledgerIndex != null ? { ledgerIndex: loan.tx.ledgerIndex } : {}) },
      batchTx: r.batch.tx,
      escrows: r.escrows,
    };
  }
  const platform = p.loan.brokerOwner;
  const batch = await submitBatch({
    account: platform.classicAddress,
    outerSigner: { single: platform },
    inners: [innerLoanSetTx(p.loan), ...milestones.map((m) => escrowCreateTx(spv, p.builder, p.issuer, m))],
    batchSigners: { [spv]: p.spvSigners },
  });
  if (batch.outcome !== "all_applied") throw new BatchNotAppliedError(batch, "LoanSet + EscrowCreate batch");
  const loanInner = batch.inners[0]!;
  const loanId = createdNodeId(innerTxResult(loanInner), "Loan");
  if (!loanId) throw new Error(`inner LoanSet ${loanInner.hash}: no Loan node in metadata`);
  return {
    mode,
    loanId,
    loanSetTx: { hash: loanInner.hash, explorerUrl: loanInner.explorerUrl, result: loanInner.result, ...(loanInner.ledgerIndex != null ? { ledgerIndex: loanInner.ledgerIndex } : {}) },
    batchTx: batch.tx,
    escrows: escrowsFromBatch(spv, p.builder, milestones, batch.inners),
  };
}

