// pnpm --filter @xrlp/xrpl demo
// Full money path on XRPL devnet with real transactions. Reuses .data/wallets.json; creates a fresh
// project (SPV + closed-ended vault + broker + loan) each run.
//
// Env knobs:
//   DEMO_SPV_MODE=multisig|single   multisig (default): SPV locked before LoanSet; single: fallback,
//                                   SPV master key countersigns LoanSet + EscrowCreates, locked afterwards.
//   DEMO_WITHDRAW=1                 wait for vault Redemption (~10 min) and do an investor VaultWithdraw.
//   DEMO_SUBSCRIPTION_S=60          seconds of Subscription (deposit window) after VaultCreate.
//   DEMO_PAYMENT_INTERVAL_S=300     loan payment interval (4 payments -> periodic ~7.5k < the 9k refund).
//   DEMO_M3_CANCEL_S=150            milestone 3 CancelAfter, seconds after escrow creation.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChainEvent, Project } from "@xrlp/shared";
import { rippleTimeToISOTime } from "xrpl";
import {
  attestApproval,
  bootstrapWallets,
  cancelExpiredMilestone,
  closeLoanAndCreateEscrows,
  config,
  credentialStatus,
  depositToVault,
  disconnect,
  generateMilestoneCondition,
  getLoan,
  getShareBalance,
  getSpvInfo,
  getVaultStatus,
  issueCredential,
  ledgerTime,
  lockSpvAccount,
  releaseMilestone,
  repayLoan,
  rlusdBalance,
  setupProjectOnChain,
  sha256Hex,
  waitForLedgerTimeAfter,
  withdrawFromVault,
  type MilestoneCondition,
  type TxResult,
} from "../src/index.ts";
import { topUpRlusd } from "../src/rlusd.ts";
import { disableMasterKey } from "../src/spv.ts";

const env = (k: string, d: number) => Number(process.env[k] ?? d);
const SPV_MODE = (process.env.DEMO_SPV_MODE ?? "multisig") as "multisig" | "single";
const SUBSCRIPTION_S = env("DEMO_SUBSCRIPTION_S", 60);
const PAYMENT_INTERVAL_S = env("DEMO_PAYMENT_INTERVAL_S", 300);
const PAYMENT_TOTAL = 4;
const M3_CANCEL_S = env("DEMO_M3_CANCEL_S", 150);
const DO_WITHDRAW = process.env.DEMO_WITHDRAW === "1";

// ------------------------------------------------------------------ tx log
interface Row {
  step: string;
  type: string;
  result: string;
  url: string;
}
const rows: Row[] = [];
const notes: string[] = [];
function rec(step: string, tx: TxResult | undefined) {
  if (!tx) return;
  rows.push({ step, type: String(tx.tx.TransactionType ?? "?"), result: tx.result, url: tx.explorerUrl });
  console.log(`  ✓ ${step.padEnd(40)} ${tx.explorerUrl}`);
}
const events: ChainEvent[] = [];
const say = (s: string) => console.log(`\n== ${s}`);
const tick = (label: string) => (s: number) => process.stdout.write(`\r  … waiting ${label}: ~${s}s   `);

async function main() {
  const startedAt = new Date().toISOString();

  say("1. bootstrap wallets + RLUSD");
  const { wallets: w, txs } = await bootstrapWallets({ log: (s) => console.log("  " + s) });
  txs.forEach((t, i) => rec(`bootstrap #${i + 1}`, t));
  const issuer = w.issuer.classicAddress;

  say("2. credentials (VERIFIED_BUILDER, KYC_INVESTOR)");
  if ((await credentialStatus(w.builder.classicAddress, w.platform.classicAddress, "VERIFIED_BUILDER")) === "none") {
    const c = await issueCredential({ subject: "builder", type: "VERIFIED_BUILDER" });
    rec("CredentialCreate VERIFIED_BUILDER", c.createTx);
    rec("CredentialAccept VERIFIED_BUILDER", c.acceptTx);
    events.push(c.event);
  } else console.log("  builder already VERIFIED_BUILDER");
  for (const inv of ["investor1", "investor2", "investor3"] as const) {
    if ((await credentialStatus(w[inv].classicAddress, w.platform.classicAddress, "KYC_INVESTOR")) === "none") {
      const c = await issueCredential({ subject: inv, type: "KYC_INVESTOR" });
      rec(`CredentialCreate KYC_INVESTOR ${inv}`, c.createTx);
      rec(`CredentialAccept KYC_INVESTOR ${inv}`, c.acceptTx);
    } else console.log(`  ${inv} already KYC_INVESTOR`);
  }

  // ---- demo project (shape = @xrlp/shared Project)
  const projectId = `demo-${Date.now().toString(36)}`;
  const project: Project = {
    id: projectId,
    name: "Maple St duplex",
    type: "residential_new",
    builderId: "builder-1",
    siteAddress: "12 Maple St, Brooklyn NY",
    siteGeo: { lat: 40.6782, lng: -73.9442, radiusM: 150 },
    description: "Demo project",
    terms: {
      principal: "30000",
      interestRateBps: 1000, // 10% APR
      termDays: 30,
      paymentIntervalDays: 15,
      fundingDeadline: new Date(Date.now() + 86_400_000).toISOString(), // overridden by demo timing
    },
    status: "funding",
    milestones: [
      { id: `${projectId}-m1`, index: 0, templateKey: "foundation", title: "Foundation", amount: "9000", requiredInspectors: 1, status: "pending" },
      { id: `${projectId}-m2`, index: 1, templateKey: "framing", title: "Framing", amount: "12000", requiredInspectors: 1, status: "pending" },
      { id: `${projectId}-m3`, index: 2, templateKey: "dry_in", title: "Roof & Dry-in", amount: "9000", requiredInspectors: 1, status: "pending" },
    ],
    chain: {},
  };

  say(`3. setupProjectOnChain (${projectId}, SPV mode: ${SPV_MODE})`);
  const now0 = await ledgerTime();
  // SPV creation (faucet) happens before VaultCreate inside setup, so give it slack.
  const subEnd = now0 + SUBSCRIPTION_S + 45;
  const redemption = subEnd + PAYMENT_INTERVAL_S * PAYMENT_TOTAL + 60 + 90;
  // Cover deposit defaults to the protocol minimum (10% of principal + interest) + 10% headroom.
  const setup = await setupProjectOnChain(project, {
    subscriptionEndsAt: new Date(rippleTimeToISOTime(subEnd)),
    redemptionAt: new Date(rippleTimeToISOTime(redemption)),
    paymentTotal: PAYMENT_TOTAL,
    paymentIntervalS: PAYMENT_INTERVAL_S,
    lockSpv: SPV_MODE === "multisig",
  });
  console.log(`  cover ${setup.cover.amount} RLUSD (min ${setup.cover.minimum}), rates ${setup.cover.coverRateMinimum}/${setup.cover.coverRateLiquidation}, mgmt fee ${setup.cover.managementFeeRate}`);
  for (const [k, t] of Object.entries(setup.txs)) rec(k, t);
  events.push(...setup.events);
  project.chain = { spv: setup.spv, vaultId: setup.vaultId, loanBrokerId: setup.loanBrokerId, shareMptIssuanceId: setup.shareMptIssuanceId };
  console.log(`  SPV ${setup.spv}\n  vault ${setup.vaultId}\n  broker ${setup.loanBrokerId}\n  shares MPT ${setup.shareMptIssuanceId}`);
  console.log(`  subscription ends ${setup.subscriptionEndsAt}, redemption ${setup.redemptionAt}`);
  if (SPV_MODE === "multisig") console.log(`  SPV: ${JSON.stringify(await getSpvInfo(setup.spv))}`);

  say("4. investors deposit (VaultDeposit)");
  for (const [inv, amt] of [["investor1", "10000"], ["investor2", "12000"], ["investor3", "8000"]] as const) {
    const d = await depositToVault({ projectId, vaultId: setup.vaultId, investor: inv, amount: amt });
    rec(`VaultDeposit ${inv} ${amt}`, d.tx);
    events.push(d.event);
  }
  for (const inv of ["investor1", "investor2", "investor3"] as const) {
    console.log(`  ${inv} shares: ${await getShareBalance(w[inv].classicAddress, setup.shareMptIssuanceId)}`);
  }
  console.log(`  vault: ${JSON.stringify(await getVaultStatus(setup.vaultId))}`);

  say("5. INSPECTOR generates one condition per milestone (fulfillments stay inspector-side)");
  // Simulates the inspector's client. The platform only ever sees `condition`.
  const inspectorSecrets: Record<string, MilestoneCondition> = {};
  for (const m of project.milestones) inspectorSecrets[m.id] = generateMilestoneCondition();
  const conditions = Object.fromEntries(Object.entries(inspectorSecrets).map(([id, c]) => [id, c.condition]));

  say("6. wait for Investment phase, then LoanSet + escrows back-to-back");
  const vs = await getVaultStatus(setup.vaultId);
  await waitForLedgerTimeAfter(subEnd, tick("subscription end"));
  console.log(`\n  phase now: ${(await getVaultStatus(setup.vaultId))?.phase} (was ${vs?.phase})`);
  // Builder pays the LoanOriginationFee shortfall into the SPV at closing (escrows sum to the full principal).
  rec("RLUSD -> builder (closing costs)", await topUpRlusd(w.issuer, w.builder.classicAddress, 1000));
  const nowInv = await ledgerTime();
  const m3 = project.milestones[2]!;
  m3.cancelAfter = rippleTimeToISOTime(nowInv + M3_CANCEL_S);
  const close = await closeLoanAndCreateEscrows(project, {
    conditions,
    paymentTotal: PAYMENT_TOTAL,
    paymentIntervalS: PAYMENT_INTERVAL_S,
    defaultCancelAfter: new Date(Date.now() + 30 * 86_400_000),
    waitForInvestmentPhase: true,
    allowOverpayment: true,
    ...(SPV_MODE === "single" ? { spvSingleKey: setup.spvWallet } : {}),
  });
  rec(`builder -> SPV origination fee ${close.originationFee}`, close.originationFeeTopUpTx);
  rec(`LoanSet (${SPV_MODE} countersign, origination fee ${close.originationFee})`, close.loanSetTx);
  close.escrows.forEach((e, i) => {
    const t = close.events.find((ev) => ev.kind === "escrow_created" && ev.milestoneId === e.milestoneId)!;
    rows.push({ step: `EscrowCreate m${i + 1} ${e.amount} (cancel ${e.cancelAfter})`, type: "EscrowCreate", result: "tesSUCCESS", url: t.explorerUrl });
    console.log(`  ✓ EscrowCreate m${i + 1} seq=${e.escrow.offerSequence} ${t.explorerUrl}`);
  });
  events.push(...close.events);
  project.chain.loanId = close.loanId;
  console.log(`  loan ${close.loanId}`);
  console.log(`  SPV RLUSD after escrows: ${await rlusdBalance(setup.spv, issuer)}`);

  if (SPV_MODE === "single") {
    say("6b. fallback path: lock SPV AFTER loan + escrows");
    rec("SignerListSet (post-loan)", await lockSpvAccount(setup.spvWallet));
    rec("AccountSet disableMaster (post-loan)", await disableMasterKey(setup.spvWallet));
  }

  say("7. milestone 1: AI + inspector + platform attest on-chain, inspector reveals fulfillment, release");
  const m1 = project.milestones[0]!;
  const e1 = close.escrows[0]!;
  const fakeVerdict = { milestoneId: m1.id, decision: "pass", confidence: 0.93, model: "mock" };
  const verdictHash = sha256Hex(JSON.stringify(fakeVerdict));
  for (const [role, signer, notes] of [
    ["ai_agent", "aiAgent", "evidence checks passed"],
    ["inspector", "inspectorA", "site visit OK"],
    ["platform", "platform", "policy satisfied"],
  ] as const) {
    const a = await attestApproval({ projectId, spv: setup.spv, milestoneId: m1.id, role, signer, decision: "approve", notes, verdictHash, condition: e1.escrow.condition });
    rec(`attest m1 ${role}`, a.tx);
    events.push(a.event);
  }
  // Inspector hands over the fulfillment only now.
  const rel = await releaseMilestone({ projectId, milestoneId: m1.id, escrow: e1.escrow, fulfillment: inspectorSecrets[m1.id]!.fulfillment, amount: m1.amount });
  rec("EscrowFinish m1 -> builder", rel.tx);
  events.push(rel.event);
  console.log(`  builder RLUSD: ${await rlusdBalance(w.builder.classicAddress, issuer)}`);

  say(`8. milestone 3 stalls: wait for CancelAfter (${m3.cancelAfter}), EscrowCancel -> SPV`);
  const e3 = close.escrows[2]!;
  const can = await cancelExpiredMilestone({ projectId, milestoneId: m3.id, escrow: e3.escrow, cancelAfter: e3.cancelAfter, wait: true, amount: m3.amount, onWait: tick("CancelAfter") });
  console.log("");
  rec("EscrowCancel m3 -> SPV", can.tx);
  events.push(can.event);
  console.log(`  SPV RLUSD after cancel: ${await rlusdBalance(setup.spv, issuer)}`);

  say("9. SPV repays (multisig LoanPay): regular periodic payment, then overpayment test");
  const loanBefore = await getLoan(close.loanId);
  console.log(`  loan before: principalOutstanding=${loanBefore?.PrincipalOutstanding} periodic=${loanBefore?.PeriodicPayment} remaining=${loanBefore?.PaymentRemaining} nextDue=${loanBefore?.NextPaymentDueDate ? rippleTimeToISOTime(loanBefore.NextPaymentDueDate) : "-"}`);
  // (a) Can the SPV pay back LESS than one periodic payment? (expected: no)
  try {
    const small = await repayLoan({ projectId, spv: setup.spv, loanId: close.loanId, amount: "1000", mode: "overpayment" });
    rec("LoanPay 1000 (sub-periodic, overpayment flag)", small.tx);
    notes.push("Sub-periodic LoanPay (1000) was ACCEPTED.");
  } catch (e) {
    notes.push(`Sub-periodic LoanPay of 1000 rejected as expected: ${(e as Error).message}`);
    console.log(`  ✗ (expected) sub-periodic LoanPay: ${(e as Error).message}`);
  }
  // (b) Pay the whole refunded balance with tfLoanOverpayment: covers one periodic payment, rest pays principal early.
  const spvBal = await rlusdBalance(setup.spv, issuer);
  const pay = await repayLoan({ projectId, spv: setup.spv, loanId: close.loanId, amount: spvBal, mode: "overpayment" });
  rec(`LoanPay ${pay.amount} (escrow refund, overpayment)`, pay.tx);
  events.push(pay.event);
  const loanAfter = await getLoan(close.loanId);
  console.log(`  loan after: principalOutstanding=${loanAfter?.PrincipalOutstanding} periodic=${loanAfter?.PeriodicPayment} remaining=${loanAfter?.PaymentRemaining} totalValueOutstanding=${loanAfter?.TotalValueOutstanding}`);
  notes.push(
    `Overpayment LoanPay of ${pay.amount}: principalOutstanding ${loanBefore?.PrincipalOutstanding} -> ${loanAfter?.PrincipalOutstanding}, periodic ${loanBefore?.PeriodicPayment} -> ${loanAfter?.PeriodicPayment}, paymentsRemaining ${loanBefore?.PaymentRemaining} -> ${loanAfter?.PaymentRemaining}`,
  );
  console.log(`  SPV RLUSD after repay: ${await rlusdBalance(setup.spv, issuer)}`);
  console.log(`  vault: ${JSON.stringify(await getVaultStatus(setup.vaultId))}`);

  if (DO_WITHDRAW) {
    say("10. wait for Redemption, investor1 VaultWithdraw");
    await waitForLedgerTimeAfter(redemption - 1, tick("redemption"));
    console.log("");
    const vst = await getVaultStatus(setup.vaultId);
    const amt = Math.min(1000, Math.floor(Number(vst?.assetsAvailable ?? 0))).toString();
    const wd = await withdrawFromVault({ projectId, vaultId: setup.vaultId, investor: "investor1", amount: amt });
    rec(`VaultWithdraw investor1 ${amt}`, wd.tx);
    events.push(wd.event);
    console.log(`  investor1 shares: ${await getShareBalance(w.investor1.classicAddress, setup.shareMptIssuanceId)}`);
  } else {
    notes.push(`VaultWithdraw skipped (closed-ended vault: withdrawals reopen at Redemption ${setup.redemptionAt}). Run with DEMO_WITHDRAW=1.`);
  }

  // ------------------------------------------------------------------ summary
  say("SUMMARY");
  const width = Math.max(...rows.map((r) => r.step.length));
  console.log(`| # | step${" ".repeat(width - 4)} | result | explorer |`);
  console.log(`|---|${"-".repeat(width + 2)}|--------|----------|`);
  rows.forEach((r, i) => console.log(`| ${i + 1} | ${r.step.padEnd(width)} | ${r.result} | ${r.url} |`));
  for (const n of notes) console.log(`NOTE: ${n}`);

  mkdirSync(config.dataDir, { recursive: true });
  const out = join(config.dataDir, `demo-run-${projectId}.json`);
  writeFileSync(out, JSON.stringify({ startedAt, finishedAt: new Date().toISOString(), spvMode: SPV_MODE, project, setup: { ...setup, spvWallet: undefined, txs: undefined }, loanId: close.loanId, escrows: close.escrows, rows, notes, events }, null, 2));
  console.log(`\nrun record: ${out}`);
}

try {
  await main();
} catch (e) {
  console.error("\nDEMO FAILED:", e);
  if (rows.length) {
    console.error("txs so far:");
    rows.forEach((r) => console.error(`  ${r.step}: ${r.url}`));
  }
  process.exitCode = 1;
} finally {
  await disconnect();
}
