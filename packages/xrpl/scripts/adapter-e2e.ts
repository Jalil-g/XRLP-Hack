// XRPL-10 devnet e2e: drive XrplLedgerAdapter through the whole shared LedgerPort flow, the way core would.
//   pnpm --filter @xrlp/xrpl bootstrap         (once; same WALLETS_FILE)
//   pnpm --filter @xrlp/xrpl adapter:e2e       (~6-8 min)
// fee -> credentials x3 roles -> setup (private vault + broker + cover + SPV) -> deposits -> withdraw/close refused
// (TooSoonError) -> close with release-service conditions -> preflight -> finish -> wrong-fulfillment finish -> cancel
// after a short CancelAfter -> repay escrow_refund + builder -> attestations (held key + inspector-signed blob) -> reads.
// Short dates: SubscriptionDate = now + E2E_SUBSCRIPTION_S (default 120); m3 CancelAfter = close + E2E_CANCEL_S (default 75).
// Writes .data/adapter-e2e.json (gitignored).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LedgerError, type Builder, type Milestone, type Project, type TxResult } from "@xrlp/shared";
import { isoTimeToRippleTime, rippleTimeToISOTime } from "xrpl";
import { apiCodeOf, XrplLedgerAdapter } from "../src/adapter.ts";
import { prepareAttestTx, sha256Hex, type AttestMemo } from "../src/attest.ts";
import { disconnect, ledgerTime, waitForLedgerTimeAfter } from "../src/client.ts";
import { generateMilestoneCondition, type MilestoneCondition } from "../src/condition.ts";
import { config } from "../src/config.ts";
import { vaultDatesFor } from "../src/lending-math.ts";
import { getLoan } from "../src/loan.ts";
import { loadWallets } from "../src/wallets.ts";

const SUB_S = Number(process.env.E2E_SUBSCRIPTION_S ?? 120);
const CANCEL_S = Number(process.env.E2E_CANCEL_S ?? 75);
const DAY = 86_400;

interface Row {
  step: string;
  result: string;
  explorerUrl?: string;
  kind?: string;
}
const rows: Row[] = [];
const say = (s: string) => console.log(s);
const record = (step: string, t: TxResult | TxResult[]) => {
  for (const x of Array.isArray(t) ? t : [t]) rows.push({ step, result: x.result, explorerUrl: x.explorerUrl, ...(x.kind ? { kind: x.kind } : {}) });
  return t;
};
const expectRefusal = async (step: string, p: Promise<unknown>, code: string) => {
  try {
    await p;
  } catch (e) {
    const got = e instanceof LedgerError ? apiCodeOf(e) : "non-LedgerError";
    if (got !== code) throw new Error(`${step}: expected ${code}, got ${got}: ${(e as Error).message}`);
    say(`  ✓ refused as expected [${code}] ${e instanceof Error ? e.constructor.name : ""}: ${(e as Error).message}`);
    rows.push({ step, result: `refused ${code} (${(e as Error).constructor.name})` });
    return;
  }
  throw new Error(`${step}: expected ${code}, but it succeeded`);
};
const countdown = (label: string) => (s: number) => process.stdout.write(`\r  waiting for ${label}: ${s}s   `);

const ledger = new XrplLedgerAdapter({ log: say });
const w = loadWallets();
say(`wallets: ${config.walletsFile}`);

try {
  const builder: Builder = {
    id: "builder-e2e",
    name: "Drawproof E2E Builder",
    address: w.builder.classicAddress,
    licenseNumber: "NY-E2E-001",
    insurancePolicy: "POL-E2E",
    completedProjects: 3,
    riskTier: "low",
    verified: false,
  };
  const inspector = w.inspector1.classicAddress;

  say("\n1. verification fee (builder -> platform)");
  record("payVerificationFee", await ledger.payVerificationFee({ builder: builder.address, amount: "250" }));

  say("\n2. credentials (create + accept; idempotent)");
  record("issueCredential VERIFIED_BUILDER", await ledger.issueCredential({ subject: builder.address, type: "VERIFIED_BUILDER" }));
  record("issueCredential VERIFIED_INSPECTOR", await ledger.issueCredential({ subject: inspector, type: "VERIFIED_INSPECTOR" }));
  for (const inv of [w.investor1, w.investor2]) record("issueCredential KYC_INVESTOR", await ledger.issueCredential({ subject: inv.classicAddress, type: "KYC_INVESTOR" }));
  const again = await ledger.issueCredential({ subject: builder.address, type: "VERIFIED_BUILDER" });
  say(`  re-run VERIFIED_BUILDER -> ${again.length} txs (idempotent)`);
  rows.push({ step: "issueCredential VERIFIED_BUILDER (re-run)", result: `${again.length} txs` });

  say("\n3. setupProjectOnChain");
  const now0 = await ledgerTime();
  const sub = now0 + SUB_S;
  const terms = { principal: "400", interestRateBps: 1000, termDays: 4, paymentIntervalDays: 1, fundingDeadline: rippleTimeToISOTime(sub) };
  const red = vaultDatesFor({ subscriptionDate: sub, paymentTotal: 4, paymentIntervalS: DAY }).redemptionDate;
  const ms = (i: number, id: string, title: string, amount: string): Milestone => ({ id, index: i, templateKey: id, title, amount, requiredInspectors: 1, status: "pending" });
  const project: Project = {
    id: `e2e-${Date.now().toString(36)}`,
    name: "Adapter E2E · 12 Maple St",
    type: "residential_new",
    builderId: builder.id,
    siteAddress: "12 Maple St, Brooklyn NY",
    siteGeo: { lat: 40.68, lng: -73.97, radiusM: 60 },
    description: "XRPL-10 adapter e2e",
    terms,
    status: "terms_locked",
    milestones: [ms(0, "m1-foundation", "Foundation", "100"), ms(1, "m2-framing", "Framing", "100"), ms(2, "m3-dry-in", "Dry-in", "200")],
    chain: {},
  };
  const setup = await ledger.setupProjectOnChain({ project, builder, inspectors: [inspector], subscriptionDate: terms.fundingDeadline, redemptionDate: rippleTimeToISOTime(red) });
  record("setupProjectOnChain", setup.txs);
  project.chain = { spv: setup.spv, vaultId: setup.vaultId, loanBrokerId: setup.loanBrokerId, shareMptIssuanceId: setup.shareMptIssuanceId, subscriptionDate: setup.subscriptionDate, redemptionDate: setup.redemptionDate };
  say(`  SPV ${setup.spv} · vault ${setup.vaultId} · broker ${setup.loanBrokerId}`);
  say(`  SubscriptionDate ${setup.subscriptionDate} · RedemptionDate ${setup.redemptionDate}`);

  say("\n4. deposits (KYC'd investors, private vault)");
  record("deposit investor1", await ledger.deposit({ project, investor: w.investor1.classicAddress, amount: "200" }));
  record("deposit investor2", await ledger.deposit({ project, investor: w.investor2.classicAddress, amount: "200" }));
  say(`  vault: ${JSON.stringify(await ledger.getVaultSnapshot({ vaultId: setup.vaultId }))}`);

  say("\n5. refusals before the vault dates");
  await expectRefusal("withdraw before RedemptionDate", ledger.withdraw({ project, investor: w.investor1.classicAddress, amount: "10" }), "too_soon");
  // Release service: one fresh preimage per escrow; the adapter only ever sees the conditions.
  const keys: MilestoneCondition[] = project.milestones.map(() => generateMilestoneCondition());
  const conditions = keys.map((k) => k.condition);
  const farCancel = rippleTimeToISOTime(sub + 2 * DAY);
  if ((await ledgerTime()) <= sub) {
    await expectRefusal("close before SubscriptionDate", ledger.closeLoanAndCreateEscrows({ project, builder, conditions, cancelAfters: [farCancel, farCancel, farCancel] }), "too_soon");
  }
  await waitForLedgerTimeAfter(sub, countdown("SubscriptionDate"));
  process.stdout.write("\n");

  say("\n6. closeLoanAndCreateEscrows (LoanSet + EscrowCreate x 3)");
  const closeAt = await ledgerTime();
  const shortCancel = rippleTimeToISOTime(closeAt + CANCEL_S);
  const cancelAfters = [rippleTimeToISOTime(closeAt + 2 * DAY), rippleTimeToISOTime(closeAt + 2 * DAY), shortCancel];
  await expectRefusal("close with duplicate conditions", ledger.closeLoanAndCreateEscrows({ project, builder, conditions: [conditions[0]!, conditions[0]!, conditions[2]!], cancelAfters }), "validation");
  const close = await ledger.closeLoanAndCreateEscrows({ project, builder, conditions, cancelAfters });
  record("closeLoanAndCreateEscrows", close.txs);
  project.chain.loanId = close.loanId;
  close.escrows.forEach((e, i) => {
    const m = project.milestones[i]!;
    m.escrow = { owner: e.owner, offerSequence: e.offerSequence, condition: e.condition, createTx: e.createTx };
    m.cancelAfter = e.cancelAfter;
    m.status = "escrowed";
  });
  say(`  loan ${close.loanId}; escrows ${close.escrows.map((e) => `${e.milestoneId}#${e.offerSequence} (CancelAfter ${e.cancelAfter})`).join(", ")}`);
  say(`  loan: ${JSON.stringify(await ledger.getLoanSnapshot({ loanId: close.loanId }))}`);
  say(`  SPV RLUSD after escrows: ${await ledger.getBalance(setup.spv, "RLUSD")}`);

  const [m1, m2, m3] = project.milestones as [Milestone, Milestone, Milestone];
  const e1 = m1.escrow!;
  const e2 = m2.escrow!;
  const e3 = m3.escrow!;

  say("\n7. release m1: getEscrow -> preflight -> finish (releaseService)");
  const snap1 = await ledger.getEscrow(e1.owner, e1.offerSequence);
  say(`  escrow: ${JSON.stringify(snap1)}`);
  if (!snap1 || snap1.destination !== builder.address) throw new Error("escrow m1 missing or wrong destination");
  const pf1 = await ledger.preflightFinish({ owner: e1.owner, offerSequence: e1.offerSequence, destination: snap1.destination });
  say(`  preflight: ${JSON.stringify(pf1)}`);
  if (!pf1.ok) throw new Error(`preflight refused m1: ${pf1.reason}`);
  record("finishEscrow m1", await ledger.finishEscrow({ owner: e1.owner, offerSequence: e1.offerSequence, condition: e1.condition, fulfillment: keys[0]!.fulfillment }));
  say(`  getEscrow m1 after finish: ${JSON.stringify(await ledger.getEscrow(e1.owner, e1.offerSequence))}`);
  await expectRefusal("finishEscrow m1 again", ledger.finishEscrow({ owner: e1.owner, offerSequence: e1.offerSequence, condition: e1.condition, fulfillment: keys[0]!.fulfillment }), "unsafe_release");

  say("\n8. try-steal m2: platform EscrowFinish with a wrong fulfillment (resolves with the tec)");
  const steal = await ledger.tryFinishWithWrongFulfillment({ owner: e2.owner, offerSequence: e2.offerSequence, condition: e2.condition });
  record("tryFinishWithWrongFulfillment m2", steal);
  if (steal.result !== "tecCRYPTOCONDITION_ERROR") throw new Error(`expected tecCRYPTOCONDITION_ERROR, got ${steal.result}`);
  say(`  m2 still open: ${JSON.stringify(await ledger.getEscrow(e2.owner, e2.offerSequence))}`);

  say("\n9. attestations: aiAgent verdict (held key) + inspector audit (signed offline, submitSignedBlob)");
  const verdict: AttestMemo = { v: 1, kind: "verdict", milestoneId: m2.id, hash: sha256Hex(`verdict:${m2.id}`), decision: "fail", reason: "no_duplicate_photo" };
  record("attest verdict (aiAgent)", await ledger.attest({ signer: "aiAgent", spv: setup.spv, memo: verdict }));
  const audit: AttestMemo = { v: 1, kind: "audit", milestoneId: m1.id, hash: sha256Hex(`audit:${m1.id}`) };
  const prepared = await prepareAttestTx({ account: inspector, spv: setup.spv, memo: audit });
  record("submitSignedBlob audit (inspector1)", await ledger.submitSignedBlob(w.inspector1.sign(prepared).tx_blob));

  say("\n10. stall path m3: cancel refused before CancelAfter -> preflight refuses -> cancel -> LoanPay escrow_refund");
  await expectRefusal("cancelEscrow m3 before CancelAfter", ledger.cancelEscrow({ owner: e3.owner, offerSequence: e3.offerSequence }), "too_soon");
  await waitForLedgerTimeAfter(isoTimeToRippleTime(m3.cancelAfter!), countdown("m3 CancelAfter"));
  process.stdout.write("\n");
  const pf3 = await ledger.preflightFinish({ owner: e3.owner, offerSequence: e3.offerSequence, destination: builder.address });
  say(`  preflight m3 after CancelAfter: ${JSON.stringify(pf3)}`);
  if (pf3.ok) throw new Error("preflight should refuse an expired escrow");
  rows.push({ step: "preflightFinish m3 (expired)", result: `ok=false ${pf3.reason?.split(":")[0]}` });
  record("cancelEscrow m3", await ledger.cancelEscrow({ owner: e3.owner, offerSequence: e3.offerSequence }));
  say(`  SPV RLUSD after refund: ${await ledger.getBalance(setup.spv, "RLUSD")}`);
  record("repayLoan 200 escrow_refund", await ledger.repayLoan({ project, amount: "200", source: "escrow_refund" }));

  say("\n11. builder repays one periodic payment (builder -> SPV, SPV LoanPay)");
  const loan = await getLoan(close.loanId);
  const periodic = (Math.ceil((Number(loan?.PeriodicPayment ?? "0") + Number(loan?.LoanServiceFee ?? "0")) * 1e6) / 1e6).toFixed(6);
  record(`repayLoan ${periodic} builder`, await ledger.repayLoan({ project, amount: periodic, source: "builder" }));

  say("\n12. reads");
  const reads = {
    vault: await ledger.getVaultSnapshot({ vaultId: setup.vaultId }),
    loan: await ledger.getLoanSnapshot({ loanId: close.loanId }),
    escrowM1: await ledger.getEscrow(e1.owner, e1.offerSequence),
    escrowM2: await ledger.getEscrow(e2.owner, e2.offerSequence),
    escrowM3: await ledger.getEscrow(e3.owner, e3.offerSequence),
    builderRlusd: await ledger.getBalance(builder.address, "RLUSD"),
    spvRlusd: await ledger.getBalance(setup.spv, "RLUSD"),
    releaseServiceXrp: await ledger.getBalance(w.releaseService.classicAddress, "XRP"),
  };
  say(JSON.stringify(reads, null, 2));
  await expectRefusal("getVaultSnapshot unknown vault", ledger.getVaultSnapshot({ vaultId: "0".repeat(64) }), "not_found");

  say("\n=== summary ===");
  for (const r of rows) say(`${r.step.padEnd(42)} ${r.result.padEnd(26)} ${r.kind ?? ""} ${r.explorerUrl ?? ""}`);
  mkdirSync(config.dataDir, { recursive: true });
  const out = join(config.dataDir, "adapter-e2e.json");
  writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), project, setup, close: { loanId: close.loanId, escrows: close.escrows }, rows, reads }, null, 2) + "\n");
  say(`\nwrote ${out}`);
} finally {
  await disconnect();
}
