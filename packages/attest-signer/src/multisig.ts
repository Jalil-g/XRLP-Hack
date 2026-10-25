import { decode, encodeForMultiSigning, encodeForSigning, multisign, type Transaction } from "xrpl";
import { verify } from "ripple-keypairs";

/** Combine per-signer blobs (from `signForMultisig`) into one submittable multisigned blob. */
export function combineMultisig(blobs: string[]): string {
  return multisign(blobs);
}

/**
 * Offline signature check — no network. Verifies every signature in a signed blob:
 * the single `TxnSignature`, or each entry of `Signers` (multisig). Throws on the first bad one.
 * Useful to fail fast in the UI before submitting, and in tests against Speculos.
 */
export function verifySignedBlob(blob: string): { signers: string[] } {
  const tx = decode(blob) as unknown as Transaction & {
    Signers?: { Signer: { Account: string; SigningPubKey: string; TxnSignature: string } }[];
  };
  const { TxnSignature, Signers, ...rest } = tx;
  if (Signers?.length) {
    for (const { Signer } of Signers) {
      const msg = encodeForMultiSigning(rest as Transaction, Signer.Account);
      if (!verify(msg, Signer.TxnSignature, Signer.SigningPubKey)) {
        throw new Error(`bad multisig signature from ${Signer.Account}`);
      }
    }
    return { signers: Signers.map((s) => s.Signer.Account) };
  }
  if (!TxnSignature || !tx.SigningPubKey) throw new Error("blob is not signed");
  if (!verify(encodeForSigning(rest as Transaction), TxnSignature, tx.SigningPubKey)) {
    throw new Error(`bad signature from ${tx.Account}`);
  }
  return { signers: [tx.Account] };
}
