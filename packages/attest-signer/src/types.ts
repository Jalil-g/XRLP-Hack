import type { Transaction } from "xrpl";

/** Same shape xrpl.js `Wallet.sign()` returns. */
export type SignedTx = { tx_blob: string; hash: string };

export type SignerIdentity = {
  /** Classic XRPL address (r...). */
  address: string;
  /** Uppercase hex public key — what goes into `SigningPubKey`. */
  publicKey: string;
};

/**
 * An inspector's signing key. Direction v2: a software key (`SoftwareSigner`); inspectors hold no release key, they sign
 * audit attestations. (A hardware-wallet backend existed in the v1 spike and is parked: see git history of
 * packages/ledger-signer.)
 *
 * The caller builds + autofills the transaction (Fee, Sequence, LastLedgerSequence) and submits it; the signer only signs.
 */
export interface InspectorSigner {
  readonly kind: "software";

  getAddress(): Promise<SignerIdentity>;

  /**
   * Single-sign a transaction whose `Account` is the inspector itself — the attestation Payment built by
   * `buildAttestationTx()`. Sets `SigningPubKey` and `TxnSignature`.
   */
  signAttestation(tx: Transaction): Promise<SignedTx>;

  /**
   * This inspector's multisig signature for a transaction whose `Account` is the per-project SPV (the inspector is one of its
   * 4 signers). Combine several with `combineMultisig`. Fee must already account for the signer count: autofill(tx, n).
   */
  signForMultisig(tx: Transaction): Promise<SignedTx>;
}
