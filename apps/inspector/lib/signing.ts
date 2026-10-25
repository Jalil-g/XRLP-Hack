// INS-04: the inspector signs their audit attestation in this browser with their software key (@xrlp/attest-signer) and route 10
// carries it as `signedTxBlob`; core verifies it (verifyAttestBlob) and submits it. The tx is the XRPL-08 attestation:
// 1-drop Payment inspector → project SPV with memo xrlp/attest/v1 {kind:"audit", milestoneId, hash: auditHash(audit)}.
//
// Keys: mock mode uses the fixtures' public-entropy keys (lib/mock/keys.ts). http mode uses a key the inspector imported into
// this browser (localStorage, devnet only); without one, the audit can still be filed unsigned and core signs with its demo key.
import { SoftwareSigner, auditMemo, buildAttestationTx, type AttestMemo, type AuditForHash } from "@xrlp/attest-signer";
import { Client, type Payment } from "xrpl";
import { API_MODE } from "./api.ts";
import { mockSigner } from "./mock/keys.ts";

export type KeySource = "mock" | "imported";
export type InspectorKey = { signer: SoftwareSigner; source: KeySource };

export type SignedAttestation = {
  blob: string;
  /** Hash of the signed tx: the attestation's tx hash on the ledger once core submits it. */
  txHash: string;
  memo: AttestMemo;
  signer: string;
  spv: string;
};

const KEY_PREFIX = "drawproof.key.";
/** Ledgers of headroom (~4-5 min at ~3.5s/ledger) between signing here and core submitting the blob. */
const LLS_MARGIN = 75;
const WS_URL = process.env.NEXT_PUBLIC_XRPL_WS_URL ?? "wss://s.devnet.rippletest.net:51233";

// ---------------------------------------------------------------- keys

export async function inspectorKey(address: string): Promise<InspectorKey | null> {
  if (API_MODE === "mock") {
    const signer = await mockSigner(address);
    return signer && { signer, source: "mock" };
  }
  const seed = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY_PREFIX + address);
  if (!seed) return null;
  try {
    const signer = SoftwareSigner.fromSeed(seed);
    return signer.wallet.classicAddress === address ? { signer, source: "imported" } : null;
  } catch {
    return null;
  }
}

/** Store a devnet seed for `address` in this browser. Throws if the seed is malformed or belongs to another account. */
export function importKey(address: string, seed: string): void {
  let signer: SoftwareSigner;
  try {
    signer = SoftwareSigner.fromSeed(seed.trim());
  } catch {
    throw new Error("That is not a valid XRPL seed (expected s…).");
  }
  if (signer.wallet.classicAddress !== address) {
    throw new Error(`That seed is for ${signer.wallet.classicAddress}, not this inspector (${address}).`);
  }
  localStorage.setItem(KEY_PREFIX + address, seed.trim());
}

export function forgetKey(address: string): void {
  localStorage.removeItem(KEY_PREFIX + address);
}

// ---------------------------------------------------------------- sign

/** Fee / Sequence / LastLedgerSequence. Mock: fixed values (the mock never submits). http: from devnet. */
async function autofill(tx: Payment): Promise<Payment> {
  if (API_MODE === "mock") return { ...tx, Fee: "12", Sequence: 1, LastLedgerSequence: 100_000_000 };
  const client = new Client(WS_URL);
  await client.connect();
  try {
    const ledger = await client.getLedgerIndex();
    return await client.autofill({ ...tx, LastLedgerSequence: ledger + LLS_MARGIN });
  } finally {
    await client.disconnect();
  }
}

export async function signAuditAttestation(audit: AuditForHash, spv: string, key: InspectorKey): Promise<SignedAttestation> {
  const memo = await auditMemo(audit);
  const tx = await autofill(buildAttestationTx({ account: audit.inspector, spv, memo }));
  const signed = await key.signer.signAttestation(tx);
  return { blob: signed.tx_blob, txHash: signed.hash, memo, signer: audit.inspector, spv };
}
