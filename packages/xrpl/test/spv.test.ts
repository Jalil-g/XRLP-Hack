// Offline: v2 SPV signer list + local quorum check + submitMultisigned (lock, fast-fail) over fake network seams.
import assert from "node:assert/strict";
import { test } from "node:test";
import { decode, Wallet, type SubmittableTransaction } from "xrpl";
import { XrplTxError } from "../src/errors.ts";
import { checkSignerQuorum, SPV_QUORUM, spvSignerEntries, submitMultisigned, type MultisigDeps } from "../src/spv.ts";
import { withAccountLock } from "../src/submit.ts";

const S = { platform: "rPlatform", builder: "rBuilder", inspector: "rInspector", trustee: "rTrustee" };
const list = { quorum: SPV_QUORUM, signers: spvSignerEntries(S).map((e) => ({ account: e.SignerEntry.Account, weight: e.SignerEntry.SignerWeight })) };

test("v2 list = platform, builder, inspector, trustee, weight 1 each, quorum 3", () => {
  assert.equal(SPV_QUORUM, 3);
  assert.deepEqual(list.signers, [
    { account: "rPlatform", weight: 1 },
    { account: "rBuilder", weight: 1 },
    { account: "rInspector", weight: 1 },
    { account: "rTrustee", weight: 1 },
  ]);
});

test("duplicate signer accounts rejected", () => {
  assert.throws(() => spvSignerEntries({ ...S, trustee: "rPlatform" }), /distinct/);
});

test("any 3 of 4 reach quorum, 2 do not, no single party can block", () => {
  const all = Object.values(S);
  for (const left of all) assert.equal(checkSignerQuorum(list, all.filter((a) => a !== left)).ok, true, `without ${left}`);
  const two = checkSignerQuorum(list, ["rPlatform", "rBuilder"]);
  assert.deepEqual(two, { ok: false, weight: 2, quorum: 3, unknown: [], duplicates: [] });
  assert.equal(checkSignerQuorum(list, all).ok, true);
});

test("AI key (not on the list) or a duplicate signature never counts", () => {
  const ai = checkSignerQuorum(list, ["rPlatform", "rBuilder", "rAiAgent"]);
  assert.equal(ai.ok, false);
  assert.deepEqual(ai.unknown, ["rAiAgent"]);
  const dup = checkSignerQuorum(list, ["rPlatform", "rPlatform", "rBuilder"]);
  assert.equal(dup.ok, false);
  assert.equal(dup.weight, 2);
  assert.deepEqual(dup.duplicates, ["rPlatform"]);
});

// ── submitMultisigned: lock + local quorum fast-fail (fake network seams) ─────────────────────

const W = { platform: Wallet.generate(), builder: Wallet.generate(), inspector: Wallet.generate(), trustee: Wallet.generate(), ai: Wallet.generate() };
const spvAddr = Wallet.generate().classicAddress;
const onLedger = { signerQuorum: SPV_QUORUM, signers: [W.platform, W.builder, W.inspector, W.trustee].map((w) => ({ account: w.classicAddress, weight: 1 })) };
const pay = (): SubmittableTransaction => ({ TransactionType: "Payment", Account: spvAddr, Destination: W.platform.classicAddress, Amount: "1" });

/** Fake ledger: one Sequence counter for the SPV; "autofill" reads it, the "validated" submit consumes it. */
function fakeLedger() {
  let seq = 100;
  const blobs: Record<string, unknown>[] = [];
  const calls: { account: string; signersCount?: number }[] = [];
  const submitWithSigner: MultisigDeps["submitWithSigner"] = (account, tx, sign, opts = {}) =>
    withAccountLock(account, async () => {
      calls.push({ account, ...(opts.signersCount !== undefined ? { signersCount: opts.signersCount } : {}) });
      const prepared = { ...tx, Sequence: seq, Fee: String(10 * (1 + (opts.signersCount ?? 0))), LastLedgerSequence: 1_000 };
      await new Promise<void>((r) => setImmediate(r)); // network gap between autofill and submit
      const decoded = decode(sign(prepared)) as Record<string, unknown>;
      if (decoded.Sequence !== seq) throw new XrplTxError(tx.TransactionType, "tefPAST_SEQ");
      seq++;
      blobs.push(decoded);
      return { hash: `H${decoded.Sequence}`, explorerUrl: "", result: "tesSUCCESS", tx: decoded, meta: {} };
    });
  return { submitWithSigner, blobs, calls, getSpvInfo: async () => onLedger };
}

test("submitMultisigned: parallel txs for one SPV get contiguous Sequences, each 3-signer multisig", async () => {
  const f = fakeLedger();
  const signers = [W.platform, W.builder, W.trustee];
  const out = await Promise.all(Array.from({ length: 5 }, () => submitMultisigned(pay(), signers, { deps: f })));
  assert.deepEqual(out.map((r) => r.tx.Sequence), [100, 101, 102, 103, 104]);
  for (const b of f.blobs) {
    assert.equal(b.SigningPubKey, "");
    assert.equal((b.Signers as unknown[]).length, 3);
    assert.equal(b.Account, spvAddr);
  }
  assert.deepEqual(f.calls[0], { account: spvAddr, signersCount: 3 });
});

test("submitMultisigned: 2 signers / AI signer fail fast locally, nothing submitted", async () => {
  const f = fakeLedger();
  await assert.rejects(submitMultisigned(pay(), [W.platform, W.builder], { deps: f }), (e: unknown) => e instanceof XrplTxError && /tefBAD_QUORUM/.test(e.engineResult));
  await assert.rejects(submitMultisigned(pay(), [W.platform, W.builder, W.ai], { deps: f }), (e: unknown) => e instanceof XrplTxError && /tefBAD_SIGNATURE/.test(e.engineResult));
  await assert.rejects(
    submitMultisigned(pay(), [W.platform, W.builder, W.trustee], { deps: { ...f, getSpvInfo: async () => ({ signers: [] }) } }),
    (e: unknown) => e instanceof XrplTxError && e.engineResult === "tefNOT_MULTI_SIGNING",
  );
  assert.equal(f.calls.length, 0);
  // checkQuorum: false skips the read and goes straight to submit
  await submitMultisigned(pay(), [W.platform, W.builder], { checkQuorum: false, deps: { ...f, getSpvInfo: async () => assert.fail("no read") } });
  assert.equal(f.calls.length, 1);
});
