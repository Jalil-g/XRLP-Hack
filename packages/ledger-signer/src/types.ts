import type { Transaction } from "xrpl";

/** Same shape xrpl.js `Wallet.sign()` returns, so callers can treat both signers identically. */
export type SignedTx = { tx_blob: string; hash: string };

export type SignerIdentity = {
  /** Classic XRPL address (r...). */
  address: string;
  /** Uppercase hex public key — what goes into `SigningPubKey`. */
  publicKey: string;
};

/**
 * Something that needs a human: unlock the device, open the XRP app, review + approve the tx.
 * UIs should show "Check your Ledger" while one of these is pending.
 */
export type DeviceInteraction = {
  /** DMK `UserInteractionRequired` value, e.g. "unlock-device", "confirm-open-app", "sign-transaction". */
  interaction: string;
  /** DMK device-action step, e.g. "signer.xrp.steps.signTransaction". Absent for software signers. */
  step?: string;
};

/**
 * An inspector's signing key. Two implementations:
 * - `SoftwareSigner` (xrpl.js Wallet, seed in memory) — dev/CI/fallback.
 * - `LedgerSigner` (Ledger device via DMK) — the key never leaves the device; the human approves on its screen.
 *
 * The caller builds + autofills the transaction (Fee, Sequence, LastLedgerSequence, NetworkID) and submits it;
 * the signer only signs. Give a human enough time: set LastLedgerSequence ~ current + 150 (~10 min).
 */
export interface InspectorSigner {
  readonly kind: "software" | "ledger";

  /** Address + public key of the inspector key. For Ledger this talks to the device (no on-device prompt). */
  getAddress(): Promise<SignerIdentity>;

  /**
   * Single-sign a transaction whose `Account` is the inspector itself — typically the memo'd attestation
   * built by `buildAttestationTx()`. Sets `SigningPubKey` and `TxnSignature`.
   */
  signAttestation(tx: Transaction): Promise<SignedTx>;

  /**
   * Produce this inspector's multisig signature for a transaction whose `Account` is someone else
   * (the per-project SPV). Returns a blob whose `Signers` array holds exactly this signer —
   * combine several with xrpl.js `multisign([...blobs])` (see `combineMultisig`).
   *
   * Fee must already account for the signer count: autofill(tx, signersCount).
   */
  signForMultisig(tx: Transaction): Promise<SignedTx>;
}
