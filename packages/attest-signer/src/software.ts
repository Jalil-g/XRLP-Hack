import { Wallet, type ECDSA, type Transaction } from "xrpl";
import type { InspectorSigner, SignedTx, SignerIdentity } from "./types.ts";

/** Inspector key held in memory (xrpl.js Wallet). */
export class SoftwareSigner implements InspectorSigner {
  readonly kind = "software" as const;
  readonly wallet: Wallet;

  constructor(wallet: Wallet) {
    this.wallet = wallet;
  }

  static fromSeed(seed: string): SoftwareSigner {
    return new SoftwareSigner(Wallet.fromSeed(seed));
  }

  /** Deterministic key from 16 bytes of entropy (ed25519 by default) — used for mock-mode keys derived from public labels. */
  static fromEntropy(entropy: Uint8Array, algorithm: "ed25519" | "secp256k1" = "ed25519"): SoftwareSigner {
    // xrpl.js's `ECDSA` enum is type-only under ESM interop; its values are these strings.
    const ecdsa = (algorithm === "ed25519" ? "ed25519" : "ecdsa-secp256k1") as ECDSA;
    return new SoftwareSigner(Wallet.fromEntropy(entropy, { algorithm: ecdsa }));
  }

  async getAddress(): Promise<SignerIdentity> {
    return { address: this.wallet.classicAddress, publicKey: this.wallet.publicKey.toUpperCase() };
  }

  async signAttestation(tx: Transaction): Promise<SignedTx> {
    if (tx.Account !== this.wallet.classicAddress) {
      throw new Error(`signAttestation: tx.Account ${tx.Account} is not this inspector (${this.wallet.classicAddress})`);
    }
    return this.wallet.sign(tx);
  }

  async signForMultisig(tx: Transaction): Promise<SignedTx> {
    return this.wallet.sign(tx, true);
  }
}
