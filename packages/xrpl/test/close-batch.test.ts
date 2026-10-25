// Offline: XRPL-13b atomic escrows in the close path + recovery (resumeEscrowCreation).
// Recorded devnet data (scripts/capture-batch-fixtures.ts): from the XRPL-13 spike (docs/xrpl-protocol-notes.md §2d) a
// rolled-back Payment Batch (C), an applied 3 × EscrowCreate Batch (E2) and its SPV's history; from the XRPL-13b spike
// (§2e) the rolled-back 3 × EscrowCreate Batch of project B (the SPV's RLUSD line was frozen after LoanSet).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { explorerTxUrl, LedgerError, type Project } from "@xrlp/shared";
import { Wallet, type Batch } from "xrpl";
import { resumeEscrowCreation, type ResumeDeps } from "../src/api.ts";
import {
  BATCH_MAX_INNER,
  BATCH_MIN_INNER,
  BatchNotAppliedError,
  batchOutcome,
  classifyInnerLookup,
  closeLoanAtomic,
  closePartialError,
  createEscrowsAtomic,
  isInnerLoanSetUnsupported,
  escrowsFromBatch,
  innerTxHash,
  isUncertainSubmitFailure,
  type AtomicEscrow,
  type AtomicMilestone,
  type BatchResult,
  type CloseLoanAtomicDeps,
  type InnerLookup,
  type SubmitBatchParams,
} from "../src/batch.ts";
import type { TxResult } from "../src/client.ts";
import type { CreatedEscrow, CreateEscrowParams } from "../src/escrow.ts";
import { XrplTxError } from "../src/errors.ts";
import type { LoanEntry } from "../src/loan.ts";
import {
  BATCH_ESCROWS_MAX,
  BATCH_ESCROWS_MIN,
  CloseLoanPartialError,
  CloseValidationError,
  defaultEscrowMode,
  escrowCreatesFromHistory,
  ledgerEscrowsFromNodes,
  loanMaturity,
  loanSetFromHistory,
  mergeLedgerEscrows,
  planEscrowResume,
  planLoanClose,
  resolveEscrowMode,
  type ClosePartialContext,
  type CreatedEscrowRef,
  type PlannedEscrow,
} from "../src/loan-close.ts";
import { testConditionPair, testConditionPairs } from "./support/conditions.ts";

type Json = Record<string, any>;
const fixture = (name: string): Json => JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8"));
const seed = (n: number) => Wallet.fromEntropy(Uint8Array.from({ length: 16 }, (_, i) => (i * 13 + n) & 0xff));
const quorum = [seed(1), seed(2), seed(3)];
const sha = (s: string) => createHash("sha256").update(s).digest("hex").toUpperCase();
const iso = (rippleS: number) => new Date((rippleS + 946_684_800) * 1000).toISOString();

// ---- the recorded applied escrow Batch (E2): SPV, builder, issuer and the 3 milestones it escrowed
const applied = fixture("batch-escrows-applied.json");
const rawInners = (applied.outer.tx_json.RawTransactions as Json[]).map((r) => r.RawTransaction as Json);
const SPV: string = applied.outer.tx_json.Account;
const BUILDER: string = rawInners[0]!.Destination;
const ISSUER: string = rawInners[0]!.Amount.issuer;
const recordedMilestones: AtomicMilestone[] = rawInners.map((t, i) => ({ milestoneId: `m${i + 1}`, amount: t.Amount.value, condition: t.Condition, cancelAfter: t.CancelAfter }));
const recordedPlanned: PlannedEscrow[] = recordedMilestones.map((m, index) => ({ ...m, index }));
const history = fixture("history-xrpl13.json").transactions as Json[];
const RECORDED_LOAN = "155B0E0AA1843E3FF88C891668DE07990874B121AA1BC6625B8FE65D7106D44C";
const RECORDED_LOANSET = "0F0564B011AE6E55A8B1B944ADD0D04A38609DA01229224FEF9A342CA7440D7A";

/** A fixture's outer + inner lookups → the BatchResult submitBatch would return. */
function batchResultFrom(f: Json): BatchResult {
  const o = f.outer;
  const tx: TxResult = { hash: o.hash, explorerUrl: explorerTxUrl(o.hash), result: o.meta.TransactionResult, ledgerIndex: o.ledger_index, tx: o.tx_json, meta: o.meta };
  const inners = (o.tx_json.RawTransactions as Json[]).map(({ RawTransaction: t }, i) => {
    const { hash, lookup } = f.inners[i];
    const l: InnerLookup = lookup.error === "txnNotFound" ? { found: false, searchedAll: lookup.searched_all === true } : { found: true, result: lookup };
    return classifyInnerLookup({ hash: o.hash, ledgerIndex: o.ledger_index }, { hash, explorerUrl: explorerTxUrl(hash), transactionType: t.TransactionType, account: t.Account, sequence: t.Sequence }, l);
  });
  return { tx, inners, allApplied: inners.every((i) => i.result === "tesSUCCESS"), outcome: batchOutcome(inners) };
}

// ---------------------------------------------------------------- mode selection

test("escrow mode: one Batch for 2..8 milestones (XLS-56 inner limit), else sequential; batch outside the limit is refused", () => {
  assert.equal(BATCH_ESCROWS_MIN, BATCH_MIN_INNER);
  assert.equal(BATCH_ESCROWS_MAX, BATCH_MAX_INNER);
  assert.deepEqual([0, 1, 2, 3, 8, 9, 12].map(defaultEscrowMode), ["sequential", "sequential", "batch", "batch", "batch", "sequential", "sequential"]);
  assert.equal(resolveEscrowMode(3), "batch");
  assert.equal(resolveEscrowMode(3, "sequential"), "sequential");
  assert.equal(resolveEscrowMode(1, "sequential"), "sequential");
  for (const n of [1, 9]) {
    assert.throws(() => resolveEscrowMode(n, "batch"), (e: unknown) => e instanceof CloseValidationError && /escrowMode "batch" needs 2\.\.8 escrows .* got \d/.test(e.message));
  }
});

test("planLoanClose returns the escrow mode next to every other check (batch for 9 milestones is one more issue)", () => {
  const NOW = 846_000_000;
  const plan = (n: number, escrowMode?: "batch" | "sequential") =>
    planLoanClose({
      milestones: Array.from({ length: n }, (_, i) => ({ id: `m${i + 1}`, amount: "100" })),
      conditions: testConditionPairs(n).map((p) => p.condition),
      now: NOW,
      paymentTotal: 4,
      paymentIntervalS: 300,
      interestRate: 10_000,
      ...(escrowMode ? { escrowMode } : {}),
    });
  assert.equal(plan(3).escrowMode, "batch");
  assert.equal(plan(3, "sequential").escrowMode, "sequential");
  assert.equal(plan(1).escrowMode, "sequential");
  assert.equal(plan(9).escrowMode, "sequential");
  assert.throws(() => plan(9, "batch"), (e: unknown) => e instanceof CloseValidationError && e.issues.some((s) => /escrowMode "batch" needs 2\.\.8 escrows/.test(s)));
});

// ---------------------------------------------------------------- validation in batch mode

test("batch path: a malformed or duplicate condition, bad CancelAfter or amount is refused before anything is signed", async () => {
  let submits = 0;
  const deps = { submitBatch: async (): Promise<BatchResult> => (submits++, assert.fail("must not submit")) };
  const good = testConditionPairs(3).map((p) => p.condition);
  const ms = (conds: string[], o: Partial<AtomicMilestone> = {}) => conds.map((condition, i) => ({ milestoneId: `m${i + 1}`, amount: "100", condition, cancelAfter: 900_000_000, ...o }));
  const cases: [string, AtomicMilestone[], RegExp][] = [
    ["a fulfillment instead of a condition", ms([good[0]!, testConditionPair().fulfillment, good[2]!]), /not a 32-byte PREIMAGE-SHA-256 condition/],
    ["truncated condition", ms([good[0]!, good[1]!.slice(0, 76), good[2]!]), /not a 32-byte PREIMAGE-SHA-256 condition/],
    ["duplicate condition (case-insensitive)", ms([good[0]!, good[0]!.toLowerCase(), good[2]!]), /duplicate condition \(same as m1\)/],
    ["CancelAfter not Ripple seconds", ms(good, { cancelAfter: 1.5 }), /CancelAfter must be Ripple-epoch seconds/],
    ["amount with 7 decimals", ms(good, { amount: "1.1234567" }), /<= 6 decimals/],
    ["one milestone", ms([good[0]!]), /needs 2\.\.8 escrows, got 1/],
    ["nine milestones", ms(testConditionPairs(9).map((p) => p.condition)), /needs 2\.\.8 escrows, got 9/],
  ];
  for (const [label, milestones, why] of cases) {
    await assert.rejects(
      createEscrowsAtomic({ spv: SPV, builder: BUILDER, issuer: ISSUER, milestones, spvSigners: quorum, deps }),
      (e: unknown) => e instanceof CloseValidationError && /^createEscrowsAtomic: invalid input, nothing submitted/.test(e.message) && why.test(e.message),
      label,
    );
  }
  await assert.rejects(
    createEscrowsAtomic({ spv: SPV, builder: BUILDER, issuer: ISSUER, milestones: ms(good, { cancelAfter: 900_000_030 }), now: 900_000_000, spvSigners: quorum, deps }),
    /must be more than 60s after ledger now/,
  );
  await assert.rejects(createEscrowsAtomic({ spv: SPV, builder: BUILDER, issuer: ISSUER, milestones: ms(good), deps }), /no SPV signers/);
  assert.equal(submits, 0, "nothing reached submitBatch");

  // Valid input: conditions are normalized to uppercase before they are signed.
  let seen: SubmitBatchParams | undefined;
  const ok = batchResultFrom(applied);
  await createEscrowsAtomic({
    spv: SPV,
    builder: BUILDER,
    issuer: ISSUER,
    milestones: recordedMilestones.map((m) => ({ ...m, condition: m.condition.toLowerCase() })),
    spvSigners: quorum,
    deps: { submitBatch: async (p) => ((seen = p), ok) },
  });
  assert.deepEqual(seen!.inners.map((t) => (t as { Condition?: string }).Condition), recordedMilestones.map((m) => m.condition));
  assert.equal("multisig" in seen!.outerSigner && seen!.outerSigner.multisig.length, 3);
});

// ---------------------------------------------------------------- rollback detection

test("recorded rollbacks: outer tesSUCCESS, but no inner tx in the Batch's own ledger (searched_all) → rolled_back", () => {
  for (const [name, n] of [["batch-payments-rolled-back.json", 2], ["batch-escrows-rolled-back.json", 3]] as const) {
    const r = batchResultFrom(fixture(name));
    assert.equal(r.tx.result, "tesSUCCESS", name);
    assert.deepEqual(r.inners.map((i) => i.result), Array(n).fill("not_applied"), name);
    assert.equal(r.outcome, "rolled_back", name);
    assert.equal(r.allApplied, false, name);
    // The outer metadata alone can't tell: it only touches the outer account (fee + Sequence), applied or not.
    assert.equal((r.tx.meta.AffectedNodes as unknown[]).length, 1, name);
  }
  assert.equal((batchResultFrom(applied).tx.meta.AffectedNodes as unknown[]).length, 1);
  // The rolled-back escrow Batch consumed only the outer Sequence; its inners' Sequences stayed free.
  const rb = fixture("batch-escrows-rolled-back.json").outer;
  const acct = rb.meta.AffectedNodes[0].ModifiedNode;
  assert.equal(acct.FinalFields.Sequence - acct.PreviousFields.Sequence, 1);
  assert.deepEqual(rb.tx_json.RawTransactions.map((x: Json) => x.RawTransaction.Sequence), [rb.tx_json.Sequence + 1, rb.tx_json.Sequence + 2, rb.tx_json.Sequence + 3]);
});

test("recorded applied escrow Batch: inners tesSUCCESS with ParentBatchID; escrows come from each inner's metadata", () => {
  const r = batchResultFrom(applied);
  assert.equal(r.outcome, "all_applied");
  r.inners.forEach((i, k) => assert.equal(i.hash, innerTxHash(rawInners[k] as never), "inner hash = rippled's"));
  const escrows = escrowsFromBatch(SPV, BUILDER, recordedMilestones, r.inners);
  assert.deepEqual(escrows.map((e) => e.offerSequence), [6391539, 6391540, 6391541]);
  assert.deepEqual(escrows.map((e) => e.createTx), applied.inners.map((i: Json) => i.hash));
  assert.ok(escrows.every((e) => e.createTx !== r.tx.hash && e.tx.ledgerIndex === r.tx.ledgerIndex));
  // Metadata must match: another builder, or milestones in a different order → refused.
  assert.throws(() => escrowsFromBatch(SPV, seed(9).classicAddress, recordedMilestones, r.inners), /metadata shows no Escrow/);
  const swapped = [recordedMilestones[1]!, recordedMilestones[0]!, recordedMilestones[2]!];
  assert.throws(() => escrowsFromBatch(SPV, BUILDER, swapped, r.inners), /metadata shows no Escrow/);
});

test("constructed metadata: incomplete search / foreign ParentBatchID / other ledger → unknown; mixed → partial", () => {
  const base = { hash: "AA".repeat(32), explorerUrl: "x", transactionType: "EscrowCreate", account: SPV, sequence: 1 };
  const at = { hash: "BB".repeat(32), ledgerIndex: 100 };
  const found = (o: Json): InnerLookup => ({ found: true, result: { validated: true, ledger_index: 100, ...o, meta: { TransactionResult: "tesSUCCESS", ParentBatchID: at.hash, ...o.meta } } });
  assert.equal(classifyInnerLookup(at, base, { found: false, searchedAll: true }).result, "not_applied");
  assert.equal(classifyInnerLookup(at, base, { found: false, searchedAll: false }).result, "unknown");
  assert.equal(classifyInnerLookup(at, base, found({})).result, "tesSUCCESS");
  assert.equal(classifyInnerLookup(at, base, found({ meta: { ParentBatchID: "CC".repeat(32) } })).result, "unknown");
  assert.equal(classifyInnerLookup(at, base, found({ ledger_index: 101 })).result, "unknown");
  assert.equal(classifyInnerLookup(at, base, found({ validated: false })).result, "unknown");
  assert.equal(batchOutcome([{ result: "tesSUCCESS" }, { result: "not_applied" }]), "partial");
  assert.equal(batchOutcome([{ result: "tesSUCCESS" }, { result: "unknown" }]), "unknown");
  assert.equal(batchOutcome([{ result: "not_applied" }, { result: "not_applied" }]), "rolled_back");
  assert.equal(batchOutcome([]), "unknown");
});

test("recorded escrow-Batch rollback → BatchNotAppliedError → CloseLoanPartialError with every milestone pending", async () => {
  const rec = fixture("batch-escrows-rolled-back.json");
  const rolled = batchResultFrom(rec);
  const raw = (rec.outer.tx_json.RawTransactions as Json[]).map((r) => r.RawTransaction as Json);
  const spv: string = rec.outer.tx_json.Account;
  const milestones: AtomicMilestone[] = raw.map((t, i) => ({ milestoneId: `m${i + 1}`, amount: t.Amount.value, condition: t.Condition, cancelAfter: t.CancelAfter }));
  const planned: PlannedEscrow[] = milestones.map((m, index) => ({ ...m, index }));
  let prepared: { hash: string; lastLedgerSequence: number } | undefined;
  let signed: SubmitBatchParams | undefined;
  const err = await createEscrowsAtomic({
    spv,
    builder: raw[0]!.Destination,
    issuer: raw[0]!.Amount.issuer,
    milestones,
    spvSigners: quorum,
    onPrepared: (b) => (prepared = b),
    deps: {
      submitBatch: async (p) => {
        signed = p;
        p.onPrepared?.({ hash: rolled.tx.hash, lastLedgerSequence: rec.outer.tx_json.LastLedgerSequence, batch: {} as Batch });
        return rolled;
      },
    },
  }).then(
    () => assert.fail("expected BatchNotAppliedError"),
    (e: unknown) => e,
  );
  assert.ok(err instanceof BatchNotAppliedError && err instanceof XrplTxError);
  assert.equal(err.engineResult, "inner_failed");
  assert.equal(err.hash, rolled.tx.hash);
  assert.match(err.message, new RegExp(`EscrowCreate#${raw[0]!.Sequence}=not_applied.*outcome rolled_back \\(tfAllOrNothing: nothing applied\\)`));
  assert.equal(isUncertainSubmitFailure(err), false, "a validated rollback is definite");
  // What was signed = what the recorded Batch carried (same inner EscrowCreates, in milestone order).
  assert.deepEqual(signed!.inners.map((t) => (t as { Condition?: string }).Condition), raw.map((t) => t.Condition));

  const pe = closePartialError({ loanId: "LOAN", loanSetTx: "AB".repeat(32), created: [], failure: err, context: { spv, builder: raw[0]!.Destination, escrowMode: "batch", planned }, ...(prepared ? { prepared } : {}) });
  assert.ok(pe instanceof CloseLoanPartialError && pe instanceof LedgerError);
  assert.equal(pe.code, "ledger_error");
  assert.deepEqual(pe.pending, ["m1", "m2", "m3"]);
  assert.deepEqual(pe.created, []);
  assert.equal(pe.txResult, "inner_failed");
  assert.equal(pe.txHash, rolled.tx.hash);
  assert.deepEqual(pe.context?.batch, { hash: rolled.tx.hash, lastLedgerSequence: rec.outer.tx_json.LastLedgerSequence, ledgerIndex: rec.outer.ledger_index, outcome: "rolled_back" });
  assert.equal(pe.context?.uncertain, undefined);
  assert.match(pe.message, /loan LOAN.*the EscrowCreate Batch for milestones \[m1, m2, m3\] did not apply.*pending: \[m1, m2, m3\]\. Recover with resumeEscrowCreation/);
});

test("partial-close classification: unknown outcomes are in flight until LastLedgerSequence; tec / tef / hook errors are definite", () => {
  const ctx = { spv: SPV, builder: BUILDER, issuer: ISSUER, escrowMode: "batch" as const, planned: recordedPlanned };
  assert.equal(isUncertainSubmitFailure(new XrplTxError("Batch", "connection_lost", "AB".repeat(32))), true);
  assert.equal(isUncertainSubmitFailure(new XrplTxError("EscrowCreate", "unknown_outcome")), true);
  assert.equal(isUncertainSubmitFailure(new XrplTxError("EscrowCreate", "tecFROZEN", "AB".repeat(32))), false);
  assert.equal(isUncertainSubmitFailure(new XrplTxError("Batch", "tefBAD_QUORUM")), false);
  assert.equal(isUncertainSubmitFailure(new CloseValidationError(["x"])), false);
  assert.equal(isUncertainSubmitFailure(new Error("socket hang up")), true);

  const lost = closePartialError({ loanId: "L", loanSetTx: "AB".repeat(32), created: [], failure: new XrplTxError("Batch", "connection_lost"), context: ctx, prepared: { hash: "CD".repeat(32), lastLedgerSequence: 777 } });
  assert.equal(lost.context?.uncertain, true);
  assert.equal(lost.context?.inFlightUntilLedger, 777);
  assert.deepEqual(lost.context?.batch, { hash: "CD".repeat(32), lastLedgerSequence: 777, outcome: "unknown" });

  const m1: CreatedEscrowRef = { milestoneId: "m1", owner: SPV, offerSequence: 7, condition: recordedPlanned[0]!.condition, cancelAfter: iso(recordedPlanned[0]!.cancelAfter), createTx: "EF".repeat(32) };
  const frozen = closePartialError({ loanId: "L", loanSetTx: "AB".repeat(32), created: [m1], failure: new XrplTxError("EscrowCreate", "tecFROZEN", "12".repeat(32)), context: { ...ctx, escrowMode: "sequential" } });
  assert.deepEqual(frozen.pending, ["m2", "m3"]);
  assert.equal(frozen.txResult, "tecFROZEN");
  assert.equal(frozen.context?.uncertain, undefined);
  assert.match(frozen.message, /EscrowCreate for milestone m2 failed: EscrowCreate failed: tecFROZEN.*Created: \[m1@7\]; pending: \[m2, m3\]/);

  const hook = closePartialError({ loanId: "L", loanSetTx: "AB".repeat(32), created: [], failure: new Error("onTx hook"), context: ctx, uncertain: false });
  assert.equal(hook.context?.uncertain, undefined);
  assert.deepEqual(hook.pending, ["m1", "m2", "m3"]);
});

// ---------------------------------------------------------------- closeLoanAtomic: full / auto fallback (XRPL-13)

// What devnet rippled 3.4.1 answers (again on 2026-10-25 ~06:05 UTC, §2d) to a Batch with an inner LoanSet.
const innerLoanSetRefused = () => new XrplTxError("Batch", "temINVALID_INNER_BATCH", undefined, { detail: "Malformed: Invalid inner batch transaction." });

function atomicHarness(fullOutcome: () => Promise<BatchResult>) {
  const calls: { batches: SubmitBatchParams[]; loanSets: unknown[] } = { batches: [], loanSets: [] };
  const deps: CloseLoanAtomicDeps = {
    ledgerTime: async () => Math.min(...recordedMilestones.map((m) => m.cancelAfter)) - 3600,
    loanSet: async (p) => {
      calls.loanSets.push(p);
      return { loanId: RECORDED_LOAN, tx: { hash: RECORDED_LOANSET, explorerUrl: explorerTxUrl(RECORDED_LOANSET), result: "tesSUCCESS", ledgerIndex: 6391571, tx: {}, meta: {} } };
    },
    submitBatch: async (p) => {
      calls.batches.push(p);
      return p.inners[0]!.TransactionType === "LoanSet" ? fullOutcome() : batchResultFrom(applied);
    },
  };
  const milestones = (n: number): AtomicMilestone[] =>
    Array.from({ length: n }, (_, i) => (i < recordedMilestones.length ? recordedMilestones[i]! : { ...recordedMilestones[0]!, milestoneId: `m${i + 1}`, condition: testConditionPair().condition }));
  const params = (n = recordedMilestones.length, mode?: "full" | "escrows" | "auto") => ({
    loan: { brokerOwner: quorum[0]!, loanBrokerId: "AB".repeat(32), borrower: SPV, principal: "990", interestRate: 10_000, paymentTotal: 2, paymentIntervalS: 120 },
    builder: BUILDER,
    issuer: ISSUER,
    milestones: milestones(n),
    spvSigners: quorum,
    ...(mode ? { mode } : {}),
    deps,
  });
  return { calls, params };
}

test("closeLoanAtomic auto: inner LoanSet refused (temINVALID_INNER_BATCH, nothing on ledger) → falls back to LoanSet + one escrow Batch", async () => {
  assert.ok(isInnerLoanSetUnsupported(innerLoanSetRefused()));
  const { calls, params } = atomicHarness(async () => {
    throw innerLoanSetRefused();
  });
  const r = await closeLoanAtomic(params(3, "auto"));
  // 1st: the full close (platform outer, LoanSet first, SPV approves via BatchSigners). 2nd: the SPV's escrow Batch.
  assert.equal(calls.batches.length, 2);
  assert.equal(calls.batches[0]!.account, quorum[0]!.classicAddress);
  assert.deepEqual(calls.batches[0]!.inners.map((t) => t.TransactionType), ["LoanSet", "EscrowCreate", "EscrowCreate", "EscrowCreate"]);
  assert.deepEqual(Object.keys(calls.batches[0]!.batchSigners ?? {}), [SPV]);
  assert.equal(calls.batches[1]!.account, SPV);
  assert.deepEqual(calls.batches[1]!.inners.map((t) => t.TransactionType), ["EscrowCreate", "EscrowCreate", "EscrowCreate"]);
  assert.equal(calls.loanSets.length, 1, "the fallback LoanSet is the countersigned standalone one");
  assert.deepEqual((calls.loanSets[0] as { borrowerSig: unknown }).borrowerSig, { multisig: quorum });
  assert.equal(r.mode, "escrows");
  assert.deepEqual(r.fallback && { from: r.fallback.from, engineResult: r.fallback.engineResult }, { from: "full", engineResult: "temINVALID_INNER_BATCH" });
  assert.equal(r.loanId, RECORDED_LOAN);
  assert.equal(r.loanSetTx.hash, RECORDED_LOANSET);
  assert.deepEqual(r.escrows.map((e) => e.milestoneId), ["m1", "m2", "m3"]);
});

test("closeLoanAtomic auto: any other failure is rethrown (no fallback LoanSet); 1 milestone can't fall back; 8 go straight to escrows", async () => {
  // A different refusal, an on-ledger rollback or a network error is not "this network can't batch LoanSet".
  for (const err of [new XrplTxError("Batch", "tefPAST_SEQ"), new XrplTxError("Batch", "inner_failed", "AA".repeat(32)), new Error("socket hang up")]) {
    const { calls, params } = atomicHarness(async () => {
      throw err;
    });
    await assert.rejects(closeLoanAtomic(params(3, "auto")), (e: unknown) => e === err);
    assert.equal(calls.loanSets.length, 0, String(err));
    assert.equal(calls.batches.length, 1, String(err));
  }
  const one = atomicHarness(async () => {
    throw innerLoanSetRefused();
  });
  await assert.rejects(closeLoanAtomic(one.params(1, "auto")), (e: unknown) => isInnerLoanSetUnsupported(e));
  assert.equal(one.calls.loanSets.length, 0);

  const eight = atomicHarness(async () => assert.fail("8 milestones leave no inner slot for LoanSet"));
  // The recorded 3-escrow Batch doesn't match 8 milestones, so the result may throw: only the routing matters here.
  await closeLoanAtomic(eight.params(8, "auto")).catch(() => undefined);
  assert.equal(eight.calls.batches[0]!.account, SPV);
  assert.equal(eight.calls.batches[0]!.inners.length, 8);
  assert.equal(eight.calls.loanSets.length, 1);
});

test('closeLoanAtomic: default mode stays "escrows" (no full attempt); explicit "full" surfaces the refusal', async () => {
  const d = atomicHarness(async () => assert.fail("default must not try the full close"));
  const r = await closeLoanAtomic(d.params());
  assert.equal(r.mode, "escrows");
  assert.equal(r.fallback, undefined);
  assert.deepEqual(d.calls.batches.map((b) => b.account), [SPV]);

  const f = atomicHarness(async () => {
    throw innerLoanSetRefused();
  });
  await assert.rejects(closeLoanAtomic(f.params(3, "full")), /temINVALID_INNER_BATCH/);
  assert.equal(f.calls.loanSets.length, 0);
});

// ---------------------------------------------------------------- ledger parsers (recorded SPV history)

test("history parsers: EscrowCreates (Batch inners included, rolled-back ones never appear) and the LoanSet that created the loan", () => {
  const creates = escrowCreatesFromHistory(history, SPV);
  assert.deepEqual(creates.map((e) => e.offerSequence).sort(), [6391539, 6391540, 6391541]);
  assert.ok(creates.every((e) => !e.open && e.destination === BUILDER && e.amount === "330" && e.cancelAfter === 846206282));
  assert.deepEqual(new Set(creates.map((e) => e.createTx)), new Set(applied.inners.map((i: Json) => i.hash)));
  assert.deepEqual(escrowCreatesFromHistory(history, BUILDER), [], "only escrows the SPV created");
  assert.equal(loanSetFromHistory(history, RECORDED_LOAN)?.hash, RECORDED_LOANSET);
  assert.equal(loanSetFromHistory(history, "00".repeat(32)), undefined);

  const nodes = [...openNodesFrom(applied), { Account: BUILDER, Destination: SPV, Condition: "A0".repeat(39), Sequence: 1, Amount: "1" }];
  const open = ledgerEscrowsFromNodes(nodes, SPV);
  assert.equal(open.length, 3, "an escrow owned by someone else is ignored");
  const merged = mergeLedgerEscrows(open.slice(0, 2), creates);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged.filter((e) => e.open).map((e) => e.offerSequence).sort(), [6391539, 6391540]);
  assert.equal(merged.find((e) => e.offerSequence === 6391541)?.open, false);

  assert.equal(loanMaturity({ NextPaymentDueDate: 1_000, PaymentInterval: 100, PaymentRemaining: 3 }), 1_200);
  assert.equal(loanMaturity({ NextPaymentDueDate: 1_000, PaymentInterval: 100, PaymentRemaining: 0 }), undefined);
});

/** account_objects Escrow nodes for a recorded Batch's inner EscrowCreates (NewFields + the inner hash). */
function openNodesFrom(f: Json): Json[] {
  return (f.inners as Json[]).map((i) => {
    const c = (i.lookup.meta.AffectedNodes as Json[]).find((n) => n.CreatedNode?.LedgerEntryType === "Escrow")!.CreatedNode;
    return { LedgerEntryType: "Escrow", index: c.LedgerIndex, PreviousTxnID: i.hash, ...c.NewFields };
  });
}

// ---------------------------------------------------------------- resume: pure planner

test("planEscrowResume: present by claim / open condition / history; refuses mismatches; checks every new escrow", () => {
  const NOW = 846_300_000;
  const [a, b, c, d] = testConditionPairs(4).map((p) => p.condition) as [string, string, string, string];
  const ms = [
    { milestoneId: "m1", index: 0, amount: "100", condition: a, cancelAfter: NOW + 600 },
    { milestoneId: "m2", index: 1, amount: "200", condition: b, cancelAfter: NOW + 600 },
    { milestoneId: "m3", index: 2, amount: "300", condition: c, cancelAfter: NOW + 600 },
    { milestoneId: "m4", index: 3, amount: "400", condition: d, cancelAfter: NOW + 600 },
  ];
  const esc = (condition: string, seq: number, open: boolean, o: Json = {}) => ({ offerSequence: seq, condition, destination: BUILDER, amount: "200", cancelAfter: NOW + 600, createTx: sha(condition), open, ...o });
  const plan = planEscrowResume({
    spv: SPV,
    builder: BUILDER,
    milestones: ms,
    created: [{ milestoneId: "m1", owner: SPV, offerSequence: 10, condition: a, cancelAfter: iso(NOW + 600), createTx: "C1".repeat(32) }],
    ledgerEscrows: [esc(b.toLowerCase(), 11, true), esc(c, 12, false, { amount: "300" })],
    now: NOW,
    maturity: NOW + 1_200,
  });
  assert.deepEqual(plan.present.map((p) => [p.milestoneId, p.source, p.offerSequence]), [["m1", "created", 10], ["m2", "open", 11], ["m3", "consumed", 12]]);
  assert.deepEqual(plan.toCreate.map((e) => e.milestoneId), ["m4"]);

  const refused = (o: Partial<Parameters<typeof planEscrowResume>[0]>) => {
    try {
      planEscrowResume({ spv: SPV, builder: BUILDER, milestones: ms, created: [], ledgerEscrows: [], now: NOW, maturity: NOW + 1_200, ...o });
    } catch (e) {
      assert.ok(e instanceof CloseValidationError && /^resumeEscrowCreation: invalid input, nothing submitted/.test(e.message));
      return e.issues.join("\n");
    }
    return assert.fail("expected CloseValidationError");
  };
  assert.match(refused({ ledgerEscrows: [esc(b, 11, true, { destination: seed(9).classicAddress })] }), /m2.*not the builder/);
  assert.match(refused({ ledgerEscrows: [esc(b, 11, true, { amount: "199" })] }), /m2.*for 199, not 200/);
  assert.match(refused({ maturity: NOW + 600 }), /m1.*must be before loan maturity/);
  assert.match(refused({ now: NOW + 590 }), /must be more than 60s after ledger now/);
  assert.match(refused({ milestones: ms.map((m) => ({ ...m, condition: a })) }), /m2.*duplicate condition \(same as milestone m1\)/);
  assert.match(refused({ milestones: [{ ...ms[0]!, condition: "A0228020" + "00".repeat(32) }] }), /not a 32-byte PREIMAGE-SHA-256 condition/);
  assert.match(refused({ created: [{ milestoneId: "m9", owner: SPV, offerSequence: 1, condition: a, cancelAfter: "", createTx: "" }] }), /created: unknown milestone m9/);
});

// ---------------------------------------------------------------- resume: shell with an injected ledger

interface World {
  index: number;
  time: number;
  nodes: Json[];
  history: Json[];
  loan?: Partial<LoanEntry>;
  balance: string;
  nextSeq: number;
  batches: Parameters<ResumeDeps["createEscrowsAtomic"]>[0][];
  singles: CreateEscrowParams[];
  sleeps: number;
  failNextBatch?: boolean;
}

/** Fake ledger: the submit fakes "apply" to the world (escrow nodes + history), so a re-run sees what a run created. */
function depsFor(w: World): Partial<ResumeDeps> {
  const apply = (spv: string, builder: string, issuer: string, m: AtomicMilestone, parent?: string): { hash: string; seq: number; tx: TxResult } => {
    const seq = w.nextSeq++;
    const hash = sha(`${m.condition}:${seq}`);
    const txJson = { TransactionType: "EscrowCreate", Account: spv, Destination: builder, Amount: { currency: "524C555344000000000000000000000000000000", issuer, value: m.amount }, Condition: m.condition, CancelAfter: m.cancelAfter, Sequence: seq, date: w.time };
    const meta = { TransactionResult: "tesSUCCESS", ...(parent ? { ParentBatchID: parent } : {}), AffectedNodes: [{ CreatedNode: { LedgerEntryType: "Escrow", LedgerIndex: sha(hash), NewFields: { Account: spv, Destination: builder, Amount: txJson.Amount, Condition: m.condition, CancelAfter: m.cancelAfter, Sequence: seq } } }] };
    w.nodes.push({ LedgerEntryType: "Escrow", index: sha(hash), PreviousTxnID: hash, ...meta.AffectedNodes[0]!.CreatedNode.NewFields });
    w.history.unshift({ hash, ledger_index: w.index, close_time_iso: iso(w.time), validated: true, tx_json: txJson, meta });
    return { hash, seq, tx: { hash, explorerUrl: explorerTxUrl(hash), result: "tesSUCCESS", ledgerIndex: w.index, tx: txJson, meta } };
  };
  return {
    ledgerNow: async () => ({ ledgerIndex: w.index, closeTime: w.time }),
    getLoan: async () => w.loan as LoanEntry | undefined,
    listEscrowNodes: async () => [...w.nodes],
    accountTx: async () => [...w.history],
    rlusdBalance: async () => w.balance,
    fetchTx: async (hash) => assert.fail(`unexpected fetchTx ${hash}`),
    sleep: async () => {
      w.sleeps++;
      w.index += 5;
    },
    createEscrowsAtomic: async (p) => {
      w.batches.push(p);
      const batchHash = sha(`batch:${w.batches.length}`);
      const batchTx: TxResult = { hash: batchHash, explorerUrl: explorerTxUrl(batchHash), result: "tesSUCCESS", ledgerIndex: w.index, tx: { TransactionType: "Batch" }, meta: {} };
      if (w.failNextBatch) {
        w.failNextBatch = false;
        const inners = p.milestones.map((m, i) => ({ hash: sha(`x${i}`), explorerUrl: "x", transactionType: "EscrowCreate", account: p.spv, sequence: w.nextSeq + 1 + i, result: "not_applied" }));
        throw new BatchNotAppliedError({ tx: batchTx, inners, allApplied: false, outcome: "rolled_back" }, "EscrowCreate batch");
      }
      w.nextSeq++; // the outer consumes a Sequence
      const escrows: AtomicEscrow[] = p.milestones.map((m) => {
        const r = apply(p.spv, p.builder, p.issuer, m, batchHash);
        return { ...m, owner: p.spv, offerSequence: r.seq, createTx: r.hash, explorerUrl: explorerTxUrl(r.hash), tx: r.tx };
      });
      return { batch: { tx: batchTx, inners: [], allApplied: true, outcome: "all_applied" }, escrows };
    },
    createMilestoneEscrow: async (p): Promise<CreatedEscrow> => {
      w.singles.push(p);
      const r = apply(p.spv, p.builder, p.issuer, { milestoneId: "", amount: p.amount, condition: p.condition, cancelAfter: p.cancelAfter });
      return { tx: r.tx, owner: p.spv, offerSequence: r.seq };
    },
  };
}

test("resume after an unknown Batch outcome: waits out LastLedgerSequence, finds all 3 escrows open by condition, submits nothing", async () => {
  const w: World = {
    index: 6_391_580,
    time: 846_202_800,
    nodes: openNodesFrom(applied),
    history: [...history],
    loan: { index: RECORDED_LOAN, Borrower: SPV, LoanBrokerID: "B", NextPaymentDueDate: 846_202_820, PaymentInterval: 120, PaymentRemaining: 2 },
    balance: "0",
    nextSeq: 6_391_542,
    batches: [],
    singles: [],
    sleeps: 0,
  };
  const context: ClosePartialContext = {
    projectId: "p-xrpl13",
    spv: SPV,
    builder: BUILDER,
    issuer: ISSUER,
    escrowMode: "batch",
    planned: recordedPlanned,
    batch: { hash: applied.outer.hash, lastLedgerSequence: 6_391_591, outcome: "unknown" },
    uncertain: true,
    inFlightUntilLedger: 6_391_591,
  };
  const err = new CloseLoanPartialError(RECORDED_LOAN, RECORDED_LOANSET, [], ["m1", "m2", "m3"], new XrplTxError("Batch", "connection_lost"), context);
  const waits: number[] = [];
  const r = await resumeEscrowCreation(err, { spvSigners: quorum, onWait: (n) => waits.push(n), deps: depsFor(w) });
  assert.equal(w.sleeps, 3, "6391580 → 6391595: past the Batch's LastLedgerSequence");
  assert.deepEqual(waits, [12, 7, 2]);
  assert.deepEqual(r.resumed, { created: [], alreadyPresent: ["m1", "m2", "m3"].map((milestoneId) => ({ milestoneId, source: "open" })), submitted: [] });
  assert.equal(w.batches.length + w.singles.length, 0, "nothing submitted");
  assert.deepEqual(r.escrows.map((e) => e.offerSequence), [6391539, 6391540, 6391541]);
  assert.deepEqual(r.escrows.map((e) => e.createTx), applied.inners.map((i: Json) => i.hash));
  assert.equal(r.loanSetTx.hash, RECORDED_LOANSET);
  assert.deepEqual(r.txs.map((t) => t.tx.TransactionType), ["LoanSet", "EscrowCreate", "EscrowCreate", "EscrowCreate"]);
  assert.deepEqual(r.events.map((e) => e.kind), ["loan_set", "escrow_created", "escrow_created", "escrow_created"]);
  assert.ok(r.events.every((e) => e.projectId === "p-xrpl13"));
  assert.equal(r.escrowMode, "batch");
  assert.equal(r.maturity, iso(846_202_940));
  assert.equal(r.batchTx, undefined);
});

/** A fresh project: m1 escrowed by the failed close, m2/m3 missing. */
function freshScenario() {
  const NOW = 846_400_000;
  const spv = seed(5).classicAddress;
  const builder = seed(6).classicAddress;
  const issuer = seed(7).classicAddress;
  const loanId = "4C".repeat(32);
  const loanSetHash = "5E".repeat(32);
  const [c1, c2, c3] = testConditionPairs(3).map((p) => p.condition) as [string, string, string];
  const planned: PlannedEscrow[] = [
    { milestoneId: "m1", index: 0, amount: "1000", condition: c1, cancelAfter: NOW + 1_200 },
    { milestoneId: "m2", index: 1, amount: "1200", condition: c2, cancelAfter: NOW + 1_200 },
    { milestoneId: "m3", index: 2, amount: "800", condition: c3, cancelAfter: NOW + 1_200 },
  ];
  const w: World = {
    index: 9_000,
    time: NOW,
    nodes: [],
    history: [
      {
        hash: loanSetHash,
        ledger_index: 8_990,
        close_time_iso: iso(NOW - 30),
        validated: true,
        tx_json: { TransactionType: "LoanSet", Account: seed(8).classicAddress, Counterparty: spv, PrincipalRequested: "3000", LoanOriginationFee: "45" },
        meta: { TransactionResult: "tesSUCCESS", AffectedNodes: [{ CreatedNode: { LedgerEntryType: "Loan", LedgerIndex: loanId, NewFields: { Borrower: spv } } }] },
      },
    ],
    loan: { index: loanId, Borrower: spv, LoanBrokerID: "B", NextPaymentDueDate: NOW + 600, PaymentInterval: 600, PaymentRemaining: 3, LoanOriginationFee: "45" },
    balance: "2000",
    nextSeq: 500,
    batches: [],
    singles: [],
    sleeps: 0,
  };
  const deps = depsFor(w);
  // The failed close escrowed m1 (sequential), then m2's EscrowCreate failed on-ledger.
  const m1 = (deps.createMilestoneEscrow as ResumeDeps["createMilestoneEscrow"])({ spv, builder, issuer, amount: "1000", condition: c1, cancelAfter: NOW + 1_200 });
  w.singles.length = 0;
  w.balance = "2000";
  return { NOW, spv, builder, issuer, loanId, loanSetHash, planned, w, deps, m1 };
}

test("resume creates exactly the missing escrows (one Batch for m2 + m3), then a re-run submits nothing", async () => {
  const s = freshScenario();
  const m1 = await s.m1;
  const created: CreatedEscrowRef[] = [{ milestoneId: "m1", owner: s.spv, offerSequence: m1.offerSequence, condition: s.planned[0]!.condition, cancelAfter: iso(s.NOW + 1_200), createTx: m1.tx.hash }];
  const err = new CloseLoanPartialError(s.loanId, s.loanSetHash, created, ["m2", "m3"], new XrplTxError("EscrowCreate", "tecFROZEN", "AA".repeat(32)), {
    projectId: "p1",
    spv: s.spv,
    builder: s.builder,
    issuer: s.issuer,
    escrowMode: "sequential",
    planned: s.planned,
    maturity: s.NOW + 1_800,
    originationFee: "45",
  });
  const steps: string[] = [];
  const r = await resumeEscrowCreation(err, { spvSigners: quorum, onTx: (e) => void steps.push(`${e.step}:${e.milestoneIds.join("+")}`), deps: s.deps });
  assert.equal(s.w.sleeps, 0, "definite failure: no in-flight wait");
  assert.equal(s.w.batches.length, 1);
  assert.deepEqual(s.w.batches[0]!.milestones.map((m) => m.milestoneId), ["m2", "m3"]);
  assert.equal(s.w.batches[0]!.now, s.NOW);
  assert.deepEqual(steps, ["escrow_batch:m2+m3"]);
  assert.deepEqual(r.resumed.created, ["m2", "m3"]);
  assert.deepEqual(r.resumed.alreadyPresent, [{ milestoneId: "m1", source: "created" }]);
  assert.equal(r.resumed.submitted.length, 1);
  assert.equal(r.batchTx?.hash, r.resumed.submitted[0]!.hash);
  assert.equal(r.escrowMode, "batch");
  assert.deepEqual(r.escrows.map((e) => e.milestoneId), ["m1", "m2", "m3"]);
  assert.equal(r.escrows[0]!.offerSequence, m1.offerSequence);
  assert.deepEqual(r.txs.map((t) => t.tx.TransactionType), ["LoanSet", "EscrowCreate", "EscrowCreate", "EscrowCreate"]);
  assert.deepEqual(r.events.map((e) => `${e.kind}:${e.milestoneId ?? ""}`), ["loan_set:", "escrow_created:m1", "escrow_created:m2", "escrow_created:m3"]);
  assert.equal(r.events[0]!.amount, "3000");
  assert.equal(r.originationFee, "45");
  assert.equal(r.maturity, iso(s.NOW + 1_800), "the REAL maturity from the Loan entry");

  // Re-run with the same (stale) error: the escrows are on the SPV now → nothing is submitted.
  const again = await resumeEscrowCreation(err, { spvSigners: quorum, deps: s.deps });
  assert.equal(s.w.batches.length, 1, "no second Batch");
  assert.deepEqual(again.resumed.created, []);
  assert.deepEqual(again.resumed.submitted, []);
  assert.deepEqual(again.resumed.alreadyPresent.map((p) => `${p.milestoneId}:${p.source}`), ["m1:created", "m2:open", "m3:open"]);
  assert.deepEqual(again.escrows.map((e) => e.createTx), r.escrows.map((e) => e.createTx));

  // The same via the plain form (no error object), cancelAfters by index.
  const plain = await resumeEscrowCreation(
    { project: projectOf(s.spv, s.planned), loanId: s.loanId, created, pending: ["m2", "m3"], conditions: s.planned.map((e) => e.condition), cancelAfters: s.planned.map((e) => iso(e.cancelAfter)) },
    { spvSigners: quorum, builderAddress: s.builder, issuer: s.issuer, deps: s.deps },
  );
  assert.deepEqual(plain.resumed.submitted, []);
  assert.deepEqual(plain.escrows.map((e) => e.offerSequence), r.escrows.map((e) => e.offerSequence));
});

function projectOf(spv: string, planned: PlannedEscrow[]): Project {
  return {
    id: "p1",
    name: "resume",
    type: "residential_new",
    builderId: "b1",
    siteAddress: "1 Test St",
    siteGeo: { lat: 40.7, lng: -74, radiusM: 100 },
    description: "XRPL-13b",
    terms: { principal: "3000", interestRateBps: 1000, termDays: 30, paymentIntervalDays: 10, fundingDeadline: new Date().toISOString() },
    status: "funding",
    milestones: planned.map((e) => ({ id: e.milestoneId, index: e.index, templateKey: "k", title: e.milestoneId, amount: e.amount, requiredInspectors: 1, status: "pending" })),
    chain: { spv },
  } as Project;
}

test("resume never re-creates an escrow already finished/cancelled (SPV history), and uses sequential for one missing escrow", async () => {
  const s = freshScenario();
  await s.m1;
  // m2 was created and since consumed (only in the history); m3 is missing.
  const deps = s.deps;
  await (deps.createMilestoneEscrow as ResumeDeps["createMilestoneEscrow"])({ spv: s.spv, builder: s.builder, issuer: s.issuer, amount: "1200", condition: s.planned[1]!.condition, cancelAfter: s.NOW + 1_200 });
  s.w.nodes = s.w.nodes.filter((n) => n.Condition !== s.planned[1]!.condition);
  s.w.singles.length = 0;
  const r = await resumeEscrowCreation(
    { project: projectOf(s.spv, s.planned), loanId: s.loanId, conditions: Object.fromEntries(s.planned.map((e) => [e.milestoneId, e.condition])) },
    { spvSigners: quorum, builderAddress: s.builder, issuer: s.issuer, deps },
  );
  assert.deepEqual(r.resumed.alreadyPresent.map((p) => `${p.milestoneId}:${p.source}`), ["m1:open", "m2:consumed"]);
  assert.deepEqual(r.resumed.created, ["m3"]);
  assert.equal(s.w.batches.length, 0);
  assert.equal(s.w.singles.length, 1, "one missing escrow → sequential");
  assert.equal(s.w.singles[0]!.cancelAfter, s.NOW + 1_200, "default CancelAfter = real maturity − one payment interval");
  assert.equal(r.escrowMode, "sequential");
});

test("resume refuses before submitting: underfunded SPV, foreign loan, created+pending overlap, batch for one escrow", async () => {
  const s = freshScenario();
  const m1 = await s.m1;
  const created: CreatedEscrowRef[] = [{ milestoneId: "m1", owner: s.spv, offerSequence: m1.offerSequence, condition: s.planned[0]!.condition, cancelAfter: iso(s.NOW + 1_200), createTx: m1.tx.hash }];
  const ctx: ClosePartialContext = { projectId: "p1", spv: s.spv, builder: s.builder, issuer: s.issuer, escrowMode: "batch", planned: s.planned };
  const err = new CloseLoanPartialError(s.loanId, s.loanSetHash, created, ["m2", "m3"], new Error("x"), ctx);
  const refusal = (re: RegExp) => (e: unknown) => e instanceof CloseValidationError && re.test(e.message);

  s.w.balance = "1999.99";
  await assert.rejects(resumeEscrowCreation(err, { spvSigners: quorum, deps: s.deps }), refusal(/SPV .* holds 1999\.99 RLUSD < 2000 for the missing escrows \[m2, m3\]/));
  s.w.balance = "2000";
  s.w.loan = { ...s.w.loan, Borrower: seed(9).classicAddress };
  await assert.rejects(resumeEscrowCreation(err, { spvSigners: quorum, deps: s.deps }), refusal(/is borrowed by .*, not the SPV/));
  s.w.loan = undefined;
  await assert.rejects(resumeEscrowCreation(err, { spvSigners: quorum, deps: s.deps }), refusal(/loan .* not found on the ledger/));
  s.w.loan = { index: s.loanId, Borrower: s.spv, LoanBrokerID: "B", NextPaymentDueDate: s.NOW + 600, PaymentInterval: 600, PaymentRemaining: 3 };
  await assert.rejects(
    resumeEscrowCreation({ project: projectOf(s.spv, s.planned), loanId: s.loanId, created, pending: ["m1"], conditions: s.planned.map((e) => e.condition) }, { builderAddress: s.builder, issuer: s.issuer, deps: s.deps }),
    refusal(/milestone m1 is both created and pending/),
  );
  await assert.rejects(resumeEscrowCreation(err, { spvSigners: quorum, builderAddress: seed(9).classicAddress, deps: s.deps }), refusal(/is not the failed close's escrow destination/));
  await assert.rejects(
    resumeEscrowCreation(new CloseLoanPartialError(s.loanId, s.loanSetHash, [...created, { ...created[0]!, milestoneId: "m2", condition: s.planned[1]!.condition }], ["m3"], new Error("x"), ctx), { escrowMode: "batch", spvSigners: quorum, deps: s.deps }),
    refusal(/escrowMode "batch" needs 2\.\.8 escrows .* got 1/),
  );
  await assert.rejects(resumeEscrowCreation(new CloseLoanPartialError(s.loanId, s.loanSetHash, [], ["m1"], new Error("x")), { deps: s.deps }), refusal(/has no context/));
  assert.equal(s.w.batches.length + s.w.singles.length, 0, "nothing submitted");
});

test("a Batch that rolls back during resume → a new CloseLoanPartialError; resuming that one completes the close", async () => {
  const s = freshScenario();
  const m1 = await s.m1;
  const created: CreatedEscrowRef[] = [{ milestoneId: "m1", owner: s.spv, offerSequence: m1.offerSequence, condition: s.planned[0]!.condition, cancelAfter: iso(s.NOW + 1_200), createTx: m1.tx.hash }];
  const err = new CloseLoanPartialError(s.loanId, s.loanSetHash, created, ["m2", "m3"], new Error("x"), { projectId: "p1", spv: s.spv, builder: s.builder, issuer: s.issuer, escrowMode: "sequential", planned: s.planned });
  s.w.failNextBatch = true;
  const again = await resumeEscrowCreation(err, { spvSigners: quorum, deps: s.deps }).then(
    () => assert.fail("expected CloseLoanPartialError"),
    (e: unknown) => e,
  );
  assert.ok(again instanceof CloseLoanPartialError);
  assert.deepEqual(again.created.map((c) => c.milestoneId), ["m1"]);
  assert.deepEqual(again.pending, ["m2", "m3"]);
  assert.equal(again.context?.escrowMode, "batch");
  assert.equal(again.context?.batch?.outcome, "rolled_back");
  assert.equal(again.loanSetTx, s.loanSetHash);
  const done = await resumeEscrowCreation(again, { spvSigners: quorum, deps: s.deps });
  assert.deepEqual(done.resumed.created, ["m2", "m3"]);
  assert.equal(s.w.batches.length, 2);
});

test("M8: resume { project } form: builderAddress required and checked; waits one LLS margin for an in-flight tx unless told not to", async () => {
  const s = freshScenario();
  const m1 = await s.m1;
  const created: CreatedEscrowRef[] = [{ milestoneId: "m1", owner: s.spv, offerSequence: m1.offerSequence, condition: s.planned[0]!.condition, cancelAfter: iso(s.NOW + 1_200), createTx: m1.tx.hash }];
  const input = { project: projectOf(s.spv, s.planned), loanId: s.loanId, created, pending: ["m2", "m3"], conditions: s.planned.map((e) => e.condition) };
  const refusal = (re: RegExp) => (e: unknown) => e instanceof CloseValidationError && re.test(e.message);
  await assert.rejects(resumeEscrowCreation(input, { spvSigners: quorum, issuer: s.issuer, deps: s.deps }), refusal(/builderAddress is required/));
  await assert.rejects(resumeEscrowCreation(input, { spvSigners: quorum, builderAddress: s.spv, issuer: s.issuer, deps: s.deps }), refusal(/is the SPV itself/));
  await assert.rejects(resumeEscrowCreation(input, { spvSigners: quorum, builderAddress: s.issuer, issuer: s.issuer, deps: s.deps }), refusal(/is the RLUSD issuer/));
  await assert.rejects(resumeEscrowCreation(input, { spvSigners: quorum, builderAddress: "rNotAnAddress", issuer: s.issuer, deps: s.deps }), refusal(/not a classic XRPL address/));
  assert.equal(s.w.batches.length + s.w.singles.length + s.w.sleeps, 0, "refused before waiting or submitting");

  const waits: number[] = [];
  const r = await resumeEscrowCreation(input, { spvSigners: quorum, builderAddress: s.builder, issuer: s.issuer, onWait: (n) => waits.push(n), deps: s.deps });
  assert.ok(s.w.sleeps >= 4 && waits.length === s.w.sleeps, `waited one LastLedgerSequence margin before reading the ledger (${s.w.sleeps} sleeps)`);
  assert.deepEqual(r.resumed.created, ["m2", "m3"]);
  const sleeps = s.w.sleeps;
  const again = await resumeEscrowCreation(input, { spvSigners: quorum, builderAddress: s.builder, issuer: s.issuer, waitForInFlight: false, deps: s.deps });
  assert.equal(s.w.sleeps, sleeps, "waitForInFlight: false skips the wait");
  assert.deepEqual(again.resumed.submitted, []);
});
