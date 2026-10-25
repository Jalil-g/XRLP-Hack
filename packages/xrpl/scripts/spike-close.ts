// XRPL-06 devnet proof: loan close = countersigned LoanSet + N multisig EscrowCreates with conditions supplied by the
// caller (stand-in for core's release service, CORE-12), and client-side rejection of bad input with nothing submitted.
//   WALLETS_FILE=.data/wallets.<you>.json pnpm --filter @xrlp/xrpl bootstrap   (once)
//   WALLETS_FILE=.data/wallets.<you>.json pnpm --filter @xrlp/xrpl spike:close  (~3 min)
// Proves on devnet:
//   - close while the vault is in Subscription with waitForInvestmentPhase:false → TooSoonError, nothing submitted
//   - duplicate condition / CancelAfter ≥ maturity / malformed condition → CloseValidationError, nothing submitted
//   - close: LoanSet (platform Account, SPV 3-of-4 countersign, tfLoanOverpayment, origination fee) + 3 EscrowCreates
//     → SPV liquid RLUSD ≈ 0, escrows sum to the principal, every CancelAfter < maturity. Since XRPL-13b the escrows go in
//     ONE all-or-nothing Batch by default; SPIKE_ESCROW_MODE=sequential reproduces the §2c run (3 back-to-back txs)
//   - re-running the close with the same conditions → rejected (condition already on an open SPV escrow)
// Env: SPIKE_SUBSCRIPTION_S=90, SPIKE_PAYMENT_INTERVAL_S=300, SPIKE_ESCROW_MODE=batch|sequential (default: the API's).
// XRPL-13b's own proof (Batch rollback, partial close, resumeEscrowCreation) is spike-close-batch.ts.
import type { Project } from "@xrlp/shared";
import { TooSoonError } from "@xrlp/shared";
import { rippleTimeToISOTime } from "xrpl";
import { closeLoanAndCreateEscrows, depositToVault, setupProjectOnChain } from "../src/api.ts";
import { disconnect, getClient, ledgerTime, waitForLedgerTimeAfter } from "../src/client.ts";
import { CloseValidationError } from "../src/loan-close.ts";
import { getBalance, getLoanSnapshot, listEscrowsParsed } from "../src/reads.ts";
import { loadWallets } from "../src/wallets.ts";
import { testConditionPairs } from "../test/support/conditions.ts";
import { Spike } from "./spike-lib.ts";

const SUBSCRIPTION_S = Number(process.env.SPIKE_SUBSCRIPTION_S ?? 90);
const PAYMENT_INTERVAL_S = Number(process.env.SPIKE_PAYMENT_INTERVAL_S ?? 300);
const PAYMENT_TOTAL = 3;
const PRINCIPAL = "3000";
const ESCROW_MODE = process.env.SPIKE_ESCROW_MODE as "batch" | "sequential" | undefined;

const spike = new Spike("spike-xrpl06-close");
const w = loadWallets();
const issuer = w.issuer.classicAddress;

/** Sequence + RLUSD of the accounts the close would touch: proves "nothing submitted". */
async function fingerprint(accounts: Record<string, string>): Promise<string> {
  const client = await getClient();
  const parts: string[] = [];
  for (const [role, a] of Object.entries(accounts)) {
    const info = await client.request({ command: "account_info", account: a, ledger_index: "validated" });
    parts.push(`${role}:seq${info.result.account_data.Sequence}:${await getBalance(a, "RLUSD", { issuer })}`);
  }
  return parts.join(" ");
}

/** Run a close that must be refused client-side with `Err`; check nothing reached the ledger. */
async function refused(step: string, Err: abstract new (...a: never[]) => Error, accounts: Record<string, string>, run: () => Promise<unknown>) {
  const before = await fingerprint(accounts);
  try {
    await run();
  } catch (e) {
    if (!(e instanceof Err)) throw e;
    const after = await fingerprint(accounts);
    if (after !== before) throw new Error(`${step}: state changed!\n  before ${before}\n  after  ${after}`);
    spike.rows.push({ step, result: `${e.name} (client-side, nothing submitted)` });
    spike.log(`  ✔ ${step}: ${e.name} — ${e.message.split("\n").slice(1).join(" ").trim() || e.message}`);
    spike.log(`    unchanged: ${after}`);
    return;
  }
  throw new Error(`${step}: expected ${Err.name}, but the close went through`);
}

try {
  const projectId = `spike06-${Date.now().toString(36)}`;
  const project: Project = {
    id: projectId,
    name: "XRPL-06 close spike",
    type: "residential_new",
    builderId: "builder-1",
    siteAddress: "1 Spike St",
    siteGeo: { lat: 40.7, lng: -74, radiusM: 100 },
    description: "XRPL-06 devnet proof",
    terms: { principal: PRINCIPAL, interestRateBps: 1000, termDays: 30, paymentIntervalDays: 10, fundingDeadline: new Date(Date.now() + 86_400_000).toISOString() },
    status: "funding",
    milestones: [
      { id: `${projectId}-m1`, index: 0, templateKey: "foundation", title: "Foundation", amount: "1000", requiredInspectors: 1, status: "pending" },
      { id: `${projectId}-m2`, index: 1, templateKey: "framing", title: "Framing", amount: "1200", requiredInspectors: 1, status: "pending" },
      { id: `${projectId}-m3`, index: 2, templateKey: "dry_in", title: "Roof & Dry-in", amount: "800", requiredInspectors: 1, status: "pending" },
    ],
    chain: {},
  };

  spike.log(`1. setupProjectOnChain ${projectId} (SPV v2 list, closed-ended vault, broker + cover)`);
  const now0 = await ledgerTime();
  const subEnd = now0 + SUBSCRIPTION_S + 45; // SPV faucet funding happens first inside setup
  const redemption = subEnd + PAYMENT_INTERVAL_S * PAYMENT_TOTAL + 60 + 120;
  const setup = await setupProjectOnChain(project, {
    subscriptionEndsAt: new Date(rippleTimeToISOTime(subEnd) as string),
    redemptionAt: new Date(rippleTimeToISOTime(redemption) as string),
    paymentTotal: PAYMENT_TOTAL,
    paymentIntervalS: PAYMENT_INTERVAL_S,
  });
  for (const [k, t] of Object.entries(setup.txs)) spike.rows.push({ step: k, result: t.result, hash: t.hash });
  project.chain = { spv: setup.spv, vaultId: setup.vaultId, loanBrokerId: setup.loanBrokerId, shareMptIssuanceId: setup.shareMptIssuanceId };
  spike.accounts.spv = setup.spv;
  spike.accounts.platform = w.platform.classicAddress;
  spike.accounts.builder = w.builder.classicAddress;
  spike.note(`SPV ${setup.spv}, vault ${setup.vaultId}, subscription ends ${setup.subscriptionEndsAt}, redemption ${setup.redemptionAt}`);

  await spike.ok(`VaultDeposit investor1 ${PRINCIPAL}`, async () => (await depositToVault({ projectId, vaultId: setup.vaultId, investor: "investor1", amount: PRINCIPAL })).tx);

  // Stand-in for core's release service: one fresh condition per milestone. Fulfillments stay in this process.
  const pairs = testConditionPairs(project.milestones.length);
  const conditions = pairs.map((p) => p.condition);
  const touched = { platform: w.platform.classicAddress, spv: setup.spv, builder: w.builder.classicAddress };

  spike.log("2. negatives (client-side, nothing submitted)");
  await refused("close during Subscription, waitForInvestmentPhase:false", TooSoonError, touched, () =>
    closeLoanAndCreateEscrows(project, { conditions, paymentTotal: PAYMENT_TOTAL, paymentIntervalS: PAYMENT_INTERVAL_S, waitForInvestmentPhase: false }),
  );
  await waitForLedgerTimeAfter(subEnd, (s) => process.stdout.write(`\r  waiting for Investment phase: ${s}s   `));
  console.log();
  await refused("duplicate condition (m3 = m1)", CloseValidationError, touched, () =>
    closeLoanAndCreateEscrows(project, { conditions: [conditions[0]!, conditions[1]!, conditions[0]!], paymentTotal: PAYMENT_TOTAL, paymentIntervalS: PAYMENT_INTERVAL_S }),
  );
  const farFuture = new Date(Date.now() + 30 * 86_400_000).toISOString();
  await refused("CancelAfter ≥ maturity (m2 = now + 30 days)", CloseValidationError, touched, async () =>
    closeLoanAndCreateEscrows(project, {
      conditions,
      cancelAfters: [rippleTimeToISOTime((await ledgerTime()) + 200), farFuture, rippleTimeToISOTime((await ledgerTime()) + 200)],
      paymentTotal: PAYMENT_TOTAL,
      paymentIntervalS: PAYMENT_INTERVAL_S,
    }),
  );
  await refused("malformed condition (a fulfillment) + PaymentTotal 1", CloseValidationError, touched, () =>
    closeLoanAndCreateEscrows(project, { conditions: [conditions[0]!, pairs[1]!.fulfillment, conditions[2]!], paymentTotal: 1, paymentIntervalS: PAYMENT_INTERVAL_S }),
  );

  spike.log(`3. close: LoanSet (platform Account, SPV 3-of-4 countersign) + 3 × EscrowCreate (escrowMode ${ESCROW_MODE ?? "default"})`);
  const spvBefore = await getBalance(setup.spv, "RLUSD", { issuer });
  const close = await closeLoanAndCreateEscrows(project, { conditions, paymentTotal: PAYMENT_TOTAL, paymentIntervalS: PAYMENT_INTERVAL_S, ...(ESCROW_MODE ? { escrowMode: ESCROW_MODE } : {}) });
  if (close.originationFeeTopUpTx) spike.rows.push({ step: `builder → SPV origination-fee shortfall ${close.originationFee}`, result: close.originationFeeTopUpTx.result, hash: close.originationFeeTopUpTx.hash });
  if (close.batchTx) spike.rows.push({ step: `Batch (${close.escrowMode}: the 3 EscrowCreates below are its inner txs)`, result: close.batchTx.result, hash: close.batchTx.hash });
  for (const t of close.txs) spike.rows.push({ step: String(t.tx.TransactionType), result: t.result, hash: t.hash });
  for (const t of [...close.txs, ...(close.batchTx ? [close.batchTx] : [])]) spike.log(`  ✔ ${t.tx.TransactionType}: ${t.result} ${t.explorerUrl}`);

  const spvAfter = await getBalance(setup.spv, "RLUSD", { issuer });
  const escrows = await listEscrowsParsed(setup.spv);
  const loan = await getLoanSnapshot(close.loanId);
  const escrowed = escrows.reduce((a, e) => a + Number(e.amount), 0);
  spike.note(`loan ${close.loanId}: principalOutstanding ${loan?.principalOutstanding}, ${loan?.paymentRemaining} payments, maturity ≥ ${close.maturity}`);
  spike.note(`SPV RLUSD before close ${spvBefore} → after close ${spvAfter} (liquid ≈ 0); escrowed ${escrowed} in ${escrows.length} escrows`);
  for (const e of close.escrows) spike.note(`escrow ${e.milestoneId} seq ${e.offerSequence} amount ${e.amount} CancelAfter ${e.cancelAfter} < maturity ${close.maturity}`);
  if (Number(spvAfter) > 0.000001) throw new Error(`SPV still holds ${spvAfter} RLUSD after close`);
  if (escrowed !== Number(PRINCIPAL)) throw new Error(`escrows sum to ${escrowed}, expected ${PRINCIPAL}`);
  for (const e of close.escrows) if (Date.parse(e.cancelAfter) >= Date.parse(close.maturity)) throw new Error(`escrow ${e.milestoneId} CancelAfter ≥ maturity`);

  spike.log("4. re-run the close with the same conditions (cross-SPV duplicate check)");
  await refused("re-close with conditions already on open SPV escrows", CloseValidationError, touched, () =>
    closeLoanAndCreateEscrows(project, { conditions, paymentTotal: PAYMENT_TOTAL, paymentIntervalS: PAYMENT_INTERVAL_S }),
  );

  spike.print();
  console.log(`\nrecord: ${spike.save({ projectId, loanId: close.loanId, escrows: close.escrows, fulfillments: pairs.map((p) => p.fulfillment) })}`);
} finally {
  await disconnect();
}
