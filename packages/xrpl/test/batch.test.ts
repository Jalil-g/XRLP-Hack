// Offline: XRPL-13 Batch builder (shape, flags, fee, inner ordering, BatchSigners). Mirrors the devnet run in
// docs/xrpl-protocol-notes.md §2d (fee 8 drops for 3 × EscrowCreate, SPV outer multisigned 3/4).
import assert from "node:assert/strict";
import { test } from "node:test";
import { combineBatchSigners, decode, hashes, verifySignature, Wallet, type Batch, type Payment } from "xrpl";
import {
  assignInnerSequences,
  BATCH_MAX_INNER,
  batchFee,
  buildBatch,
  compareAccounts,
  innerLoanSetTx,
  innerTxHash,
  mergeBatchSigners,
  requiredBatchSigners,
  signBatchFor,
  signPreparedBatch,
  TF_ALL_OR_NOTHING,
  TF_INNER_BATCH_TXN,
  toInnerTx,
} from "../src/batch.ts";
import { generateMilestoneCondition } from "../src/condition.ts";

const seed = (n: number) => Wallet.fromEntropy(Uint8Array.from({ length: 16 }, (_, i) => (i * 7 + n) & 0xff));
const platform = seed(1);
const builder = seed(2);
const inspector = seed(3);
const trustee = seed(4);
const spvWallet = seed(5);
const SPV = spvWallet.classicAddress;
const ISSUER = seed(6).classicAddress;
const quorum = [platform, builder, inspector];
const usd = (value: string) => ({ currency: "524C555344000000000000000000000000000000", issuer: ISSUER, value });

const escrow = (amount: string) => ({
  TransactionType: "EscrowCreate" as const,
  Account: SPV,
  Destination: builder.classicAddress,
  Amount: usd(amount),
  Condition: generateMilestoneCondition().condition,
  CancelAfter: 900_000_000,
});

const facts = { outerSequence: 100, nextSequence: { [SPV]: 100 }, baseDrops: 1, lastLedgerSequence: 5_000 };

test("toInnerTx: tfInnerBatchTxn, Fee 0, empty SigningPubKey, no signatures / LastLedgerSequence; keeps own flags", () => {
  const inner = toInnerTx({ ...escrow("1"), Flags: 0x10, Fee: "12", LastLedgerSequence: 9, TxnSignature: "AB" } as never) as unknown as Record<string, unknown>;
  assert.equal(inner.Flags, (0x10 | TF_INNER_BATCH_TXN) >>> 0);
  assert.equal(inner.Fee, "0");
  assert.equal(inner.SigningPubKey, "");
  for (const k of ["LastLedgerSequence", "TxnSignature", "Signers", "CounterpartySignature"]) assert.equal(k in inner, false, k);
  assert.equal(TF_INNER_BATCH_TXN, 0x40000000);
});

test("buildBatch: tfAllOrNothing by default, 2..8 inner txs", () => {
  const b = buildBatch({ account: SPV, inners: [escrow("1"), escrow("2")] });
  assert.equal(b.TransactionType, "Batch");
  assert.equal(b.Flags, TF_ALL_OR_NOTHING);
  assert.equal(TF_ALL_OR_NOTHING, 0x00010000);
  assert.equal(b.RawTransactions.length, 2);
  assert.throws(() => buildBatch({ account: SPV, inners: [escrow("1")] }), /2\.\.8/);
  assert.throws(() => buildBatch({ account: SPV, inners: Array.from({ length: BATCH_MAX_INNER + 1 }, (_, i) => escrow(String(i + 1))) }), /2\.\.8/);
});

test("inner Sequences: outer account inners start at outer+1, others at their own next, order preserved", () => {
  const other = platform.classicAddress;
  const pay: Payment = { TransactionType: "Payment", Account: other, Destination: SPV, Amount: "1" };
  const out = assignInnerSequences([escrow("1"), pay, escrow("2"), pay], { account: SPV, sequence: 100 }, { [SPV]: 100, [other]: 40 });
  assert.deepEqual(out.map((t) => (t as { Sequence?: number }).Sequence), [101, 40, 102, 41]);
  assert.throws(() => assignInnerSequences([pay], { account: SPV, sequence: 1 }, {}), /no next Sequence/);
});

test("batchFee matches rippled: base + base×(1+outerSigners) + Σinner + base×batchSignatures", () => {
  // devnet run: SPV outer multisigned by 3, 3 × EscrowCreate, no BatchSigners -> 8 drops (observed on-ledger)
  assert.equal(batchFee({ baseDrops: 1, innerCount: 3, outerSigners: 3 }), "8");
  // platform single-sig outer, 2 inners from the SPV, SPV signs via 3 nested signers -> 1+1+2+3 = 7
  assert.equal(batchFee({ baseDrops: 1, innerCount: 2, batchSignatures: 3 }), "7");
  assert.equal(batchFee({ baseDrops: 10, innerCount: 2 }), "40");
});

test("requiredBatchSigners: inner Accounts + Counterparty, minus the outer Account, sorted by AccountID", () => {
  const loan = innerLoanSetTx({
    brokerOwner: platform,
    loanBrokerId: "AB".repeat(32),
    borrower: SPV,
    principal: "1000",
    interestRate: 10_000,
    paymentTotal: 2,
    paymentIntervalS: 120,
  });
  assert.equal(loan.Counterparty, SPV);
  assert.equal("CounterpartySignature" in loan, false);
  assert.deepEqual(requiredBatchSigners(platform.classicAddress, [loan, escrow("1")]), [SPV]);
  assert.deepEqual(requiredBatchSigners(SPV, [escrow("1"), escrow("2")]), []);
  const both = requiredBatchSigners(trustee.classicAddress, [loan]);
  assert.deepEqual(both, [platform.classicAddress, SPV].sort(compareAccounts));
});

test("mergeBatchSigners keeps every multisig signer (xrpl.js combineBatchSigners drops all but the first)", () => {
  const b = buildBatch({ account: platform.classicAddress, inners: [escrow("1"), escrow("2")] });
  const prepared: Batch = { ...b, Sequence: 7, Fee: "10", LastLedgerSequence: 99, RawTransactions: assignInnerSequences(b.RawTransactions.map((r) => r.RawTransaction), { account: platform.classicAddress, sequence: 7 }, { [SPV]: 50 }).map((RawTransaction) => ({ RawTransaction })) };
  const fragments = quorum.map((w) => signBatchFor(prepared, SPV, [w]));
  const merged = mergeBatchSigners(fragments);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]!.BatchSigner.Account, SPV);
  const nested = merged[0]!.BatchSigner.Signers!.map((s) => s.Signer.Account);
  assert.deepEqual(nested, quorum.map((w) => w.classicAddress).sort(compareAccounts));

  // The upstream bug this works around:
  const upstream = decode(combineBatchSigners(fragments.map((f) => ({ ...prepared, BatchSigners: [f] })))) as unknown as Batch;
  assert.equal(upstream.BatchSigners![0]!.BatchSigner.Signers!.length, 1);
});

test("signBatchFor: signatures bind the inner tx ids and the outer Sequence", () => {
  const b = buildBatch({ account: platform.classicAddress, inners: [escrow("1"), escrow("2")] });
  const prepared: Batch = { ...b, Sequence: 7, Fee: "10", LastLedgerSequence: 99, RawTransactions: b.RawTransactions.map((r, i) => ({ RawTransaction: { ...r.RawTransaction, Sequence: 50 + i } })) };
  const sigs = (tx: Batch) => signBatchFor(tx, SPV, quorum).BatchSigner.Signers!.map((s) => s.Signer.TxnSignature);
  const base = sigs(prepared);
  assert.equal(new Set(base).size, 3);
  assert.notDeepEqual(sigs({ ...prepared, Sequence: 8 }), base);
  const changed = structuredClone(prepared);
  (changed.RawTransactions[1]!.RawTransaction as { Amount: unknown }).Amount = usd("3");
  assert.notDeepEqual(sigs(changed), base);
  // LastLedgerSequence / Fee are NOT bound: the outer submitter can re-fee without new BatchSigners (XLS-56 §6).
  assert.deepEqual(sigs({ ...prepared, Fee: "20", LastLedgerSequence: 120 }), base);
  // single-sig BatchSigner when the account signs with its own key
  const pay: Payment = { TransactionType: "Payment", Account: platform.classicAddress, Destination: SPV, Amount: "1", Sequence: 3 };
  const withPlatform: Batch = { ...prepared, Account: trustee.classicAddress, RawTransactions: [prepared.RawTransactions[0]!, { RawTransaction: toInnerTx(pay) }] };
  const single = signBatchFor(withPlatform, platform.classicAddress, [platform]).BatchSigner;
  assert.equal(single.SigningPubKey, platform.publicKey);
  assert.equal(single.Signers, undefined);
});

test("signPreparedBatch (escrows mode): SPV outer multisigned, inner order = milestone order, seqs outer+1.., fee", () => {
  const inners = [escrow("330"), escrow("330"), escrow("330")];
  const { batch, blob, hash } = signPreparedBatch({ account: SPV, outerSigner: { multisig: quorum }, inners }, facts);
  assert.equal(batch.Fee, "8");
  assert.equal(batch.Sequence, 100);
  assert.equal(batch.LastLedgerSequence, 5_000);
  assert.equal(batch.BatchSigners, undefined);
  assert.deepEqual(batch.RawTransactions.map((r) => r.RawTransaction.Sequence), [101, 102, 103]);
  batch.RawTransactions.forEach((r, i) => {
    const t = r.RawTransaction as unknown as Record<string, unknown>;
    assert.equal(t.Fee, "0");
    assert.equal(t.SigningPubKey, "");
    assert.equal(((t.Flags as number) & TF_INNER_BATCH_TXN) !== 0, true);
    assert.equal((t as { Condition: string }).Condition, (inners[i] as { Condition: string }).Condition);
  });
  const decoded = decode(blob) as unknown as Batch & { Signers: unknown[]; SigningPubKey: string };
  assert.equal(decoded.Signers.length, 3);
  assert.equal(decoded.SigningPubKey, "");
  assert.equal(hash, hashes.hashSignedTx(blob));
  assert.equal(innerTxHash(batch.RawTransactions[0]!.RawTransaction).length, 64);
});

test("signPreparedBatch (full mode): platform outer single-sig, LoanSet first, SPV BatchSigner with 3 nested signers", () => {
  const loan = innerLoanSetTx({ brokerOwner: platform, loanBrokerId: "AB".repeat(32), borrower: SPV, principal: "1000", interestRate: 10_000, paymentTotal: 2, paymentIntervalS: 120 });
  const f = { ...facts, outerSequence: 30, nextSequence: { [platform.classicAddress]: 30, [SPV]: 100 } };
  const { batch, blob } = signPreparedBatch(
    { account: platform.classicAddress, outerSigner: { single: platform }, inners: [loan, escrow("400"), escrow("400")], batchSigners: { [SPV]: quorum } },
    f,
  );
  assert.equal(batch.RawTransactions[0]!.RawTransaction.TransactionType, "LoanSet");
  assert.deepEqual(batch.RawTransactions.map((r) => r.RawTransaction.Sequence), [31, 100, 101]);
  assert.equal(batch.Fee, batchFee({ baseDrops: 1, innerCount: 3, batchSignatures: 3 }));
  assert.equal(batch.BatchSigners!.length, 1);
  assert.equal(batch.BatchSigners![0]!.BatchSigner.Signers!.length, 3);
  assert.ok(verifySignature(blob));
});

test("signPreparedBatch: missing / extra BatchSigners fail locally as temBAD_SIGNER", () => {
  const loan = innerLoanSetTx({ brokerOwner: platform, loanBrokerId: "AB".repeat(32), borrower: SPV, principal: "1000", interestRate: 10_000, paymentTotal: 2, paymentIntervalS: 120 });
  const f = { ...facts, nextSequence: { [platform.classicAddress]: 30, [SPV]: 100 } };
  assert.throws(() => signPreparedBatch({ account: platform.classicAddress, outerSigner: { single: platform }, inners: [loan, escrow("1")] }, f), /temBAD_SIGNER.*missing/);
  assert.throws(
    () => signPreparedBatch({ account: SPV, outerSigner: { multisig: quorum }, inners: [escrow("1"), escrow("2")], batchSigners: { [trustee.classicAddress]: [trustee] } }, facts),
    /temBAD_SIGNER.*extra/,
  );
});
