// Audit attestations: the XRPL-08 Payment format (parity with packages/xrpl, the code core runs) + the canonical audit hash.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { decode, encode, Wallet } from "xrpl";
import { buildAttestTx, verifyAttestBlob } from "@xrlp/xrpl";
import {
  ATTEST_MEMO_TYPE,
  SoftwareSigner,
  auditHash,
  auditMemo,
  buildAttestationTx,
  canonicalJson,
  parseAttestationTx,
  validateAttestMemo,
  verifySignedBlob,
  type AuditForHash,
} from "../src/index.ts";

const common = { Fee: "12", Sequence: 41, LastLedgerSequence: 9000 };
const audit: AuditForHash = {
  milestoneId: "maple-st-duplex:m1",
  inspector: "", // set per test
  evidenceBundleHash: "B47B3ECA9FC519229EB8EF082426353DE50AD7EA1BC11FF2E1967257741B168C",
  checklist: [
    { sovCode: "03-300", status: "partial", note: " Slab edge unfinished " },
    { sovCode: "02-100", status: "done", note: "" },
    { sovCode: "03-100", status: "done" },
  ],
  notes: " Walls plumb. ",
  photos: [{ sha256: "9966c46196a62243c6407b9948caa1c0f93c93106a8cdf6cdec1168ed10679e0" }, { sha256: "c915db7e1aed16ec4ba00f980be324666aea4b87d53a44873c8c62b55ddc72a3" }],
};

test("unsigned tx is identical to packages/xrpl buildAttestTx", async () => {
  const account = Wallet.generate().classicAddress;
  const spv = Wallet.generate().classicAddress;
  const memo = await auditMemo({ ...audit, inspector: account });
  assert.deepEqual(buildAttestationTx({ account, spv, memo }), buildAttestTx({ account, spv, memo }));
});

test("a SoftwareSigner-signed audit attestation passes core's verifyAttestBlob (signer + SPV pinned)", async () => {
  const inspector = new SoftwareSigner(Wallet.generate());
  const { address } = await inspector.getAddress();
  const spv = Wallet.generate().classicAddress;
  const memo = await auditMemo({ ...audit, inspector: address });
  const signed = await inspector.signAttestation({ ...buildAttestationTx({ account: address, spv, memo }), ...common });

  const v = verifyAttestBlob(signed.tx_blob, { signer: address, spv });
  assert.deepEqual(v.memo, memo);
  assert.equal(v.signer, address);
  assert.deepEqual(verifySignedBlob(signed.tx_blob).signers, [address]);
  assert.deepEqual(parseAttestationTx(decode(signed.tx_blob) as never), { ...memo, signer: address, destination: spv });
});

test("core's check rejects a tampered attestation", async () => {
  const inspector = new SoftwareSigner(Wallet.generate());
  const { address } = await inspector.getAddress();
  const spv = Wallet.generate().classicAddress;
  const signed = await inspector.signAttestation({ ...buildAttestationTx({ account: address, spv, memo: await auditMemo({ ...audit, inspector: address }) }), ...common });
  const tampered = encode({ ...(decode(signed.tx_blob) as Record<string, unknown>), Amount: "2" } as never);
  assert.throws(() => verifyAttestBlob(tampered), /Amount must be 1 drop/);
  assert.throws(() => verifyAttestBlob(signed.tx_blob, { spv: Wallet.generate().classicAddress }), /destination/);
});

test("memo validation matches packages/xrpl: bad hash / kind rejected, hash lowercased", () => {
  assert.throws(() => validateAttestMemo({ v: 1, kind: "audit", milestoneId: "m", hash: "xyz" }), /64-char/);
  assert.throws(() => validateAttestMemo({ v: 1, kind: "approve", milestoneId: "m", hash: "a".repeat(64) }), /bad kind/);
  assert.equal(validateAttestMemo({ v: 1, kind: "audit", milestoneId: "m", hash: "A".repeat(64) }).hash, "a".repeat(64));
  assert.equal(parseAttestationTx({ TransactionType: "AccountSet", Account: "r", Memos: [] } as never), null);
  assert.equal(ATTEST_MEMO_TYPE, "xrlp/attest/v1");
});

test("auditHash = sha256(canonicalJson(canonical audit)): golden string", async () => {
  const a = { ...audit, inspector: "rDFTQYuGTApAjDhn7Jd3PxWsWhYtJ3RgVN" };
  const expected =
    '{"checklist":[{"sovCode":"02-100","status":"done"},{"sovCode":"03-100","status":"done"},{"note":"Slab edge unfinished","sovCode":"03-300","status":"partial"}],' +
    '"evidenceBundleHash":"b47b3eca9fc519229eb8ef082426353de50ad7ea1bc11ff2e1967257741b168c","inspector":"rDFTQYuGTApAjDhn7Jd3PxWsWhYtJ3RgVN",' +
    '"milestoneId":"maple-st-duplex:m1","notes":"Walls plumb.",' +
    '"photos":["9966c46196a62243c6407b9948caa1c0f93c93106a8cdf6cdec1168ed10679e0","c915db7e1aed16ec4ba00f980be324666aea4b87d53a44873c8c62b55ddc72a3"],"v":1}';
  assert.equal(await auditHash(a), createHash("sha256").update(expected).digest("hex"));
});

test("auditHash ignores order, whitespace and core-assigned fields; changes with any signed content", async () => {
  const base = { ...audit, inspector: "rDFTQYuGTApAjDhn7Jd3PxWsWhYtJ3RgVN" };
  const h = await auditHash(base);
  const shuffled = { ...base, checklist: [...base.checklist].reverse(), photos: [...base.photos].reverse(), notes: "Walls plumb." };
  assert.equal(await auditHash(shuffled), h);
  assert.equal(await auditHash({ ...base, txHash: "AB".repeat(32), at: "2026-10-25T10:00:00Z", extra: 1 } as AuditForHash), h);
  for (const changed of [
    { ...base, notes: "Walls not plumb." },
    { ...base, checklist: base.checklist.map((c) => (c.sovCode === "03-300" ? { ...c, status: "done" } : c)) },
    { ...base, photos: base.photos.slice(1) },
    { ...base, evidenceBundleHash: "0".repeat(64) },
    { ...base, milestoneId: "maple-st-duplex:m2" },
  ]) assert.notEqual(await auditHash(changed), h);
});

test("canonicalJson sorts keys at every level and drops undefined", () => {
  assert.equal(canonicalJson({ b: [{ d: 1, c: undefined, a: "x" }], a: null }), '{"a":null,"b":[{"a":"x","d":1}]}');
});
