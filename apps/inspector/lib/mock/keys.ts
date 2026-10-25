// Mock-mode inspector keys. The entropy is PUBLIC (sha256 of a fixed label), so these keys are worthless by design: they
// sign attestations the mock verifies, and match the fixture addresses. Never funded, never used on devnet.
import { SoftwareSigner } from "@xrlp/attest-signer";

export const MOCK_KEY_LABELS = ["inspector-dana", "inspector-marcus", "inspector-priya"] as const;

async function fromLabel(label: string): Promise<SoftwareSigner> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`drawproof/mock/${label}`));
  return SoftwareSigner.fromEntropy(new Uint8Array(digest).slice(0, 16));
}

let cache: Promise<Map<string, SoftwareSigner>> | undefined;

/** The mock key for a fixture inspector address, or null for any other address. */
export async function mockSigner(address: string): Promise<SoftwareSigner | null> {
  cache ??= Promise.all(MOCK_KEY_LABELS.map(fromLabel)).then((signers) => new Map(signers.map((s) => [s.wallet.classicAddress, s])));
  return (await cache).get(address) ?? null;
}
