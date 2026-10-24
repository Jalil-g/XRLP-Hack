import { Wallet, type Transaction } from "xrpl";
import type { InspectorSigner, SignedTx, SignerIdentity } from "./types.ts";

/** Inspector key held in memory (xrpl.js Wallet). Dev/CI/fallback — no human-on-device guarantee. */
export class SoftwareSigner implements InspectorSigner {
  readonly kind = "software" as const;
  readonly wallet: Wallet;

  constructor(wallet: Wallet) {
    this.wallet = wallet;
  }

  static fromSeed(seed: string): SoftwareSigner {
    return new SoftwareSigner(Wallet.fromSeed(seed));
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
