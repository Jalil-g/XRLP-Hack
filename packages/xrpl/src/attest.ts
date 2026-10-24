// On-chain approval attestations: a 1-drop XRP Payment from the approver to the SPV with a JSON memo.
// Shows up in the SPV's tx history, signed by the approver's own key => auditable "who approved what".
// These are audit records, NOT release keys (release is gated by the inspector-held fulfillment).
import { createHash } from "node:crypto";
import { convertHexToString, convertStringToHex, type Wallet } from "xrpl";
import { signAndSubmit, type TxResult } from "./client.ts";

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

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

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

/** Decode an attestation memo from a validated tx JSON (for audit views). */
export function decodeAttestation(tx: { Memos?: { Memo: { MemoType?: string; MemoData?: string } }[] }): AttestationPayload | undefined {
  for (const m of tx.Memos ?? []) {
    if (m.Memo.MemoType && convertHexToString(m.Memo.MemoType) === ATTESTATION_MEMO_TYPE && m.Memo.MemoData) {
      return JSON.parse(convertHexToString(m.Memo.MemoData)) as AttestationPayload;
    }
  }
  return undefined;
}
