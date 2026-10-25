// XRPL-15 devnet proof: loan default + first-loss cover absorption (LoanManage impair / unimpair / default).
//   pnpm --filter @xrlp/xrpl spike:default            (~5 min, fresh faucet wallets)
// Setup: closed-ended vault + LoanBroker with the XRPL-04 rates (CoverRateMinimum 10000, CoverRateLiquidation 100000),
// mandatory cover (defaultCoverDeposit), investor deposit, LoanSet to a single-key borrower: 1000 RLUSD @ 10%,
// 3 x 60 s, GracePeriod 60 s. The borrower never pays. Then:
//   1. defaultLoan / impairLoan before the due date -> LoanManageTooSoonError client-side, nothing submitted (Sequence checked)
//   2. the same with skipGuard -> tecTOO_SOON on-ledger (the ledger agrees; impair-before-due is the fixCleanup3_4_0 rule)
//   3. after the due date: impair -> unimpair -> impair (LossUnrealized, net share price, NextPaymentDueDate unchanged)
//   4. after due + grace: non-owner refused client-side, and tecNO_PERMISSION on-ledger with skipGuard;
//      defaultLoan -> tesSUCCESS: DefaultCovered vs expectedDefaultCovered, vault write-down, share price, cover drop
//   5. defaultLoan again -> idempotent replay (same tx, nothing submitted); LoanPay after default; LoanManage on the defaulted loan
// Env: SPIKE_SUBSCRIPTION_S=60 · SPIKE_PREPAY=<RLUSD> (borrower overpays this much on time first, then goes dark) ·
// SPIKE_WRITE_FIXTURES=1 (record the impair / unimpair / default txs into test/fixtures/ for the offline parser tests).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LoanPayFlags, rippleTimeToISOTime } from "xrpl";
import { disconnect, ledgerTime, signAndSubmit, waitForLedgerTimeAfter, XrplTxError, type TxResult } from "../src/client.ts";
import {
  defaultableAfter,
  defaultLoan,
  expectedDefaultCovered,
  fetchLoanManageState,
  impairableAfter,
  impairLoan,
  loanExposure,
  LoanManageRefusedError,
  LoanManageTooSoonError,
  unimpairLoan,
  vaultAccounting,
  type ImpairResult,
  type LoanManageState,
} from "../src/default.ts";
import { COVER_RATE_LIQUIDATION, COVER_RATE_MINIMUM, defaultCoverDeposit, expectedInterest, originationFeeFor, vaultDatesFor } from "../src/lending-math.ts";
import { createLoanBroker, depositBrokerCover, loanSet } from "../src/loan.ts";
import { getVaultSnapshot, rawRequest } from "../src/reads.ts";
import { configureIssuer, ensureTrustline, issueRlusd, rlusdAmount, rlusdBalance } from "../src/rlusd.ts";
import { createVault, depositToVaultTx } from "../src/vault.ts";
import { Spike } from "./spike-lib.ts";

const PRINCIPAL = "1000";
const INTEREST_RATE = 10_000; // 1/10 bps -> 10% annual
const SCHEDULE = { paymentTotal: 3, paymentIntervalS: 60 };
const GRACE_S = 60;
const SUBSCRIPTION_S = Number(process.env.SPIKE_SUBSCRIPTION_S ?? 60);
const PREPAY = process.env.SPIKE_PREPAY;
const PROJECT_ID = "spike-xrpl15";

const spike = new Spike("spike-xrpl15-default");
const ROLES = ["issuer", "platform", "investor", "borrower", "outsider"] as const;
const iso = (t: number | undefined) => (t ? rippleTimeToISOTime(t) : "—");
const tick = (label: string) => (s: number) => process.stdout.write(`\r  waiting for ${label} ~${s}s   `);

function row(step: string, tx: TxResult): void {
  spike.rows.push({ step, result: tx.result, hash: tx.hash });
  spike.log(`  ✔ ${step}: ${tx.result} ${tx.explorerUrl}`);
}

async function sequenceOf(address: string): Promise<number> {
  const r = await rawRequest({ command: "account_info", account: address, ledger_index: "validated" });
  return Number((r.account_data as { Sequence: number }).Sequence);
}

/** `run` must throw `expected` without submitting anything: the signer's Sequence is compared before/after. */
async function refusedClientSide(step: string, signer: string, expected: new (...args: never[]) => Error, run: () => Promise<unknown>): Promise<Error> {
  const before = await sequenceOf(signer);
  try {
    await run();
  } catch (e) {
    if (!(e instanceof expected)) throw e;
    const after = await sequenceOf(signer);
    if (after !== before) throw new Error(`${step}: Sequence ${before} -> ${after}, something was submitted`);
    spike.rows.push({ step: `${step} (client-side, nothing submitted: Sequence ${before} unchanged)`, result: e.name });
    spike.log(`  ✔ ${step}: ${e.name} — ${e.message}`);
    return e;
  }
  throw new Error(`${step}: expected ${expected.name} but the call resolved`);
}

/** A tx expected to fail on-ledger: record whatever the ledger says (a mismatch is noted, not fatal). */
async function attempt(step: string, expected: string, run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (e) {
    if (!(e instanceof XrplTxError)) throw e;
    spike.rows.push({ step, result: e.engineResult, expected, ...(e.hash ? { hash: e.hash } : {}) });
    spike.log(`  ${e.engineResult === expected ? "✔" : "✘"} ${step}: ${e.engineResult} (expected ${expected})${e.explorerUrl ? ` ${e.explorerUrl}` : ""}`);
    if (e.engineResult !== expected) spike.note(`${step}: got ${e.engineResult}, expected ${expected}`);
    return e.engineResult;
  }
  spike.rows.push({ step, result: "tesSUCCESS", expected });
  spike.note(`${step}: SUCCEEDED, expected ${expected}`);
  return "tesSUCCESS";
}

function describeState(label: string, s: LoanManageState): void {
  const l = s.loan;
  const b = s.broker;
  const v = s.vault;
  spike.note(
    `${label} (ledger ${s.ledgerIndex}, ${iso(s.now)}): Loan Flags=0x${(l?.Flags ?? 0).toString(16)} PrincipalOutstanding=${l?.PrincipalOutstanding} ` +
      `TotalValueOutstanding=${l?.TotalValueOutstanding} ManagementFeeOutstanding=${l?.ManagementFeeOutstanding ?? "0"} PaymentRemaining=${l?.PaymentRemaining ?? 0} ` +
      `NextPaymentDueDate=${iso(l?.NextPaymentDueDate)} GracePeriod=${l?.GracePeriod} LoanScale=${l?.LoanScale}; ` +
      `Broker DebtTotal=${b?.DebtTotal ?? "0"} CoverAvailable=${b?.CoverAvailable ?? "0"}; ` +
      `Vault AssetsTotal=${v?.AssetsTotal ?? "0"} AssetsAvailable=${v?.AssetsAvailable ?? "0"} LossUnrealized=${v?.LossUnrealized ?? "0"} LEVersion=${v?.LEVersion}`,
  );
}

function describeImpair(step: string, r: ImpairResult): void {
  const o = r.outcome;
  row(step, r.tx);
  spike.note(
    `${step}: exposure ${o.exposure} (${o.accounting}); LossUnrealized ${o.vault.before.lossUnrealized} -> ${o.vault.after.lossUnrealized}; ` +
      `net share price ${o.vault.before.netSharePrice} -> ${o.vault.after.netSharePrice} (book ${o.vault.before.sharePrice} -> ${o.vault.after.sharePrice}); ` +
      `NextPaymentDueDate after = ${o.nextPaymentDueDate}`,
  );
}

const fixtures: Record<string, unknown> = {};
function keepFixture(name: string, description: string, tx: TxResult, extra: Record<string, unknown>): void {
  fixtures[name] = { capturedAt: new Date().toISOString(), network: "devnet", description, ...extra, tx: { hash: tx.hash, ledgerIndex: tx.ledgerIndex, result: tx.result, tx_json: tx.tx, meta: tx.meta } };
}

try {
  const features = await rawRequest({ command: "feature" });
  const enabled = (name: string) =>
    Object.values((features.features ?? {}) as Record<string, { name?: string; enabled?: boolean }>).find((f) => f.name === name)?.enabled;
  const info = await rawRequest({ command: "server_info" });
  spike.note(
    `rippled ${String((info.info as { build_version?: string } | undefined)?.build_version)}; fixCleanup3_4_0 enabled=${enabled("fixCleanup3_4_0")}, ` +
      `LendingProtocolV1_1 enabled=${enabled("LendingProtocolV1_1")}`,
  );

  const w = await spike.fund(ROLES);
  const issuer = w.issuer.classicAddress;
  for (const tx of await configureIssuer(w.issuer)) spike.rows.push({ step: "issuer AccountSet", result: tx.result, hash: tx.hash });
  for (const r of ["platform", "investor", "borrower"] as const) await spike.ok(`TrustSet ${r}`, () => ensureTrustline(w[r], issuer));
  await spike.ok(`RLUSD -> investor ${PRINCIPAL}`, () => issueRlusd(w.issuer, w.investor.classicAddress, PRINCIPAL));
  await spike.ok("RLUSD -> platform 500", () => issueRlusd(w.issuer, w.platform.classicAddress, "500"));

  const interest = expectedInterest({ principal: PRINCIPAL, interestRate: INTEREST_RATE, ...SCHEDULE });
  const cover = defaultCoverDeposit({ principal: PRINCIPAL, interest });
  const originationFee = originationFeeFor(PRINCIPAL);
  const dates = vaultDatesFor({ subscriptionDate: (await ledgerTime()) + SUBSCRIPTION_S, ...SCHEDULE, bufferS: 3_600 });
  const vault = await createVault({ owner: w.platform, issuer, ...dates, assetsMaximum: PRINCIPAL, loanSchedule: SCHEDULE, data: "xrlp:spike-xrpl15" });
  row(`VaultCreate closed-ended, AssetsMaximum ${PRINCIPAL} (sub ${iso(dates.subscriptionDate)}, red ${iso(dates.redemptionDate)})`, vault.tx);
  const broker = await createLoanBroker({ owner: w.platform, vaultId: vault.vaultId, data: "xrlp:spike-xrpl15" });
  row(`LoanBrokerSet CoverRateMinimum ${COVER_RATE_MINIMUM}, CoverRateLiquidation ${COVER_RATE_LIQUIDATION}`, broker.tx);
  await spike.ok(`LoanBrokerCoverDeposit ${cover} (defaultCoverDeposit)`, () => depositBrokerCover(w.platform, broker.loanBrokerId, issuer, cover));
  await spike.ok(`VaultDeposit investor ${PRINCIPAL}`, () => depositToVaultTx(w.investor, vault.vaultId, issuer, PRINCIPAL));

  await waitForLedgerTimeAfter(dates.subscriptionDate, tick("Investment phase"));
  process.stdout.write("\n");
  const loan = await loanSet({
    brokerOwner: w.platform,
    loanBrokerId: broker.loanBrokerId,
    borrower: w.borrower.classicAddress,
    principal: PRINCIPAL,
    interestRate: INTEREST_RATE,
    ...SCHEDULE,
    gracePeriodS: GRACE_S,
    allowOverpayment: true,
    originationFee,
    data: "xrlp:spike-xrpl15",
    borrowerSig: { single: w.borrower },
  });
  row(`LoanSet ${PRINCIPAL} @10%, 3 x 60 s, GracePeriod ${GRACE_S} s, origination fee ${originationFee} (single-key borrower)`, loan.tx);
  const params = { loanId: loan.loanId, brokerOwner: w.platform, projectId: PROJECT_ID };
  const vaultSnap0 = await getVaultSnapshot(vault.vaultId);
  spike.note(`after LoanSet: vault sharePrice ${vaultSnap0?.sharePrice}, assetsTotal ${vaultSnap0?.assetsTotal}, assetsAvailable ${vaultSnap0?.assetsAvailable}`);

  if (PREPAY) {
    await spike.ok(`LoanPay ${PREPAY} overpayment, on time (borrower), then no more payments`, () =>
      signAndSubmit(w.borrower, {
        TransactionType: "LoanPay",
        Account: w.borrower.classicAddress,
        LoanID: loan.loanId,
        Amount: rlusdAmount(issuer, PREPAY),
        Flags: LoanPayFlags.tfLoanOverpayment,
      }),
    );
  }
  const s0 = await fetchLoanManageState(loan.loanId);
  describeState("before any LoanManage", s0);
  if (!s0.loan) throw new Error("loan vanished");

  // 1. Client-side guard before the due date: nothing submitted.
  await refusedClientSide("defaultLoan before NextPaymentDueDate + GracePeriod", w.platform.classicAddress, LoanManageTooSoonError, () => defaultLoan(params));
  await refusedClientSide("impairLoan before NextPaymentDueDate", w.platform.classicAddress, LoanManageTooSoonError, () => impairLoan(params));

  // 2. Same calls with the guard skipped: the ledger must agree (tecTOO_SOON), as long as the due date hasn't passed yet.
  const margin = impairableAfter(s0.loan) - (await ledgerTime());
  if (margin >= 15) {
    await attempt("LoanManage tfLoanImpair before NextPaymentDueDate (skipGuard)", "tecTOO_SOON", () => impairLoan({ ...params, skipGuard: true }));
  } else {
    spike.note(`skipped the on-ledger impair-too-soon check: only ${margin}s left before the due date`);
  }
  await attempt("LoanManage tfLoanDefault before NextPaymentDueDate + GracePeriod (skipGuard)", "tecTOO_SOON", () => defaultLoan({ ...params, skipGuard: true }));

  // 3. Payment overdue: impair -> unimpair -> impair.
  await waitForLedgerTimeAfter(impairableAfter(s0.loan), tick(`payment overdue (> ${iso(impairableAfter(s0.loan))})`));
  process.stdout.write("\n");
  const imp1 = await impairLoan(params);
  describeImpair("LoanManage tfLoanImpair (payment overdue)", imp1);
  const unimp = await unimpairLoan(params);
  describeImpair("LoanManage tfLoanUnimpair", unimp);
  const imp2 = await impairLoan(params);
  describeImpair("LoanManage tfLoanImpair again", imp2);
  const vaultImpaired = await getVaultSnapshot(vault.vaultId);
  spike.note(`impaired vault via getVaultSnapshot: sharePrice ${vaultImpaired?.sharePrice} (AssetsTotal / shares, LossUnrealized not deducted)`);
  keepFixture("devnet-loan-impair-tx", "LoanManage tfLoanImpair: 1000 RLUSD loan, payment overdue, cash-basis vault (LEVersion 1)", imp1.tx, {
    loanId: loan.loanId,
    sharesOutstanding: imp1.outcome.sharesOutstanding,
  });
  keepFixture("devnet-loan-unimpair-tx", "LoanManage tfLoanUnimpair right after the impair", unimp.tx, { loanId: loan.loanId, sharesOutstanding: unimp.outcome.sharesOutstanding });

  // 4. Past due + grace: only the broker owner may default.
  await waitForLedgerTimeAfter(defaultableAfter(s0.loan), tick(`due + grace (> ${iso(defaultableAfter(s0.loan))})`));
  process.stdout.write("\n");
  await refusedClientSide("defaultLoan by a non-owner (outsider)", w.outsider.classicAddress, LoanManageRefusedError, () => defaultLoan({ ...params, brokerOwner: w.outsider }));
  await attempt("LoanManage tfLoanDefault by a non-owner (outsider, skipGuard)", "tecNO_PERMISSION", () => defaultLoan({ ...params, brokerOwner: w.outsider, skipGuard: true }));

  const pre = await fetchLoanManageState(loan.loanId);
  describeState("right before the default", pre);
  if (!pre.loan || !pre.broker) throw new Error("loan/broker vanished");
  const independentExpected = expectedDefaultCovered({
    debtTotal: pre.broker.DebtTotal ?? "0",
    coverRateMinimum: pre.broker.CoverRateMinimum ?? 0,
    coverRateLiquidation: pre.broker.CoverRateLiquidation ?? 0,
    defaultAmount: loanExposure(pre.loan, vaultAccounting(pre.vault)),
    coverAvailable: pre.broker.CoverAvailable ?? "0",
    ...(pre.loan.LoanScale !== undefined ? { loanScale: pre.loan.LoanScale } : {}),
  });
  const platformRlusdBefore = await rlusdBalance(w.platform.classicAddress, issuer);
  const vaultBefore = await getVaultSnapshot(vault.vaultId);
  const d = await defaultLoan(params);
  row("LoanManage tfLoanDefault (platform, after due + grace)", d.tx);
  const o = d.outcome;
  const vaultAfter = await getVaultSnapshot(vault.vaultId);
  const platformRlusdAfter = await rlusdBalance(w.platform.classicAddress, issuer);
  spike.note(
    `DEFAULT (${o.accounting}, wasImpaired=${o.wasImpaired}): DefaultAmount ${o.defaultAmount}; DefaultCovered ${o.exact.defaultCovered} ` +
      `(expected from pre-read ${independentExpected}, from metadata ${o.exact.expectedDefaultCovered}) -> ` +
      `${o.exact.defaultCovered === independentExpected && o.exact.defaultCovered === o.exact.expectedDefaultCovered ? "MATCH" : "MISMATCH"}; vault loss ${o.exact.vaultLoss}`,
  );
  spike.note(
    `vault AssetsTotal ${o.vault.before.assetsTotal} -> ${o.vault.after.assetsTotal}, AssetsAvailable ${o.vault.before.assetsAvailable} -> ${o.vault.after.assetsAvailable}, ` +
      `LossUnrealized ${o.vault.before.lossUnrealized} -> ${o.vault.after.lossUnrealized}; share price ${o.vault.before.sharePrice} -> ${o.vault.after.sharePrice} ` +
      `(net ${o.vault.before.netSharePrice} -> ${o.vault.after.netSharePrice}); getVaultSnapshot sharePrice ${vaultBefore?.sharePrice} -> ${vaultAfter?.sharePrice}`,
  );
  spike.note(
    `broker CoverAvailable ${o.coverAvailable.before} -> ${o.coverAvailable.after}, DebtTotal ${o.debtTotal.before} -> ${o.debtTotal.after}; ` +
      `platform RLUSD ${platformRlusdBefore} -> ${platformRlusdAfter} (cover sits in the broker pseudo-account); event ${JSON.stringify(d.event)}`,
  );
  keepFixture("devnet-loan-default-tx", "LoanManage tfLoanDefault after due + grace: impaired 1000 RLUSD loan, no payments, cash-basis vault (LEVersion 1), cover 10%/100%", d.tx, {
    loanId: loan.loanId,
    sharesOutstanding: o.sharesOutstanding,
    expectedDefaultCovered: independentExpected,
  });

  // 5. Idempotent replay, then what the ledger does with a defaulted loan.
  const seq = await sequenceOf(w.platform.classicAddress);
  const again = await defaultLoan(params);
  const seqAfter = await sequenceOf(w.platform.classicAddress);
  if (!again.alreadyDefaulted || again.tx.hash !== d.tx.hash || seqAfter !== seq) {
    throw new Error(`replay: alreadyDefaulted=${again.alreadyDefaulted} hash ${again.tx.hash} vs ${d.tx.hash}, Sequence ${seq} -> ${seqAfter}`);
  }
  spike.rows.push({ step: `defaultLoan again: alreadyDefaulted, same tx returned, nothing submitted (Sequence ${seq} unchanged)`, result: "replay", hash: again.tx.hash });
  spike.log(`  ✔ replay: alreadyDefaulted, same hash, Sequence unchanged`);

  const periodic = String(pre.loan.PeriodicPayment ?? "1");
  const payAmount = (Math.ceil(Number(periodic) * 1e6) / 1e6).toFixed(6);
  await attempt(`LoanPay ${payAmount} after default (borrower)`, "tecKILLED", () =>
    signAndSubmit(w.borrower, { TransactionType: "LoanPay", Account: w.borrower.classicAddress, LoanID: loan.loanId, Amount: rlusdAmount(issuer, payAmount) }),
  );
  await attempt("LoanManage tfLoanUnimpair on the defaulted loan (platform, skipGuard)", "tecNO_PERMISSION", () => unimpairLoan({ ...params, skipGuard: true }));
  const post = await fetchLoanManageState(loan.loanId);
  describeState("after the default", post);

  if (process.env.SPIKE_WRITE_FIXTURES) {
    const dir = join(import.meta.dirname, "..", "test", "fixtures");
    mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(fixtures)) writeFileSync(join(dir, `${name}.json`), JSON.stringify(body, null, 2) + "\n");
    spike.note(`fixtures written: ${Object.keys(fixtures).join(", ")}`);
  }

  spike.print();
  console.log(
    `\nrun record: ${spike.save({ vaultId: vault.vaultId, loanBrokerId: broker.loanBrokerId, loanId: loan.loanId, outcome: o, event: d.event, impair: imp1.outcome, unimpair: unimp.outcome, fixtures })}`,
  );
} catch (e) {
  spike.print();
  console.error(`\nrun record: ${spike.save({ error: String(e), fixtures })}`);
  throw e;
} finally {
  await disconnect();
}
