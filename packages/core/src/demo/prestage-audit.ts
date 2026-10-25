// Assigned-inspector signing for prestage only. Resolving keys and preparing a tx are injected in offline tests.
import { SoftwareSigner, auditMemo, verifyAuditBlob, type AuditForHash, type InspectorSigner } from "@xrlp/attest-signer";
import { loadWallets, prepareAttestTx } from "@xrlp/xrpl";
import { DomainError } from "../errors.ts";

export interface PrestageAuditSigner {
  checkInspector(address: string): Promise<void>;
  sign(audit: AuditForHash, spv: string): Promise<string>;
}

export function createPrestageAuditSigner(
  resolveInspector: (address: string) => Promise<InspectorSigner>,
  prepare: typeof prepareAttestTx = prepareAttestTx,
): PrestageAuditSigner {
  const get = async (address: string) => {
    try {
      const signer = await resolveInspector(address);
      if ((await signer.getAddress()).address !== address) throw new Error("identity mismatch");
      return signer;
    } catch {
      throw new DomainError("VALIDATION", "Assigned prestage inspector signing key is unavailable or mismatched");
    }
  };
  return {
    checkInspector: async (address) => { await get(address); },
    async sign(audit, spv) {
      const signer = await get(audit.inspector);
      const tx = await prepare({ account: audit.inspector, spv, memo: await auditMemo(audit) });
      const signed = await signer.signAttestation(tx);
      await verifyAuditBlob(signed.tx_blob, audit, spv);
      return signed.tx_blob;
    },
  };
}

/** Uses only existing assigned inspector roles in the adapter's configured wallet store; never creates keys. */
export function devnetPrestageAuditSigner(): PrestageAuditSigner {
  return createPrestageAuditSigner(async (address) => {
    const wallets = loadWallets();
    const wallet = [wallets.inspector1, wallets.inspector2, wallets.inspector3].find((w) => w.classicAddress === address);
    if (!wallet) throw new Error("assigned inspector not in wallet store");
    return new SoftwareSigner(wallet);
  });
}
