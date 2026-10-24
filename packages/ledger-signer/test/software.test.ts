// Offline tests (no network, no device). Run: pnpm --filter @xrlp/ledger-signer test
import { test } from "node:test";
import assert from "node:assert/strict";
import { decode, Wallet, type Payment } from "xrpl";
import {
  SoftwareSigner,
  buildAttestationTx,
  parseAttestationTx,
  combineMultisig,
  verifySignedBlob,
} from "../src/index.ts";

const common = { Fee: "36", Sequence: 7, LastLedgerSequence: 1000, NetworkID: 2 };

test("attestation round-trips and verifies (single-sign)", async () => {
  const inspector = new SoftwareSigner(Wallet.generate());
  const { address } = await inspector.getAddress();
  const tx = {
    ...buildAttestationTx(address, { milestoneId: "m-3", decision: "approve", verdictHash: "ab".repeat(32), notes: "Framing ok — café" }),
    ...common,
  };
  const signed = await inspector.signAttestation(tx);
  assert.deepEqual(verifySignedBlob(signed.tx_blob).signers, [address]);
  const parsed = parseAttestationTx(decode(signed.tx_blob) as never);
  assert.equal(parsed?.decision, "approve");
  assert.equal(parsed?.notes, "Framing ok — café");
  // MemoData must be pure printable ASCII so the Ledger screen shows text, not hex.
  const memoHex = tx.Memos![0]!.Memo.MemoData!;
  assert.match(Buffer.from(memoHex, "hex").toString("latin1"), /^[\x20-\x7e]+$/);
});

test("signAttestation refuses a tx for another account", async () => {
  const a = new SoftwareSigner(Wallet.generate());
  const other = Wallet.generate().classicAddress;
  await assert.rejects(a.signAttestation({ ...buildAttestationTx(other, { milestoneId: "m", decision: "approve", verdictHash: "00" }), ...common }));
});

test("two inspectors multisign an SPV payment; combined blob verifies", async () => {
  const spv = Wallet.generate().classicAddress;
  const a = new SoftwareSigner(Wallet.generate());
  const b = new SoftwareSigner(Wallet.generate());
  const tx: Payment = { TransactionType: "Payment", Account: spv, Destination: Wallet.generate().classicAddress, Amount: "1000", ...common };
  const blobs = [(await a.signForMultisig(tx)).tx_blob, (await b.signForMultisig(tx)).tx_blob];
  const combined = combineMultisig(blobs);
  const { signers } = verifySignedBlob(combined);
  assert.equal(signers.length, 2);
  assert.equal((decode(combined) as { SigningPubKey: string }).SigningPubKey, "");
});

test("tampered multisig blob fails verification", async () => {
  const a = new SoftwareSigner(Wallet.generate());
  const tx: Payment = { TransactionType: "Payment", Account: Wallet.generate().classicAddress, Destination: Wallet.generate().classicAddress, Amount: "1000", ...common };
  const d = decode((await a.signForMultisig(tx)).tx_blob) as Record<string, unknown>;
  const { encode } = await import("xrpl");
  const tampered = encode({ ...d, Amount: "999999" } as never);
  assert.throws(() => verifySignedBlob(tampered), /bad multisig signature/);
});
