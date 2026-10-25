import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { convertStringToHex, decode, encode, hashes, Wallet } from "xrpl";
import {
  ATTEST_MEMO_TYPE,
  ATTESTATION_MEMO_TYPE,
  attestTxFor,
  buildAttestTx,
  decodeAnyAttestation,
  decodeAttestMemo,
  encodeAttestMemo,
  sha256Hex,
  validateAttestMemo,
  verifyAttestBlob,
  type AttestMemo,
} from "../src/attest.ts";
import { credentialTypeFromHex, credentialTypeHex } from "../src/credentials.ts";
import { vaultPrivacyFields } from "../src/vault.ts";

const H = sha256Hex("audit json");
const SPV = "rhemmtSz5vbYkvSv4pSV9d6VZBjGX5B4tU";

test("attest memo round-trips for every kind", () => {
  for (const kind of ["audit", "verdict", "decision", "release"] as const) {
    const memo: AttestMemo = { v: 1, kind, milestoneId: "m1", hash: H, ...(kind === "decision" ? { decision: "approve", reason: "ok" } : {}) };
    const Memos = encodeAttestMemo(memo);
    assert.equal(Memos[0]!.Memo.MemoType, convertStringToHex(ATTEST_MEMO_TYPE));
    assert.deepEqual(decodeAttestMemo({ Memos }), memo);
  }
});

test("validateAttestMemo rejects malformed memos", () => {
  const ok = { v: 1, kind: "audit", milestoneId: "m1", hash: H };
  assert.throws(() => validateAttestMemo({ ...ok, v: 2 }));
  assert.throws(() => validateAttestMemo({ ...ok, kind: "approve" }));
  assert.throws(() => validateAttestMemo({ ...ok, milestoneId: "" }));
  assert.throws(() => validateAttestMemo({ ...ok, hash: "abc" }));
  assert.throws(() => validateAttestMemo({ ...ok, reason: "x".repeat(1000) }));
  assert.deepEqual(validateAttestMemo({ ...ok, hash: H.toUpperCase(), extra: 1 }), ok);
});

test("decodes a real validated devnet attestation tx (decision)", () => {
  const fx = JSON.parse(readFileSync(new URL("./fixtures/devnet-attest-decision-tx.json", import.meta.url), "utf8"));
  assert.deepEqual(decodeAttestMemo(fx.tx_json), {
    v: 1,
    kind: "decision",
    milestoneId: "m1-foundation",
    hash: sha256Hex("operator approved: photo angle mismatch is benign"),
    decision: "approve",
    reason: "photo angle mismatch is benign",
  });
  // Re-encode the validated tx to its signed blob: same hash, and verifyAttestBlob accepts the real signature.
  const { ctid: _c, date: _d, ledger_index: _l, DeliverMax, ...rest } = fx.tx_json;
  const blob = encode({ ...rest, Amount: DeliverMax });
  assert.equal(hashes.hashSignedTx(blob), fx.hash);
  const v = verifyAttestBlob(blob, { signer: fx.tx_json.Account, spv: fx.tx_json.Destination });
  assert.equal(v.memo.kind, "decision");
});

test("decodeAnyAttestation still reads the v1 xrlp/attestation/v1 memo", () => {
  const payload = { projectId: "p", milestoneId: "m1", role: "inspector", decision: "approve" };
  const tx = { Memos: [{ Memo: { MemoType: convertStringToHex(ATTESTATION_MEMO_TYPE), MemoData: convertStringToHex(JSON.stringify(payload)) } }] };
  assert.deepEqual(decodeAnyAttestation(tx), { version: "attestation/v1", payload });
  assert.equal(decodeAttestMemo(tx), undefined);
});

const signed = (w: Wallet, tx: Record<string, unknown>) =>
  w.sign({ Fee: "12", Sequence: 1, LastLedgerSequence: 100, ...tx } as never).tx_blob;

test("verifyAttestBlob: accepts a signed attestation, rejects anything else", () => {
  const w = Wallet.generate();
  const memo: AttestMemo = { v: 1, kind: "audit", milestoneId: "m1", hash: H };
  const base = buildAttestTx({ account: w.classicAddress, spv: SPV, memo }) as unknown as Record<string, unknown>;
  assert.equal(base.Amount, "1");
  assert.equal(base.Sequence, undefined); // unsigned + not autofilled

  const good = signed(w, base);
  assert.equal(verifyAttestBlob(good, { signer: w.classicAddress, spv: SPV }).memo.hash, H);
  assert.throws(() => verifyAttestBlob(good, { spv: "rMiCidC2QvSt5Eqxv7AFxQF2Y3WJX4B6eB" }), /destination/);
  assert.throws(() => verifyAttestBlob(good, { signer: Wallet.generate().classicAddress }), /signer/);

  assert.throws(() => verifyAttestBlob(signed(w, { ...base, Amount: "1000000" })), /Amount/);
  assert.throws(() => verifyAttestBlob(signed(w, { ...base, Amount: { currency: "USD", issuer: SPV, value: "1" } })), /Amount/);
  assert.throws(() => verifyAttestBlob(signed(w, { ...base, Memos: [] })), /memo/);
  assert.throws(() => verifyAttestBlob(signed(w, { ...base, Memos: [...(base.Memos as unknown[]), ...(base.Memos as unknown[])] })), /memo/);
  assert.throws(() => verifyAttestBlob(signed(w, { ...base, TransactionType: "AccountSet", Destination: undefined, Amount: undefined })), /Payment/);
  assert.throws(() => verifyAttestBlob(encode({ ...base, Fee: "12", Sequence: 1 } as never)), /single-signed/);
  // tampered memo after signing -> bad signature
  const tampered = encode({ ...decode(good), Memos: encodeAttestMemo({ ...memo, milestoneId: "m2" }) } as never);
  assert.throws(() => verifyAttestBlob(tampered), /signature/);
});

test("attestTxFor: Payment to the SPV, memo-only AccountSet when attesting to yourself (Payment to self = temREDUNDANT)", () => {
  const w = Wallet.generate();
  const memo: AttestMemo = { v: 1, kind: "decision", milestoneId: "p1:assignment", hash: H, decision: "assign", reason: "rInspector" };
  const pay = attestTxFor({ account: w.classicAddress, spv: SPV, memo }) as unknown as Record<string, unknown>;
  assert.deepEqual([pay.TransactionType, pay.Destination, pay.Amount], ["Payment", SPV, "1"]);
  const self = attestTxFor({ account: w.classicAddress, spv: w.classicAddress, memo }) as unknown as Record<string, unknown>;
  assert.equal(self.TransactionType, "AccountSet");
  assert.equal(self.Account, w.classicAddress);
  for (const k of ["Destination", "Amount", "SetFlag", "ClearFlag", "Flags"]) assert.equal(self[k], undefined, k);
  assert.deepEqual(decodeAttestMemo(self as never), memo);
  // signs + encodes as a valid tx
  assert.equal((decode(signed(w, self)) as { TransactionType: string }).TransactionType, "AccountSet");
});

test("credential type hex + private vault flags", () => {
  assert.equal(credentialTypeHex("KYC_INVESTOR"), "4B59435F494E564553544F52");
  assert.equal(credentialTypeFromHex(credentialTypeHex("VERIFIED_INSPECTOR")), "VERIFIED_INSPECTOR");
  assert.deepEqual(vaultPrivacyFields({}), {});
  assert.deepEqual(vaultPrivacyFields({ domainId: "AB".repeat(32), nonTransferableShares: true }), { Flags: 0x00030000, DomainID: "AB".repeat(32) });
});
