// Offline (no network): software key signing + multisig combine/verify. Run: pnpm --filter @xrlp/attest-signer test
import { test } from "node:test";
import assert from "node:assert/strict";
import { decode, encode, Wallet, type Payment } from "xrpl";
import { SoftwareSigner, buildAttestationTx, combineMultisig, verifySignedBlob } from "../src/index.ts";

const common = { Fee: "36", Sequence: 7, LastLedgerSequence: 1000 };
const memo = { v: 1 as const, kind: "audit" as const, milestoneId: "m-1", hash: "ab".repeat(32) };

test("signAttestation refuses a tx for another account", async () => {
  const a = new SoftwareSigner(Wallet.generate());
  const other = Wallet.generate().classicAddress;
  await assert.rejects(a.signAttestation({ ...buildAttestationTx({ account: other, spv: other, memo }), ...common }), /not this inspector/);
});

test("fromEntropy is deterministic (mock-mode keys from public labels)", async () => {
  const entropy = new Uint8Array(16).fill(7);
  const a = await SoftwareSigner.fromEntropy(entropy).getAddress();
  const b = await SoftwareSigner.fromEntropy(entropy).getAddress();
  assert.deepEqual(a, b);
  assert.match(a.publicKey, /^ED[0-9A-F]{64}$/); // ed25519 by default
  assert.notEqual((await SoftwareSigner.fromEntropy(entropy, "secp256k1").getAddress()).address, a.address);
});

test("two signers multisign an SPV payment; combined blob verifies", async () => {
  const spv = Wallet.generate().classicAddress;
  const a = new SoftwareSigner(Wallet.generate());
  const b = new SoftwareSigner(Wallet.generate());
  const tx: Payment = { TransactionType: "Payment", Account: spv, Destination: Wallet.generate().classicAddress, Amount: "1000", ...common };
  const combined = combineMultisig([(await a.signForMultisig(tx)).tx_blob, (await b.signForMultisig(tx)).tx_blob]);
  assert.equal(verifySignedBlob(combined).signers.length, 2);
  assert.equal((decode(combined) as { SigningPubKey: string }).SigningPubKey, "");
});

test("tampered multisig blob fails verification", async () => {
  const a = new SoftwareSigner(Wallet.generate());
  const tx: Payment = { TransactionType: "Payment", Account: Wallet.generate().classicAddress, Destination: Wallet.generate().classicAddress, Amount: "1000", ...common };
  const d = decode((await a.signForMultisig(tx)).tx_blob) as Record<string, unknown>;
  assert.throws(() => verifySignedBlob(encode({ ...d, Amount: "999999" } as never)), /bad multisig signature/);
});
