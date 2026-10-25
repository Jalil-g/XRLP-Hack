// XRPL-07 devnet test: finish, cancel, repay, withdraw through the high-level API (src/api.ts).
//   WALLETS_FILE=.data/wallets.jalil.json pnpm --filter @xrlp/xrpl spike:release      (~7 min)
// Uses the bootstrap wallet store (bootstrapWallets is idempotent) and a fresh project each run:
//   SPV (v2 multisig) + closed-ended vault + broker + cover, 3 investors deposit, LoanSet + 2 escrows, then
//   1. EscrowCancel before CancelAfter        -> TooSoonError client-side, nothing submitted
//   2. VaultWithdraw before RedemptionDate    -> TooSoonError client-side, nothing submitted
//   3. tryFinishWithWrongFulfillment (m1)     -> tecCRYPTOCONDITION_ERROR on-ledger, event release_refused
//   4. releaseMilestone (m1, releaseService)  -> tesSUCCESS, builder paid
//   5. builderPayToSpv + repayLoan(builder)   -> one periodic LoanPay; AssetsTotal / share price before/after
//   6. repayLoan below one periodic payment   -> LoanPayAmountError client-side, nothing submitted
//   7. cancelExpiredMilestone (m2) + repayLoan(escrow_refund) -> overpayment LoanPay of the refund
//   8. wait for RedemptionDate, withdrawFromVault -> tesSUCCESS
// Terms: the interest RATE is the protocol max (100 %/yr) so a few minutes of interest show up in AssetsTotal;
// a real loan reaches the same share-price move with a normal rate over days. Env knobs below.
import { rippleTimeToISOTime } from "xrpl";
import { TooSoonError, type Project } from "@xrlp/shared";
import {
  bootstrapWallets,
  builderPayToSpv,
  cancelExpiredMilestone,
  closeLoanAndCreateEscrows,
  depositToVault,
  disconnect,
  getClient,
  getLoan,
  getShareBalance,
  getVaultSnapshot,
  ledgerTime,
  LoanPayAmountError,
  planLoanPayment,
  releaseMilestone,
  repayLoan,
  rlusdBalance,
  setupProjectOnChain,
  tryFinishWithWrongFulfillment,
  waitForLedgerTimeAfter,
  withdrawFromVault,
} from "../src/index.ts";
import { testConditionPair } from "../test/support/conditions.ts";
import { Spike } from "./spike-lib.ts";

const env = (k: string, d: number) => Number(process.env[k] ?? d);
const SUBSCRIPTION_S = env("SPIKE_SUBSCRIPTION_S", 45);
const PAYMENT_INTERVAL_S = env("SPIKE_PAYMENT_INTERVAL_S", 60);
const PAYMENT_TOTAL = 3;
const PRINCIPAL = "40000";
const M1 = "16000"; // finished -> builder; >= one periodic payment so the builder can repay from it
const M2 = "24000"; // cancelled -> refund -> overpayment LoanPay
const INTEREST_BPS = 10_000; // 100 %/yr = XLS-66 max (InterestRate 100000)
const WITHDRAW = "1000";

const spike = new Spike("spike-xrpl07-release");
const tick = (label: string) => (s: number) => process.stdout.write(`\r  … waiting for ${label}: ~${s}s   `);

async function accountSequence(address: string): Promise<number> {
  const client = await getClient();
  const r = await client.request({ command: "account_info", account: address, ledger_index: "current" });
  return r.result.account_data.Sequence;
}

/** Must throw `cls` BEFORE anything is submitted: `who`'s Sequence is unchanged. */
async function refusedClientSide(step: string, who: string, cls: new (...a: never[]) => Error, run: () => Promise<unknown>): Promise<void> {
  const before = await accountSequence(who);
  try {
    await run();
  } catch (e) {
    if (!(e instanceof cls)) throw e;
    const after = await accountSequence(who);
    if (after !== before) throw new Error(`${step}: refused but ${who} Sequence moved ${before} -> ${after}`);
    spike.rows.push({ step, result: `${(e as Error).name} (client-side, Sequence ${before} unchanged)` });
    spike.log(`  ✔ ${step}: ${(e as Error).message}`);
    return;
  }
  throw new Error(`${step}: expected ${cls.name}, but it went through`);
}

async function vaultLine(label: string, vaultId: string): Promise<{ assetsTotal: string; sharePrice: string }> {
  const v = (await getVaultSnapshot(vaultId))!;
  spike.note(`${label}: AssetsTotal ${v.assetsTotal}, AssetsAvailable ${v.assetsAvailable}, sharePrice ${v.sharePrice}, phase ${v.phase}`);
  return v;
}

try {
  const { wallets: w, txs } = await bootstrapWallets({ log: (s) => console.log(`  ${s}`) });
  txs.forEach((t, i) => spike.rows.push({ step: `bootstrap #${i + 1}`, result: t.result, hash: t.hash }));
  const issuer = w.issuer.classicAddress;
  for (const r of ["platform", "builder", "releaseService", "trustee", "investor1", "investor2", "investor3"] as const) spike.accounts[r] = w[r].classicAddress;

  const projectId = `xrpl07-${Date.now().toString(36)}`;
  const project: Project = {
    id: projectId,
    name: "XRPL-07 spike",
    type: "residential_new",
    builderId: "builder-1",
    siteAddress: "12 Maple St, Brooklyn NY",
    siteGeo: { lat: 40.6782, lng: -73.9442, radiusM: 150 },
    description: "XRPL-07 devnet test",
    terms: { principal: PRINCIPAL, interestRateBps: INTEREST_BPS, termDays: 3, paymentIntervalDays: 1, fundingDeadline: new Date(Date.now() + 86_400_000).toISOString() },
    status: "funding",
    milestones: [
      { id: `${projectId}-m1`, index: 0, templateKey: "foundation", title: "Foundation", amount: M1, requiredInspectors: 1, status: "pending" },
      { id: `${projectId}-m2`, index: 1, templateKey: "framing", title: "Framing", amount: M2, requiredInspectors: 1, status: "pending" },
    ],
    chain: {},
  };
  const [m1, m2] = project.milestones as [Project["milestones"][0], Project["milestones"][0]];

  // ── setup: SPV + closed-ended vault (short RedemptionDate) + broker + cover ───────────────────────
  const now0 = await ledgerTime();
  const subEnd = now0 + SUBSCRIPTION_S + 45; // SPV faucet funding happens first inside setup
  const redemption = subEnd + PAYMENT_INTERVAL_S * PAYMENT_TOTAL + 60 + 60 + 30;
  const setup = await setupProjectOnChain(project, {
    subscriptionEndsAt: new Date(rippleTimeToISOTime(subEnd)),
    redemptionAt: new Date(rippleTimeToISOTime(redemption)),
    paymentTotal: PAYMENT_TOTAL,
    paymentIntervalS: PAYMENT_INTERVAL_S,
  });
  for (const [k, t] of Object.entries(setup.txs)) spike.rows.push({ step: `setup ${k}`, result: t.result, hash: t.hash });
  project.chain = { spv: setup.spv, vaultId: setup.vaultId, loanBrokerId: setup.loanBrokerId, shareMptIssuanceId: setup.shareMptIssuanceId };
  spike.accounts.spv = setup.spv;
  spike.note(`vault ${setup.vaultId}, subscription ends ${setup.subscriptionEndsAt}, redemption ${setup.redemptionAt}, cover ${setup.cover.amount}`);

  for (const [inv, amt] of [["investor1", "15000"], ["investor2", "15000"], ["investor3", "10000"]] as const) {
    await spike.ok(`VaultDeposit ${inv} ${amt}`, async () => (await depositToVault({ projectId, vaultId: setup.vaultId, investor: inv, amount: amt })).tx);
  }
  await vaultLine("after deposits", setup.vaultId);

  // ── close: LoanSet + 2 escrows (m2 expires soon, m1 before loan maturity) ──────────────────────────
  const secrets = { [m1.id]: testConditionPair(), [m2.id]: testConditionPair() };
  m1.cancelAfter = rippleTimeToISOTime(subEnd + PAYMENT_INTERVAL_S * PAYMENT_TOTAL - 5);
  m2.cancelAfter = rippleTimeToISOTime(subEnd + PAYMENT_INTERVAL_S + 30);
  await waitForLedgerTimeAfter(subEnd, tick("Investment phase"));
  process.stdout.write("\n");
  const close = await closeLoanAndCreateEscrows(project, {
    conditions: Object.fromEntries(Object.entries(secrets).map(([id, c]) => [id, c.condition])),
    paymentTotal: PAYMENT_TOTAL,
    paymentIntervalS: PAYMENT_INTERVAL_S,
  });
  if (close.originationFeeTopUpTx) spike.rows.push({ step: `builder -> SPV origination fee ${close.originationFee}`, result: close.originationFeeTopUpTx.result, hash: close.originationFeeTopUpTx.hash });
  spike.rows.push({ step: `LoanSet ${PRINCIPAL} @ ${INTEREST_BPS / 100}%/yr, ${PAYMENT_TOTAL} x ${PAYMENT_INTERVAL_S}s, tfLoanOverpayment`, result: close.loanSetTx.result, hash: close.loanSetTx.hash });
  for (const e of close.escrows) {
    spike.rows.push({ step: `EscrowCreate ${e.milestoneId.slice(-2)} ${e.amount} (CancelAfter ${e.cancelAfter})`, result: "tesSUCCESS", hash: e.createTx });
  }
  const [e1, e2] = close.escrows as [(typeof close.escrows)[0], (typeof close.escrows)[0]];
  const loan0 = (await getLoan(close.loanId))!;
  spike.note(`loan ${close.loanId}: PeriodicPayment ${loan0.PeriodicPayment}, TotalValueOutstanding ${loan0.TotalValueOutstanding}, NextPaymentDueDate ${rippleTimeToISOTime(loan0.NextPaymentDueDate!)}`);
  await vaultLine("after LoanSet", setup.vaultId);

  // 1. Cancel before CancelAfter -> TooSoonError, nothing submitted.
  await refusedClientSide("EscrowCancel m2 before CancelAfter", w.releaseService.classicAddress, TooSoonError, () =>
    cancelExpiredMilestone({ projectId, milestoneId: m2.id, escrow: e2.escrow }),
  );
  // 2. Withdraw in the Investment phase -> TooSoonError, nothing submitted.
  await refusedClientSide("VaultWithdraw investor1 before RedemptionDate", w.investor1.classicAddress, TooSoonError, () =>
    withdrawFromVault({ projectId, vaultId: setup.vaultId, investor: "investor1", amount: WITHDRAW }),
  );

  // 3. Wrong fulfillment -> tecCRYPTOCONDITION_ERROR on-ledger (resolves, does not throw).
  const steal = await tryFinishWithWrongFulfillment({ projectId, milestoneId: m1.id, owner: e1.owner, offerSequence: e1.offerSequence, condition: e1.condition });
  spike.rows.push({ step: `tryFinishWithWrongFulfillment m1 (platform) -> event ${steal.event.kind}`, result: steal.tx.result, hash: steal.tx.hash });
  spike.log(`  ✔ wrong fulfillment: ${steal.tx.result} ${steal.tx.explorerUrl}`);
  if (steal.tx.result !== "tecCRYPTOCONDITION_ERROR") throw new Error(`expected tecCRYPTOCONDITION_ERROR, got ${steal.tx.result}`);

  // 4. Release m1 (releaseService submits; preflight inside). Short-lived spike escrow -> smaller LLS margin.
  const b0 = await rlusdBalance(w.builder.classicAddress, issuer);
  const rel = await releaseMilestone({ projectId, milestoneId: m1.id, escrow: e1.escrow, fulfillment: secrets[m1.id]!.fulfillment, lastLedgerMargin: 20, marginS: 60 });
  spike.rows.push({ step: `releaseMilestone m1 (releaseService, Fee ${String(rel.tx.tx.Fee)} drops) -> event ${rel.event.kind} ${rel.event.amount}`, result: rel.tx.result, hash: rel.tx.hash });
  spike.note(`builder RLUSD ${b0} -> ${await rlusdBalance(w.builder.classicAddress, issuer)}; finish submitter ${String(rel.tx.tx.Account)} (releaseService ${w.releaseService.classicAddress}), LastLedgerSequence ${String(rel.tx.tx.LastLedgerSequence)} vs ledger ${rel.tx.ledgerIndex}`);

  // 5. Builder repays one periodic payment: builder -> SPV, then SPV LoanPay.
  const periodic = planLoanPayment({ loan: (await getLoan(close.loanId))!, nowRipple: await ledgerTime() }).minimum;
  const pay = await builderPayToSpv({ projectId, spv: setup.spv, amount: periodic });
  spike.rows.push({ step: `builderPayToSpv ${pay.amount}`, result: pay.tx.result, hash: pay.tx.hash });
  const before1 = await vaultLine("before builder LoanPay", setup.vaultId);
  const r1 = await repayLoan({ projectId, spv: setup.spv, loanId: close.loanId, amount: periodic, source: "builder" });
  spike.rows.push({ step: `repayLoan builder ${r1.amount} (mode ${r1.mode})`, result: r1.tx.result, hash: r1.tx.hash });
  const after1 = await vaultLine("after builder LoanPay", setup.vaultId);
  spike.note(`builder LoanPay: AssetsTotal ${before1.assetsTotal} -> ${after1.assetsTotal}, sharePrice ${before1.sharePrice} -> ${after1.sharePrice}`);

  // 6. Sub-periodic LoanPay -> refused client-side.
  await refusedClientSide("repayLoan 1000 (< one periodic payment)", setup.spv, LoanPayAmountError, () =>
    repayLoan({ projectId, spv: setup.spv, loanId: close.loanId, amount: "1000", mode: "overpayment" }),
  );

  // 7. m2 expires -> cancel (keeper) -> refund LoanPay with overpayment.
  const c = await cancelExpiredMilestone({ projectId, milestoneId: m2.id, escrow: e2.escrow, wait: true, onWait: tick("m2 CancelAfter") });
  process.stdout.write("\n");
  spike.rows.push({ step: `cancelExpiredMilestone m2 (releaseService) -> event ${c.event.kind} ${c.event.amount}`, result: c.tx.result, hash: c.tx.hash });
  const refund = c.event.amount!;
  const loanMid = (await getLoan(close.loanId))!;
  const before2 = await vaultLine("before refund LoanPay", setup.vaultId);
  const r2 = await repayLoan({ projectId, spv: setup.spv, loanId: close.loanId, amount: refund, source: "escrow_refund" });
  spike.rows.push({ step: `repayLoan escrow_refund ${r2.amount} (mode ${r2.mode})`, result: r2.tx.result, hash: r2.tx.hash });
  const loanEnd = (await getLoan(close.loanId))!;
  const after2 = await vaultLine("after refund LoanPay", setup.vaultId);
  spike.note(
    `refund LoanPay (${r2.mode}): PrincipalOutstanding ${loanMid.PrincipalOutstanding} -> ${loanEnd.PrincipalOutstanding}, PaymentRemaining ${loanMid.PaymentRemaining} -> ${loanEnd.PaymentRemaining}, ` +
      `PeriodicPayment ${loanMid.PeriodicPayment} -> ${loanEnd.PeriodicPayment}; AssetsTotal ${before2.assetsTotal} -> ${after2.assetsTotal}, sharePrice ${before2.sharePrice} -> ${after2.sharePrice}`,
  );
  spike.note(`SPV RLUSD after repayments: ${await rlusdBalance(setup.spv, issuer)}`);

  // 8. Redemption -> investor withdraw.
  await waitForLedgerTimeAfter(redemption - 1, tick("RedemptionDate"));
  process.stdout.write("\n");
  const sh0 = await getShareBalance(w.investor1.classicAddress, setup.shareMptIssuanceId);
  const i0 = await rlusdBalance(w.investor1.classicAddress, issuer);
  const wd = await withdrawFromVault({ projectId, vaultId: setup.vaultId, investor: "investor1", amount: WITHDRAW });
  spike.rows.push({ step: `withdrawFromVault investor1 ${WITHDRAW} (Redemption phase)`, result: wd.tx.result, hash: wd.tx.hash });
  spike.note(`investor1 shares ${sh0} -> ${await getShareBalance(w.investor1.classicAddress, setup.shareMptIssuanceId)}, RLUSD ${i0} -> ${await rlusdBalance(w.investor1.classicAddress, issuer)}`);
  await vaultLine("after withdraw", setup.vaultId);

  spike.print();
  console.log(`\nrun record: ${spike.save({ projectId, vaultId: setup.vaultId, loanId: close.loanId, events: [steal.event, rel.event, r1.event, c.event, r2.event, wd.event] })}`);
} catch (e) {
  spike.print();
  console.error(`\nrun record: ${spike.save({ error: String(e) })}`);
  throw e;
} finally {
  await disconnect();
}

