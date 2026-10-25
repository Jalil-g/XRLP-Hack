// Inspector audit attestations in the XRPL-08 format (packages/xrpl/src/attest.ts, docs/decisions.md): a 1-drop XRP Payment
// from the inspector to the project SPV carrying exactly one memo — MemoType `xrlp/attest/v1`, MemoFormat `application/json`,
// MemoData `{v:1, kind:"audit", milestoneId, hash}`. Core runs `verifyAuditBlob` on the blob before submitting it, so the
// shape here must stay byte-for-byte what that check accepts (test/attestation.test.ts pins it).
// Browser-safe: no Node built-ins (hashing via Web Crypto, which Node also provides).
import { deriveAddress } from "ripple-keypairs";
import { verifySignedBlob } from "./multisig.ts";
import { decode, convertHexToString, convertStringToHex, type Payment, type Transaction } from "xrpl";

export const ATTEST_MEMO_TYPE = "xrlp/attest/v1";
export const ATTEST_MEMO_FORMAT = "application/json";
export const ATTEST_AMOUNT_DROPS = "1";
/** Same cap as packages/xrpl: the memo stays well under rippled's 1 KB Memos limit. */
export const ATTEST_MAX_MEMO_BYTES = 900;

/** Mirrors `AttestMemo` in @xrlp/shared (ports.ts). Key order is the one packages/xrpl writes. */
export type AttestMemo = {
  v: 1;
  kind: "audit" | "verdict" | "decision" | "release";
  milestoneId: string;
  /** sha256 hex of the attested object — for `audit`, `auditHash(audit)`. */
  hash: string;
  decision?: string;
  reason?: string;
};

const KINDS: readonly AttestMemo["kind"][] = ["audit", "verdict", "decision", "release"];

/** Throws unless well-formed; returns a normalized copy (known keys only, hash lowercased) — same rules as packages/xrpl. */
export function validateAttestMemo(m: unknown): AttestMemo {
  const o = m as Partial<AttestMemo> | null;
  if (!o || typeof o !== "object") throw new Error("attest memo: not an object");
  if (o.v !== 1) throw new Error(`attest memo: unsupported version ${String(o.v)}`);
  if (!KINDS.includes(o.kind as AttestMemo["kind"])) throw new Error(`attest memo: bad kind ${String(o.kind)}`);
  if (typeof o.milestoneId !== "string" || !o.milestoneId) throw new Error("attest memo: milestoneId required");
  if (typeof o.hash !== "string" || !/^[0-9a-fA-F]{64}$/.test(o.hash)) throw new Error("attest memo: hash must be 64-char sha256 hex");
  for (const k of ["decision", "reason"] as const) {
    if (o[k] !== undefined && typeof o[k] !== "string") throw new Error(`attest memo: ${k} must be a string`);
  }
  const out: AttestMemo = { v: 1, kind: o.kind as AttestMemo["kind"], milestoneId: o.milestoneId, hash: o.hash.toLowerCase() };
  if (o.decision !== undefined) out.decision = o.decision;
  if (o.reason !== undefined) out.reason = o.reason;
  if (new TextEncoder().encode(JSON.stringify(out)).length > ATTEST_MAX_MEMO_BYTES) {
    throw new Error(`attest memo: > ${ATTEST_MAX_MEMO_BYTES} bytes (shorten reason)`);
  }
  return out;
}

/**
 * UNSIGNED attestation Payment (no Fee / Sequence / LastLedgerSequence): autofill it, then `SoftwareSigner.signAttestation`.
 * Identical to packages/xrpl `buildAttestTx`.
 */
export function buildAttestationTx(p: { account: string; spv: string; memo: AttestMemo }): Payment {
  return {
    TransactionType: "Payment",
    Account: p.account,
    Destination: p.spv,
    Amount: ATTEST_AMOUNT_DROPS,
    Memos: [
      {
        Memo: {
          MemoType: convertStringToHex(ATTEST_MEMO_TYPE),
          MemoFormat: convertStringToHex(ATTEST_MEMO_FORMAT),
          MemoData: convertStringToHex(JSON.stringify(validateAttestMemo(p.memo))),
        },
      },
    ],
  };
}

/** The attestation in a (decoded / validated) tx, or null if it carries no valid `xrlp/attest/v1` memo. */
export function parseAttestationTx(tx: Transaction): (AttestMemo & { signer: string; destination?: string }) | null {
  for (const { Memo } of tx.Memos ?? []) {
    if (!Memo.MemoType || !Memo.MemoData) continue;
    try {
      if (convertHexToString(Memo.MemoType) !== ATTEST_MEMO_TYPE) continue;
      const memo = validateAttestMemo(JSON.parse(convertHexToString(Memo.MemoData)));
      return { ...memo, signer: tx.Account, destination: tx.TransactionType === "Payment" ? tx.Destination : undefined };
    } catch {
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------- what an audit attestation commits to

/** The audit fields the inspector signs. Structural, so this package does not depend on @xrlp/shared. */
export type AuditForHash = {
  milestoneId: string;
  inspector: string;
  evidenceBundleHash: string;
  checklist: readonly { sovCode: string; status: string; note?: string }[];
  notes: string;
  /** Only each photo's `sha256` is committed to: core re-derives ids / uris / EXIF from the uploaded bytes. */
  photos: readonly { sha256: string }[];
};

/**
 * The canonical form of an audit for its attestation hash. It covers exactly what core receives and keeps from route 10
 * (`report.{inspector, evidenceBundleHash, checklist, notes}`, the route's milestone, and the uploaded photo bytes) and
 * nothing core assigns (`txHash`, `at`, photo ids). Order-independent where the data is a set: checklist sorted by sovCode,
 * photos as sorted sha256s. Empty / whitespace-only notes are dropped, strings trimmed.
 * Proposed as the shared definition on issue #53 so core can recompute it and compare with the memo's `hash`.
 */
export function canonicalAudit(a: AuditForHash) {
  return {
    v: 1,
    milestoneId: a.milestoneId,
    inspector: a.inspector,
    evidenceBundleHash: a.evidenceBundleHash.toLowerCase(),
    checklist: [...a.checklist]
      .sort((x, y) => (x.sovCode < y.sovCode ? -1 : x.sovCode > y.sovCode ? 1 : 0))
      .map((c) => (c.note?.trim() ? { sovCode: c.sovCode, status: c.status, note: c.note.trim() } : { sovCode: c.sovCode, status: c.status })),
    notes: a.notes.trim(),
    photos: a.photos.map((p) => p.sha256.toLowerCase()).sort(),
  };
}

/** JSON with object keys sorted at every level, no whitespace: one byte string per value. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** `hash` in the audit attestation memo: sha256 of `canonicalJson(canonicalAudit(audit))`. */
export function auditHash(audit: AuditForHash): Promise<string> {
  return sha256Hex(canonicalJson(canonicalAudit(audit)));
}

/** The memo an inspector signs for an audit. */
export async function auditMemo(audit: AuditForHash): Promise<AttestMemo> {
  return { v: 1, kind: "audit", milestoneId: audit.milestoneId, hash: await auditHash(audit) };
}

/** Offline validation of the exact inspector-app transaction, before any ledger submission.
 * Supports the app's single master-key signatures. Regular keys need ledger authorization lookup.
 */
export async function verifyAuditBlob(blob: string, audit: AuditForHash, spv: string): Promise<void> {
  const tx = decode(blob) as unknown as Payment;
  const allowed = new Set(["TransactionType", "Account", "Destination", "Amount", "Memos", "Fee", "Sequence", "LastLedgerSequence", "SigningPubKey", "TxnSignature", "Flags", "NetworkID"]);
  if (Object.keys(tx).some((key) => !allowed.has(key))) throw new Error("audit blob: unexpected transaction field");
  if (tx.TransactionType !== "Payment" || tx.Amount !== ATTEST_AMOUNT_DROPS || tx.Flags)
    throw new Error("audit blob: expected a plain one-drop Payment");
  if (tx.Account !== audit.inspector || tx.Destination !== spv)
    throw new Error("audit blob: inspector or project destination mismatch");
  if (!tx.SigningPubKey || deriveAddress(tx.SigningPubKey) !== audit.inspector)
    throw new Error("audit blob: signature must use the inspector's master key");
  verifySignedBlob(blob);
  if (!tx.LastLedgerSequence || !tx.Sequence || !tx.Fee || !/^\d+$/.test(tx.Fee) || BigInt(tx.Fee) <= 0n)
    throw new Error("audit blob: Fee, Sequence and LastLedgerSequence required");
  const m = tx.Memos?.[0]?.Memo;
  if (tx.Memos?.length !== 1 || !m?.MemoType || !m.MemoFormat || !m.MemoData ||
      convertHexToString(m.MemoType) !== ATTEST_MEMO_TYPE || convertHexToString(m.MemoFormat) !== ATTEST_MEMO_FORMAT)
    throw new Error("audit blob: exactly one audit memo required");
  const memo = validateAttestMemo(JSON.parse(convertHexToString(m.MemoData)));
  if (memo.kind !== "audit" || memo.milestoneId !== audit.milestoneId || memo.hash !== await auditHash(audit))
    throw new Error("audit blob: memo does not commit to this report and its uploaded photos");
}
