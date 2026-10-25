// On-chain attestations: a 1-drop XRP Payment from the attester to the project SPV with a JSON memo.
// Shows up in the SPV's tx history, signed by the attester's own key => auditable "who attested what".
// These are audit records (inputs to the release test suite), NOT release keys.
//
// v2 memo (docs/05-api.md §3): MemoType `xrlp/attest/v1`, MemoFormat `application/json`,
//   MemoData = JSON { v:1, kind: "audit"|"verdict"|"decision"|"release", milestoneId, hash, decision?, reason? }.
// v1 memo (`xrlp/attestation/v1`, AttestationPayload) is still written by api.ts attestApproval and decoded here.
import { createHash } from "node:crypto";
import { convertHexToString, convertStringToHex, decode, verifySignature, type Payment, type Wallet } from "xrpl";
import type { AttestMemo } from "@xrlp/shared";
import { getClient, signAndSubmit, submitBlob, type TxResult } from "./client.ts";

// ---------------------------------------------------------------- v2: xrlp/attest/v1

export const ATTEST_MEMO_TYPE = "xrlp/attest/v1";
export const ATTEST_MEMO_FORMAT = "application/json";
export const ATTEST_KINDS = ["audit", "verdict", "decision", "release"] as const;
export type AttestKind = (typeof ATTEST_KINDS)[number];
/** Drops sent with every attestation (the Payment is only a carrier for the memo). */
export const ATTEST_AMOUNT_DROPS = "1";
/** Keep the whole memo well under rippled's 1 KB Memos limit. */
export const ATTEST_MAX_MEMO_BYTES = 900;

/** The shared v2 `AttestMemo` (`hash` = sha256 hex of the audit JSON / verdictHash / decision reason / release decision). */
export type { AttestMemo };

type MemoTx = { Memos?: { Memo: { MemoType?: string; MemoFormat?: string; MemoData?: string } }[] };

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Throws unless `m` is a well-formed AttestMemo. Returns a normalized copy (only known keys, hash lowercased). */
export function validateAttestMemo(m: unknown): AttestMemo {
  const o = m as Partial<AttestMemo> | null;
  if (!o || typeof o !== "object") throw new Error("attest memo: not an object");
  if (o.v !== 1) throw new Error(`attest memo: unsupported version ${String(o.v)}`);
  if (!ATTEST_KINDS.includes(o.kind as AttestKind)) throw new Error(`attest memo: bad kind ${String(o.kind)}`);
  if (typeof o.milestoneId !== "string" || !o.milestoneId) throw new Error("attest memo: milestoneId required");
  if (typeof o.hash !== "string" || !/^[0-9a-fA-F]{64}$/.test(o.hash)) throw new Error("attest memo: hash must be 64-char sha256 hex");
  for (const k of ["decision", "reason"] as const) {
    if (o[k] !== undefined && typeof o[k] !== "string") throw new Error(`attest memo: ${k} must be a string`);
  }
  const out: AttestMemo = { v: 1, kind: o.kind as AttestKind, milestoneId: o.milestoneId, hash: o.hash.toLowerCase() };
  if (o.decision !== undefined) out.decision = o.decision;
  if (o.reason !== undefined) out.reason = o.reason;
  if (Buffer.byteLength(JSON.stringify(out)) > ATTEST_MAX_MEMO_BYTES) throw new Error(`attest memo: > ${ATTEST_MAX_MEMO_BYTES} bytes (shorten reason)`);
  return out;
}

/** The tx `Memos` field for an attestation (hex-encoded). */
export function encodeAttestMemo(memo: AttestMemo): NonNullable<Payment["Memos"]> {
  const body = JSON.stringify(validateAttestMemo(memo));
  return [
    {
      Memo: {
        MemoType: convertStringToHex(ATTEST_MEMO_TYPE),
        MemoFormat: convertStringToHex(ATTEST_MEMO_FORMAT),
        MemoData: convertStringToHex(body),
      },
    },
  ];
}

/** Decode + validate the first `xrlp/attest/v1` memo of a tx JSON (validated tx, tx_json, or decoded blob). */
export function decodeAttestMemo(tx: MemoTx): AttestMemo | undefined {
  for (const m of tx.Memos ?? []) {
    if (!m.Memo.MemoType || !m.Memo.MemoData) continue;
    if (safeHexToString(m.Memo.MemoType) !== ATTEST_MEMO_TYPE) continue;
    try {
      return validateAttestMemo(JSON.parse(convertHexToString(m.Memo.MemoData)));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * UNSIGNED attestation Payment (no Sequence/Fee/LastLedgerSequence). The inspector app autofills and signs it with its
 * software key (attest-signer), or use `prepareAttestTx` to have it autofilled here.
 */
export function buildAttestTx(p: { account: string; spv: string; memo: AttestMemo }): Payment {
  return {
    TransactionType: "Payment",
    Account: p.account,
    Destination: p.spv,
    Amount: ATTEST_AMOUNT_DROPS,
    Memos: encodeAttestMemo(p.memo),
  };
}

/** `buildAttestTx` + autofill (Sequence, Fee, LastLedgerSequence) against devnet: ready to sign offline. */
export async function prepareAttestTx(p: { account: string; spv: string; memo: AttestMemo }): Promise<Payment> {
  const client = await getClient();
  return client.autofill(buildAttestTx(p));
}

/** Sign with a held key and submit. */
export async function submitAttest(signer: Wallet, spv: string, memo: AttestMemo): Promise<TxResult> {
  return signAndSubmit(signer, buildAttestTx({ account: signer.classicAddress, spv, memo }));
}

export interface VerifiedAttestBlob {
  tx: Payment;
  memo: AttestMemo;
  signer: string;
}

/**
 * Offline check that a signed blob is an attestation and nothing else: single-signed Payment of exactly 1 drop,
 * no Paths/SendMax/DeliverMin/flags, exactly one memo of type `xrlp/attest/v1` with a valid AttestMemo, valid
 * signature. Optional `expect` pins the signer / destination (e.g. the assigned inspector and the project SPV).
 */
export function verifyAttestBlob(blob: string, expect: { signer?: string; spv?: string } = {}): VerifiedAttestBlob {
  let tx: Payment & { TxnSignature?: string; SigningPubKey?: string; Signers?: unknown };
  try {
    tx = decode(blob) as unknown as typeof tx;
  } catch (e) {
    throw new Error(`attest blob: not a valid tx blob (${(e as Error).message})`);
  }
  if (tx.TransactionType !== "Payment") throw new Error(`attest blob: expected Payment, got ${tx.TransactionType}`);
  if (tx.Amount !== ATTEST_AMOUNT_DROPS) throw new Error(`attest blob: Amount must be ${ATTEST_AMOUNT_DROPS} drop, got ${JSON.stringify(tx.Amount)}`);
  for (const k of ["Paths", "SendMax", "DeliverMin", "DeliverMax", "DestinationTag", "InvoiceID", "CredentialIDs"] as const) {
    if ((tx as unknown as Record<string, unknown>)[k] !== undefined) throw new Error(`attest blob: unexpected field ${k}`);
  }
  if (tx.Flags) throw new Error(`attest blob: Flags must be 0`);
  if (tx.Signers || !tx.TxnSignature || !tx.SigningPubKey) throw new Error("attest blob: must be single-signed");
  if ((tx.Memos ?? []).length !== 1) throw new Error("attest blob: exactly one memo expected");
  const memo = decodeAttestMemo(tx);
  if (!memo) throw new Error(`attest blob: no valid ${ATTEST_MEMO_TYPE} memo`);
  if (!verifySignature(blob)) throw new Error("attest blob: bad signature");
  if (expect.signer && tx.Account !== expect.signer) throw new Error(`attest blob: signer ${tx.Account} != expected ${expect.signer}`);
  if (expect.spv && tx.Destination !== expect.spv) throw new Error(`attest blob: destination ${tx.Destination} != expected ${expect.spv}`);
  return { tx, memo, signer: tx.Account };
}

/** Verify (see `verifyAttestBlob`) then submit an inspector-app-signed attestation and wait for validation. */
export async function submitSignedAttestBlob(blob: string, expect: { signer?: string; spv?: string } = {}): Promise<TxResult & { memo: AttestMemo; signer: string }> {
  const v = verifyAttestBlob(blob, expect);
  const tx = await submitBlob(blob, "Payment(attest)");
  return { ...tx, memo: v.memo, signer: v.signer };
}

function safeHexToString(hex: string): string | undefined {
  try {
    return convertHexToString(hex);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------- v1 (legacy): xrlp/attestation/v1

export const ATTESTATION_MEMO_TYPE = "xrlp/attestation/v1";

export interface AttestationPayload {
  projectId: string;
  milestoneId: string;
  role: "inspector" | "ai_agent" | "platform";
  decision: "approve" | "reject";
  notes?: string;
  /** sha256 of the AI Verdict JSON (or any evidence bundle digest). */
  verdictHash?: string;
  /** Escrow condition being approved for release (binds the attestation to one escrow). */
  condition?: string;
}

/** @deprecated v1 quorum-model attestation; use `submitAttest` / `attest` (xrlp/attest/v1). */
export async function submitAttestation(signer: Wallet, spv: string, a: AttestationPayload): Promise<TxResult> {
  const body = JSON.stringify({ ...a, notes: (a.notes ?? "").slice(0, 280) });
  return signAndSubmit(signer, {
    TransactionType: "Payment",
    Account: signer.classicAddress,
    Destination: spv,
    Amount: "1",
    Memos: [{ Memo: { MemoType: convertStringToHex(ATTESTATION_MEMO_TYPE), MemoFormat: convertStringToHex("application/json"), MemoData: convertStringToHex(body) } }],
  });
}

/** Decode a v1 attestation memo from a validated tx JSON (for audit views). */
export function decodeAttestation(tx: MemoTx): AttestationPayload | undefined {
  for (const m of tx.Memos ?? []) {
    if (m.Memo.MemoType && safeHexToString(m.Memo.MemoType) === ATTESTATION_MEMO_TYPE && m.Memo.MemoData) {
      return JSON.parse(convertHexToString(m.Memo.MemoData)) as AttestationPayload;
    }
  }
  return undefined;
}

/** Decode either memo version. */
export function decodeAnyAttestation(tx: MemoTx): { version: "attest/v1"; memo: AttestMemo } | { version: "attestation/v1"; payload: AttestationPayload } | undefined {
  const memo = decodeAttestMemo(tx);
  if (memo) return { version: "attest/v1", memo };
  const payload = decodeAttestation(tx);
  return payload ? { version: "attestation/v1", payload } : undefined;
}
