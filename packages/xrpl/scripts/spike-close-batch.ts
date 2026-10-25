// XRPL-13b devnet proof: atomic escrows in the main close path (closeLoanAndCreateEscrows, escrowMode "batch") and
// recovery of a partial close (resumeEscrowCreation).
//   WALLETS_FILE=.data/wallets.<you>.json pnpm --filter @xrlp/xrpl bootstrap           (once)
//   WALLETS_FILE=.data/wallets.<you>.json pnpm --filter @xrlp/xrpl spike:close-batch   (~6 min)
// Three fresh projects (SPV + closed-ended vault + broker + cover each), funded by investor1, conditions from the script
// (stand-in for core's release service):
//   A  default close, 3 milestones → LoanSet, then ONE tfAllOrNothing Batch with 3 inner EscrowCreates. SPV liquid ≈ 0,
//      3 escrows open; reports the LoanSet / Batch ledger indexes (how long the SPV held liquid principal).
//   B  rollback: the issuer freezes the SPV's RLUSD line right after LoanSet (onTx hook) → the Batch is tesSUCCESS on
//      ledger but no inner EscrowCreate applies (tfAllOrNothing) → CloseLoanPartialError with all 3 pending; unfreeze →
//      resumeEscrowCreation(err) creates all 3 in one Batch → resuming again submits nothing.
//   C  sequential partial: freeze after m1's EscrowCreate → m2's EscrowCreate fails ON-LEDGER (tecFROZEN) →
//      CloseLoanPartialError created [m1], pending [m2, m3]; unfreeze → resume creates m2 + m3 → resume again: nothing.
// Env: SPIKE_SUBSCRIPTION_S=90, SPIKE_PAYMENT_INTERVAL_S=300.
import type { Project } from "@xrlp/shared";
import { rippleTimeToISOTime, TrustSetFlags } from "xrpl";
import { closeLoanAndCreateEscrows, depositToVault, resumeEscrowCreation, setupProjectOnChain, type CloseLoanResult, type CloseTxEvent } from "../src/api.ts";
import { disconnect, getClient, ledgerTime, signAndSubmit, type TxResult } from "../src/client.ts";
import { CloseLoanPartialError } from "../src/loan-close.ts";
import { getBalance, getLoanSnapshot, listEscrowsParsed } from "../src/reads.ts";
import { rlusdAmount } from "../src/rlusd.ts";
import { loadWallets } from "../src/wallets.ts";
import { testConditionPairs } from "../test/support/conditions.ts";
import { Spike } from "./spike-lib.ts";

const SUBSCRIPTION_S = Number(process.env.SPIKE_SUBSCRIPTION_S ?? 90);
const PAYMENT_INTERVAL_S = Number(process.env.SPIKE_PAYMENT_INTERVAL_S ?? 300);
const PAYMENT_TOTAL = 3;
const PRINCIPAL = "3000";

const spike = new Spike("spike-xrpl13b-close-batch");
const w = loadWallets();
const issuer = w.issuer.classicAddress;
const schedule = { paymentTotal: PAYMENT_TOTAL, paymentIntervalS: PAYMENT_INTERVAL_S };

function projectFor(label: string): Project {
  const id = `spike13b-${label}-${Date.now().toString(36)}`;
  return {
    id,
    name: `XRPL-13b ${label}`,
    type: "residential_new",
    builderId: "builder-1",
    siteAddress: "1 Spike St",
    siteGeo: { lat: 40.7, lng: -74, radiusM: 100 },
    description: "XRPL-13b devnet proof",
    terms: { principal: PRINCIPAL, interestRateBps: 1000, termDays: 30, paymentIntervalDays: 10, fundingDeadline: new Date(Date.now() + 86_400_000).toISOString() },
    status: "funding",
    milestones: [
      { id: `${id}-m1`, index: 0, templateKey: "foundation", title: "Foundation", amount: "1000", requiredInspectors: 1, status: "pending" },
      { id: `${id}-m2`, index: 1, templateKey: "framing", title: "Framing", amount: "1200", requiredInspectors: 1, status: "pending" },
      { id: `${id}-m3`, index: 2, templateKey: "dry_in", title: "Roof & Dry-in", amount: "800", requiredInspectors: 1, status: "pending" },
    ],
    chain: {},
  };
}

/** Setup + deposit; the vault's Subscription ends SUBSCRIPTION_S after this call starts. */
async function stage(label: string): Promise<{ project: Project; conditions: string[]; spv: string }> {
  const project = projectFor(label);
  const subEnd = (await ledgerTime()) + SUBSCRIPTION_S + 45; // the SPV faucet funding runs first inside setup
  const setup = await setupProjectOnChain(project, {
    subscriptionEndsAt: new Date(rippleTimeToISOTime(subEnd) as string),
    redemptionAt: new Date(rippleTimeToISOTime(subEnd + PAYMENT_INTERVAL_S * PAYMENT_TOTAL + 60 + 300) as string),
    ...schedule,
  });
  for (const [k, t] of Object.entries(setup.txs)) spike.rows.push({ step: `${label}: ${k}`, result: t.result, hash: t.hash });
  project.chain = { spv: setup.spv, vaultId: setup.vaultId, loanBrokerId: setup.loanBrokerId, shareMptIssuanceId: setup.shareMptIssuanceId };
  spike.accounts[`spv${label}`] = setup.spv;
  await spike.ok(`${label}: VaultDeposit investor1 ${PRINCIPAL}`, async () => (await depositToVault({ projectId: project.id, vaultId: setup.vaultId, investor: "investor1", amount: PRINCIPAL })).tx);
  spike.note(`${label}: SPV ${setup.spv}, vault ${setup.vaultId}, subscription ends ${setup.subscriptionEndsAt}`);
  return { project, conditions: testConditionPairs(project.milestones.length).map((p) => p.condition), spv: setup.spv };
}

/** Issuer freezes / unfreezes the SPV's RLUSD trust line (TrustSet from the issuer side). */
async function setFreeze(label: string, spv: string, freeze: boolean): Promise<TxResult> {
  const tx = await signAndSubmit(w.issuer, {
    TransactionType: "TrustSet",
    Account: issuer,
    LimitAmount: rlusdAmount(spv, "0"),
    Flags: freeze ? TrustSetFlags.tfSetFreeze : TrustSetFlags.tfClearFreeze,
  });
  spike.rows.push({ step: `${label}: issuer TrustSet ${freeze ? "tfSetFreeze" : "tfClearFreeze"} on the SPV's RLUSD line`, result: tx.result, hash: tx.hash });
  spike.log(`  ✔ ${label}: ${freeze ? "freeze" : "unfreeze"} SPV line ${tx.explorerUrl}`);
  return tx;
}

/** Sequence + RLUSD of the SPV: proves a call submitted nothing. */
async function fingerprint(spv: string): Promise<string> {
  const client = await getClient();
  const info = await client.request({ command: "account_info", account: spv, ledger_index: "validated" });
  return `seq${info.result.account_data.Sequence}:${await getBalance(spv, "RLUSD", { issuer })}`;
}

const logTx = (label: string) => (e: CloseTxEvent) => spike.log(`    · ${label} ${e.step}${e.milestoneIds.length ? ` [${e.milestoneIds.map((m) => m.split("-").pop()).join(", ")}]` : ""}: ${e.tx.result} ${e.tx.explorerUrl}`);

/** Rows for a completed close / resume: Batch + its inner EscrowCreates (or the standalone EscrowCreates). */
function recordEscrows(label: string, r: CloseLoanResult, created: string[] = r.escrows.map((e) => e.milestoneId)) {
  if (r.batchTx) spike.rows.push({ step: `${label}: Batch outer=SPV (multisig 3/4), tfAllOrNothing, ${created.length} × EscrowCreate (ledger ${r.batchTx.ledgerIndex})`, result: r.batchTx.result, hash: r.batchTx.hash });
  for (const e of r.escrows) {
    if (!created.includes(e.milestoneId)) continue;
    spike.rows.push({ step: `${label}:   ↳ ${r.batchTx ? "inner " : ""}EscrowCreate ${e.milestoneId.split("-").pop()} ${e.amount} (OfferSequence ${e.offerSequence})`, result: "tesSUCCESS", hash: e.createTx });
  }
}

async function assertClosed(label: string, spv: string, loanId: string) {
  const liquid = await getBalance(spv, "RLUSD", { issuer });
  const escrows = await listEscrowsParsed(spv);
  const escrowed = escrows.reduce((a, e) => a + Number(e.amount), 0);
  const loan = await getLoanSnapshot(loanId);
  spike.note(`${label}: SPV liquid RLUSD ${liquid}; ${escrows.length} open escrows = ${escrowed} RLUSD; loan ${loanId} principalOutstanding ${loan?.principalOutstanding}`);
  if (Number(liquid) > 0.000001) throw new Error(`${label}: SPV still holds ${liquid} RLUSD`);
  if (escrows.length !== 3 || escrowed !== Number(PRINCIPAL)) throw new Error(`${label}: expected 3 escrows = ${PRINCIPAL}, got ${escrows.length} = ${escrowed}`);
}

/** Second resume: must submit nothing (SPV Sequence + balance unchanged, no tx returned). */
async function resumeAgainIsNoop(label: string, err: CloseLoanPartialError, spv: string) {
  const before = await fingerprint(spv);
  const again = await resumeEscrowCreation(err);
  const after = await fingerprint(spv);
  if (again.resumed.submitted.length || again.resumed.created.length || before !== after) throw new Error(`${label}: resume re-run submitted something (${before} → ${after})`);
  spike.rows.push({ step: `${label}: resumeEscrowCreation(err) again → found ${again.resumed.alreadyPresent.map((p) => `${p.milestoneId.split("-").pop()}:${p.source}`).join(", ")}`, result: "nothing submitted (SPV Sequence + RLUSD unchanged)" });
  spike.log(`  ✔ ${label}: resume again submitted nothing (${after})`);
}

try {
  spike.accounts.platform = w.platform.classicAddress;
  spike.accounts.builder = w.builder.classicAddress;
  spike.accounts.issuer = issuer;

  spike.log("0. stage three projects (A, B, C)");
  const A = await stage("A");
  const B = await stage("B");
  const C = await stage("C");
  const countdown = (s: number) => process.stdout.write(`\r  waiting for Investment phase: ${s}s   `);

  // ---- A: batch-mode close (the default for 3 milestones)
  spike.log("\nA. closeLoanAndCreateEscrows (default escrowMode → batch)");
  const a = await closeLoanAndCreateEscrows(A.project, { conditions: A.conditions, ...schedule, onWait: countdown, onTx: logTx("A") });
  console.log();
  if (a.originationFeeTopUpTx) spike.rows.push({ step: `A: builder → SPV origination-fee shortfall ${a.originationFee}`, result: a.originationFeeTopUpTx.result, hash: a.originationFeeTopUpTx.hash });
  spike.rows.push({ step: `A: LoanSet (platform Account, SPV 3-of-4 countersign) (ledger ${a.loanSetTx.ledgerIndex})`, result: a.loanSetTx.result, hash: a.loanSetTx.hash });
  recordEscrows("A", a);
  if (a.escrowMode !== "batch" || !a.batchTx) throw new Error("A: expected escrowMode batch");
  const held = (a.batchTx.ledgerIndex ?? 0) - (a.loanSetTx.ledgerIndex ?? 0);
  const client = await getClient();
  const closeOf = async (i?: number) => (i ? (await client.request({ command: "ledger", ledger_index: i })).result.ledger.close_time : 0);
  const heldS = (await closeOf(a.batchTx.ledgerIndex)) - (await closeOf(a.loanSetTx.ledgerIndex));
  spike.note(`A: LoanSet ledger ${a.loanSetTx.ledgerIndex} → Batch ledger ${a.batchTx.ledgerIndex}: the SPV held liquid principal for ${held} ledger(s) (~${heldS}s of ledger time)`);
  for (const e of a.escrows) {
    const t = (await client.request({ command: "tx", transaction: e.createTx })).result as unknown as { meta: { ParentBatchID?: string; TransactionResult: string } };
    if (t.meta.ParentBatchID !== a.batchTx.hash || t.meta.TransactionResult !== "tesSUCCESS") throw new Error(`A: ${e.createTx} is not a tesSUCCESS inner tx of ${a.batchTx.hash}`);
  }
  spike.note(`A: every escrows[i].createTx is an inner EscrowCreate with ParentBatchID = ${a.batchTx.hash}; txs = [${a.txs.map((t) => t.tx.TransactionType).join(", ")}]`);
  await assertClosed("A", A.spv, a.loanId);

  // ---- B: the Batch rolls back (freeze after LoanSet) → CloseLoanPartialError (all pending) → resume
  spike.log("\nB. closeLoanAndCreateEscrows, issuer freezes the SPV line right after LoanSet");
  const errB = await closeLoanAndCreateEscrows(B.project, {
    conditions: B.conditions,
    ...schedule,
    onWait: countdown,
    onTx: async (e) => {
      logTx("B")(e);
      if (e.step === "loan_set") {
        spike.rows.push({ step: `B: LoanSet (ledger ${e.tx.ledgerIndex})`, result: e.tx.result, hash: e.tx.hash });
        await setFreeze("B", B.spv, true);
      }
    },
  }).then(
    () => {
      throw new Error("B: expected CloseLoanPartialError");
    },
    (e: unknown) => e,
  );
  console.log();
  if (!(errB instanceof CloseLoanPartialError)) throw errB;
  const bb = errB.context?.batch;
  spike.rows.push({ step: `B: Batch outer=SPV, 3 × EscrowCreate on a frozen line → outer applied, inners rolled back (outcome ${bb?.outcome})`, result: "tesSUCCESS", ...(bb?.hash ? { hash: bb.hash } : {}) });
  spike.note(`B: CloseLoanPartialError txResult ${errB.txResult}, created [${errB.created.map((c) => c.milestoneId).join(", ")}], pending [${errB.pending.map((m) => m.split("-").pop()).join(", ")}], batch ${JSON.stringify(bb)}`);
  if (errB.created.length || errB.pending.length !== 3 || bb?.outcome !== "rolled_back") throw new Error("B: expected a rolled-back Batch with all 3 pending");
  const bLiquid = await getBalance(B.spv, "RLUSD", { issuer });
  const bEscrows = (await listEscrowsParsed(B.spv)).length;
  spike.note(`B: after the rollback the SPV holds ${bLiquid} RLUSD liquid and ${bEscrows} escrows (all or nothing: nothing)`);
  if (bEscrows !== 0) throw new Error("B: rollback left escrows behind");
  await setFreeze("B", B.spv, false);
  const rB = await resumeEscrowCreation(errB, { onTx: logTx("B resume") });
  recordEscrows("B resume", rB, rB.resumed.created);
  spike.note(`B: resume created [${rB.resumed.created.map((m) => m.split("-").pop()).join(", ")}] in ${rB.escrowMode} mode (Batch ${rB.batchTx?.hash})`);
  await assertClosed("B", B.spv, rB.loanId);
  await resumeAgainIsNoop("B", errB, B.spv);

  // ---- C: sequential partial (m2 fails on-ledger) → resume
  spike.log("\nC. closeLoanAndCreateEscrows escrowMode sequential, issuer freezes the SPV line after m1");
  const m1 = C.project.milestones[0]!.id;
  const errC = await closeLoanAndCreateEscrows(C.project, {
    conditions: C.conditions,
    escrowMode: "sequential",
    ...schedule,
    onWait: countdown,
    onTx: async (e) => {
      logTx("C")(e);
      if (e.step === "loan_set") spike.rows.push({ step: `C: LoanSet (ledger ${e.tx.ledgerIndex})`, result: e.tx.result, hash: e.tx.hash });
      if (e.step === "escrow_create") spike.rows.push({ step: `C: EscrowCreate m1 (sequential)`, result: e.tx.result, hash: e.tx.hash });
      if (e.step === "escrow_create" && e.milestoneIds[0] === m1) await setFreeze("C", C.spv, true);
    },
  }).then(
    () => {
      throw new Error("C: expected CloseLoanPartialError");
    },
    (e: unknown) => e,
  );
  console.log();
  if (!(errC instanceof CloseLoanPartialError)) throw errC;
  spike.rows.push({ step: "C: EscrowCreate m2 on the frozen line (on-ledger tec)", result: String(errC.txResult), ...(errC.txHash ? { hash: errC.txHash } : {}) });
  spike.note(`C: CloseLoanPartialError created [${errC.created.map((c) => c.milestoneId.split("-").pop()).join(", ")}], pending [${errC.pending.map((m) => m.split("-").pop()).join(", ")}], ${errC.txResult} ${errC.txHash}`);
  if (errC.created.length !== 1 || errC.pending.length !== 2 || !errC.txResult?.startsWith("tec")) throw new Error("C: expected m1 created, m2/m3 pending, on-ledger tec");
  await setFreeze("C", C.spv, false);
  const rC = await resumeEscrowCreation(errC, { onTx: logTx("C resume") });
  recordEscrows("C resume", rC, rC.resumed.created);
  spike.note(`C: resume created [${rC.resumed.created.map((m) => m.split("-").pop()).join(", ")}] in ${rC.escrowMode} mode; m1 kept (${rC.resumed.alreadyPresent.map((p) => `${p.milestoneId.split("-").pop()}:${p.source}`).join(", ")})`);
  await assertClosed("C", C.spv, rC.loanId);
  await resumeAgainIsNoop("C", errC, C.spv);

  spike.print();
  console.log(`\nrecord: ${spike.save({ A: { loanId: a.loanId, batch: a.batchTx.hash }, B: { loanId: errB.loanId, rolledBack: bb?.hash, resumeBatch: rB.batchTx?.hash }, C: { loanId: errC.loanId, failed: errC.txHash, resumeBatch: rC.batchTx?.hash } })}`);
} catch (e) {
  spike.print();
  console.error(`\nrecord: ${spike.save({ error: String(e) })}`);
  throw e;
} finally {
  await disconnect();
}
