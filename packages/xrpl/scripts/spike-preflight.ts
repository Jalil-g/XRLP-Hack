// XRPL-14 devnet proof: pre-reveal safety refuses an EscrowFinish that would fail (and leak the preimage).
//   pnpm --filter @xrlp/xrpl spike:preflight          (~3 min, fresh faucet wallets)
// Proves on devnet:
//   - escrow A to a builder WITHOUT an RLUSD trust line -> preflight ok:false `no_trustline`, nothing submitted:
//     the escrow is still open and no tx on source/builder/submitter carries the fulfillment
//   - builder opens the trust line -> preflight ok -> finishEscrow (preflights again) -> tesSUCCESS
//   - escrow B with a short CancelAfter -> preflight ok while outside the margin, refused once inside it
//     (finishEscrow throws UnsafeReleaseError without submitting), then EscrowCancel after CancelAfter
// Env: SPIKE_MARGIN_S=60 (preflight margin for escrow B), SPIKE_LLS_OFFSET=10.
import { disconnect, getClient, ledgerTime, waitForLedgerTimeAfter } from "../src/client.ts";
import { generateMilestoneCondition } from "../src/condition.ts";
import { cancelEscrow, createMilestoneEscrow, finishEscrow } from "../src/escrow.ts";
import { preflightFinish, UnsafeReleaseError, type PreflightRequest, type PreflightResult } from "../src/preflight.ts";
import { configureIssuer, ensureTrustline, issueRlusd, rlusdBalance } from "../src/rlusd.ts";
import { Spike } from "./spike-lib.ts";

const MARGIN_S = Number(process.env.SPIKE_MARGIN_S ?? 60);
const LLS_OFFSET = Number(process.env.SPIKE_LLS_OFFSET ?? 10);

const spike = new Spike("spike-xrpl14-preflight");
const ROLES = ["issuer", "source", "builder", "release"] as const;

function check(step: string, r: PreflightResult, expect: { ok: true } | { ok: false; reason: string }): void {
  const got = r.ok ? "ok" : `refused: ${r.reason}`;
  const want = expect.ok ? "ok" : `refused: ${expect.reason}`;
  spike.rows.push({ step: `preflight ${step}`, result: got, ...(got === want ? {} : { expected: want }) });
  const extra = r.ok ? `fee ${r.details.recommendedFee} drops, LLS ${r.details.lastLedgerSequence}, ${r.details.secondsToCancelAfter}s to CancelAfter` : r.message;
  spike.log(`  ${got === want ? "✔" : "✘"} preflight ${step}: ${got} (${extra}) @ ledger ${r.details.ledgerIndex}`);
  if (got !== want) throw new Error(`preflight ${step}: expected ${want}, got ${got}`);
}

/** No validated tx touching these accounts contains the secret (fulfillment or its preimage) or finishes `offerSequence`. */
async function assertNotLeaked(accounts: string[], fulfillment: string, offerSequence: number): Promise<void> {
  const client = await getClient();
  const preimage = fulfillment.slice(8);
  for (const account of accounts) {
    const res = await client.request({ command: "account_tx", account, ledger_index_min: -1, ledger_index_max: -1, limit: 200 });
    const blob = JSON.stringify(res.result.transactions).toUpperCase();
    if (blob.includes(fulfillment) || blob.includes(preimage)) throw new Error(`fulfillment leaked in a tx of ${account}`);
    const finishes = res.result.transactions.filter((t) => {
      const tx = (t.tx_json ?? {}) as { TransactionType?: string; OfferSequence?: number };
      return tx.TransactionType === "EscrowFinish" && tx.OfferSequence === offerSequence;
    }).length;
    if (finishes) throw new Error(`${account} has ${finishes} EscrowFinish tx(s) for seq ${offerSequence}`);
  }
}

try {
  const w = await spike.fund(ROLES);
  const issuer = w.issuer.classicAddress;
  const builder = w.builder.classicAddress;
  const submitter = w.release.classicAddress;

  for (const tx of await configureIssuer(w.issuer)) spike.rows.push({ step: "issuer AccountSet", result: tx.result, hash: tx.hash });
  await spike.ok("TrustSet source", () => ensureTrustline(w.source, issuer));
  await spike.ok("RLUSD -> source 500", () => issueRlusd(w.issuer, w.source.classicAddress, "500"));

  // Two conditional RLUSD escrows to a builder that has NO trust line yet.
  const a = generateMilestoneCondition();
  const b = generateMilestoneCondition();
  const t0 = await ledgerTime();
  const cancelA = t0 + 900;
  const cancelB = t0 + MARGIN_S + 75;
  const create = async (amount: string, condition: string, cancelAfter: number) =>
    createMilestoneEscrow({ spv: w.source.classicAddress, builder, issuer, amount, condition, cancelAfter, singleKey: w.source });
  const escA = await create("100", a.condition, cancelA);
  spike.rows.push({ step: "EscrowCreate A 100 RLUSD -> builder (no trust line), CancelAfter +900s", result: escA.tx.result, hash: escA.tx.hash });
  spike.log(`  ✔ EscrowCreate A seq ${escA.offerSequence}: ${escA.tx.explorerUrl}`);
  const escB = await create("50", b.condition, cancelB);
  spike.rows.push({ step: `EscrowCreate B 50 RLUSD -> builder, CancelAfter +${MARGIN_S + 75}s`, result: escB.tx.result, hash: escB.tx.hash });
  spike.log(`  ✔ EscrowCreate B seq ${escB.offerSequence}: ${escB.tx.explorerUrl}`);

  const reqA: PreflightRequest = { owner: escA.owner, offerSequence: escA.offerSequence, destination: builder, condition: a.condition, fulfillment: a.fulfillment, submitter };
  const reqB: PreflightRequest = { owner: escB.owner, offerSequence: escB.offerSequence, destination: builder, condition: b.condition, fulfillment: b.fulfillment, submitter, marginS: MARGIN_S, lastLedgerOffset: LLS_OFFSET };

  // 1. No trust line -> refused, and finishEscrow refuses too (nothing submitted).
  check("A (builder has no trust line)", await preflightFinish(reqA), { ok: false, reason: "no_trustline" });
  try {
    await finishEscrow({ submitter: w.release, owner: escA.owner, offerSequence: escA.offerSequence, condition: a.condition, fulfillment: a.fulfillment });
    throw new Error("finishEscrow should have refused");
  } catch (e) {
    if (!(e instanceof UnsafeReleaseError)) throw e;
    spike.rows.push({ step: "finishEscrow A (no trust line) -> UnsafeReleaseError, not submitted", result: `${e.code}/${e.reason}` });
    spike.log(`  ✔ finishEscrow A refused client-side: ${e.message}`);
  }
  check("A with B's fulfillment (wrong secret)", await preflightFinish({ ...reqA, condition: undefined, fulfillment: b.fulfillment }), { ok: false, reason: "condition_mismatch" });
  const stillOpen = await preflightFinish({ owner: escA.owner, offerSequence: escA.offerSequence });
  if (!stillOpen.details.escrow) throw new Error("escrow A should still be open");
  await assertNotLeaked([w.source.classicAddress, builder, submitter], a.fulfillment, escA.offerSequence);
  spike.rows.push({ step: "escrow A still open; no tx on source/builder/submitter contains A's fulfillment", result: "verified" });
  spike.log("  ✔ escrow A still open, fulfillment not on ledger");

  // 2. Builder opens the trust line -> preflight ok -> finish succeeds.
  await spike.ok("TrustSet builder", () => ensureTrustline(w.builder, issuer));
  check("A (after builder trust line)", await preflightFinish(reqA), { ok: true });
  await spike.ok("EscrowFinish A (preflighted, fee/LLS from preflight)", () =>
    finishEscrow({ submitter: w.release, owner: escA.owner, offerSequence: escA.offerSequence, condition: a.condition, fulfillment: a.fulfillment }),
  );
  spike.note(`builder RLUSD after finish A: ${await rlusdBalance(builder, issuer)}`);
  check("A after finish", await preflightFinish(reqA), { ok: false, reason: "escrow_not_found" });

  // 3. Short CancelAfter: ok outside the margin, refused inside it.
  check(`B (outside ${MARGIN_S}s margin)`, await preflightFinish(reqB), { ok: true });
  spike.log(`  waiting for ledger time > CancelAfter_B - ${MARGIN_S}s ...`);
  await waitForLedgerTimeAfter(cancelB - MARGIN_S);
  check(`B (inside ${MARGIN_S}s margin)`, await preflightFinish(reqB), { ok: false, reason: "expired_or_too_close" });
  try {
    await finishEscrow({ submitter: w.release, owner: escB.owner, offerSequence: escB.offerSequence, condition: b.condition, fulfillment: b.fulfillment });
    throw new Error("finishEscrow B should have refused");
  } catch (e) {
    if (!(e instanceof UnsafeReleaseError)) throw e;
    spike.rows.push({ step: "finishEscrow B (inside margin) -> UnsafeReleaseError, not submitted", result: `${e.code}/${e.reason}` });
    spike.log(`  ✔ finishEscrow B refused client-side: ${e.message}`);
  }
  await assertNotLeaked([w.source.classicAddress, builder, submitter], b.fulfillment, escB.offerSequence);
  spike.log("  waiting for CancelAfter_B ...");
  await waitForLedgerTimeAfter(cancelB);
  check("B (past CancelAfter)", await preflightFinish(reqB), { ok: false, reason: "expired_or_too_close" });
  await spike.ok("EscrowCancel B (refund to source)", () => cancelEscrow({ submitter: w.release, owner: escB.owner, offerSequence: escB.offerSequence }));
  await assertNotLeaked([w.source.classicAddress, builder, submitter], b.fulfillment, escB.offerSequence);
  spike.rows.push({ step: "B's fulfillment never appeared on ledger", result: "verified" });
  spike.note(`source RLUSD after cancel B: ${await rlusdBalance(w.source.classicAddress, issuer)} (500 - 100 released)`);

  spike.print();
  console.log(`\nrun record: ${spike.save()}`);
} finally {
  await disconnect();
}
