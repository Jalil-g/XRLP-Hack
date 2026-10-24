import { convertHexToString, convertStringToHex, type AccountSet, type Transaction } from "xrpl";

export const ATTESTATION_MEMO_TYPE = "xrlp/attestation/v1";

/**
 * What the inspector approves. Mirrors the signed payload described on `Attestation` in
 * @xrlp/shared (sha256 of {milestoneId, decision, notes, verdictHash}) — here it is put on-chain verbatim
 * so the inspector can READ it on the Ledger screen before approving.
 */
export type AttestationPayload = {
  milestoneId: string;
  decision: "approve" | "reject";
  /** sha256 hex of the AI Verdict JSON the inspector reviewed. */
  verdictHash: string;
  notes?: string;
};

/**
 * The XRP app shows MemoType/MemoFormat/MemoData as text only if every byte is printable ASCII,
 * otherwise as hex. Escape everything else as \uXXXX so the device always shows readable text.
 */
function asciiJson(value: unknown): string {
  return JSON.stringify(value).replace(/[^\x20-\x7e]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

/**
 * A no-op AccountSet from the inspector's own account carrying the attestation as a memo.
 * AccountSet is natively parsed by the Ledger XRP app (no blind signing) and memos are displayed,
 * so the device shows e.g. Memo Data: {"v":1,"milestoneId":"m-3","decision":"approve",...}.
 *
 * Autofill (Fee/Sequence/LastLedgerSequence/NetworkID) before signing.
 */
export function buildAttestationTx(account: string, p: AttestationPayload): AccountSet {
  const data = asciiJson({
    v: 1,
    milestoneId: p.milestoneId,
    decision: p.decision,
    verdictHash: p.verdictHash,
    notes: p.notes ?? "",
  });
  return {
    TransactionType: "AccountSet",
    Account: account,
    Memos: [
      {
        Memo: {
          MemoType: convertStringToHex(ATTESTATION_MEMO_TYPE),
          MemoFormat: convertStringToHex("application/json"),
          MemoData: convertStringToHex(data),
        },
      },
    ],
  };
}

/** Parse an attestation back out of a (validated) transaction, or null if it isn't one. */
export function parseAttestationTx(tx: Transaction): (AttestationPayload & { signer: string }) | null {
  for (const { Memo } of tx.Memos ?? []) {
    if (!Memo.MemoType || convertHexToString(Memo.MemoType) !== ATTESTATION_MEMO_TYPE || !Memo.MemoData) continue;
    const j = JSON.parse(convertHexToString(Memo.MemoData)) as Record<string, unknown>;
    if (j.v !== 1 || (j.decision !== "approve" && j.decision !== "reject")) return null;
    return {
      signer: tx.Account,
      milestoneId: String(j.milestoneId),
      decision: j.decision,
      verdictHash: String(j.verdictHash),
      notes: String(j.notes ?? ""),
    };
  }
  return null;
}
