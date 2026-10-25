// XRPL-09: record real devnet JSON for the read-model parsers (src/reads.ts) into test/fixtures/.
//   pnpm --filter @xrlp/xrpl capture:reads     (~2 min, fresh faucet wallets; no seeds are written to fixtures)
// Creates: closed-ended vault + deposit (Subscription), single-key LoanSet (Investment) + payoff,
// escrows (open, expired, finished), and records vault/share issuance/loan/escrow/account_lines/account_info.
// Also records the XRPL-01 spike loan (+ its broker and vault) which is long past RedemptionDate.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Wallet } from "xrpl";
import { disconnect, getClient, ledgerTime, signAndSubmit, waitForLedgerTimeAfter, type TxResult } from "../src/client.ts";
import { testConditionPair } from "../test/support/conditions.ts";
import { createMilestoneEscrow, finishEscrow } from "../src/escrow.ts";
import { createLoanBroker, depositBrokerCover, getLoan, loanSet } from "../src/loan.ts";
import { configureIssuer, ensureTrustline, issueRlusd, rlusdAmount } from "../src/rlusd.ts";
import { createVault, depositToVaultTx } from "../src/vault.ts";
import { Spike } from "./spike-lib.ts";

const FIXTURES = join(import.meta.dirname, "..", "test", "fixtures");
const XRPL01_LOAN = "66FE03B2BFDE7B6AD7C55272384707A9EADC2166C349604858474E5C43D12018";

type Json = Record<string, unknown>;

async function rpc(req: Json): Promise<Json> {
  const client = await getClient();
  try {
    const res = (await client.request(req as never)) as { result: Json };
    return res.result;
  } catch (e) {
    const data = (e as { data?: Json }).data;
    if (data?.error) return data; // recorded rippled error payload (e.g. entryNotFound / actNotFound)
    throw e;
  }
}

/** Validated ledger header (no txs) + the index so every read in a fixture comes from the same ledger. */
async function validatedLedger(): Promise<{ ledger: Json; at: number }> {
  const r = await rpc({ command: "ledger", ledger_index: "validated" });
  const ledger = r.ledger as Json;
  return { ledger, at: Number(ledger.ledger_index) };
}

function save(name: string, body: Json): void {
  mkdirSync(FIXTURES, { recursive: true });
  const file = join(FIXTURES, `${name}.json`);
  writeFileSync(file, JSON.stringify({ capturedAt: new Date().toISOString(), network: "devnet", ...body }, null, 2) + "\n");
  console.log(`  ↳ ${file}`);
}

async function captureVault(name: string, vaultId: string, description: string): Promise<void> {
  const { ledger, at } = await validatedLedger();
  const vault = await rpc({ command: "ledger_entry", index: vaultId, ledger_index: at });
  const shareMptId = (vault.node as Json).ShareMPTID as string;
  const shareIssuance = await rpc({ command: "ledger_entry", mpt_issuance: shareMptId, ledger_index: at });
  save(name, { description, ledger, vault, shareIssuance });
}

async function captureLoan(name: string, loanId: string, description: string): Promise<void> {
  const { ledger, at } = await validatedLedger();
  const loan = await rpc({ command: "ledger_entry", index: loanId, ledger_index: at });
  save(name, { description, ledger, loan });
}

const spike = new Spike("capture-read-fixtures");
const ROLES = ["issuer", "platform", "investor", "borrower", "builder", "noTrust"] as const;

try {
  // --- XRPL-01 loan (existing devnet objects; Redemption phase, AssetsAvailable omitted) ---
  const x01 = (await rpc({ command: "ledger_entry", index: XRPL01_LOAN, ledger_index: "validated" })).node as Json | undefined;
  if (x01) {
    const broker = (await rpc({ command: "ledger_entry", index: x01.LoanBrokerID, ledger_index: "validated" })).node as Json;
    await captureLoan("loan-xrpl01", XRPL01_LOAN, "XRPL-01 spike loan: 1000 RLUSD, 2 x 120s, SPV multisig borrower");
    await captureVault("vault-xrpl01", broker.VaultID as string, "XRPL-01 spike vault after LoanSet (AssetsAvailable omitted = 0)");
  } else {
    spike.note("XRPL-01 loan no longer on devnet (reset?) — skipped loan-xrpl01 / vault-xrpl01");
  }

  // --- fresh objects ---
  const w = await spike.fund(ROLES);
  const issuer = w.issuer.classicAddress;
  for (const tx of await configureIssuer(w.issuer)) spike.rows.push({ step: "issuer AccountSet", result: tx.result, hash: tx.hash });
  for (const r of ["platform", "investor", "borrower", "builder"] as const) await spike.ok(`TrustSet ${r}`, () => ensureTrustline(w[r], issuer));
  await spike.ok("RLUSD -> investor 1234.5", () => issueRlusd(w.issuer, w.investor.classicAddress, "1234.5"));
  await spike.ok("RLUSD -> platform 300", () => issueRlusd(w.issuer, w.platform.classicAddress, "300"));
  await spike.ok("RLUSD -> borrower 400 (interest + escrows)", () => issueRlusd(w.issuer, w.borrower.classicAddress, "400"));

  const now = await ledgerTime();
  const sub = now + 45;
  const red = sub + 300;
  const vault = await createVault({ owner: w.platform, issuer, subscriptionDate: sub, redemptionDate: red, data: "xrlp:capture-reads" });
  spike.rows.push({ step: "VaultCreate closed-ended", result: vault.tx.result, hash: vault.tx.hash });
  const broker = await createLoanBroker({ owner: w.platform, vaultId: vault.vaultId, coverRateMinimum: 10_000, coverRateLiquidation: 100_000 });
  spike.rows.push({ step: "LoanBrokerSet", result: broker.tx.result, hash: broker.tx.hash });
  await spike.ok("LoanBrokerCoverDeposit 100", () => depositBrokerCover(w.platform, broker.loanBrokerId, issuer, "100"));
  await spike.ok("VaultDeposit investor 1234.5", () => depositToVaultTx(w.investor, vault.vaultId, issuer, "1234.5"));
  await captureVault("vault-subscription", vault.vaultId, "closed-ended vault, Subscription phase, one 1234.5 RLUSD deposit");

  // Balances (account_lines / account_info) while things are simple.
  {
    const { ledger, at } = await validatedLedger();
    const investorLines = await rpc({ command: "account_lines", account: w.investor.classicAddress, ledger_index: at });
    const noTrustLines = await rpc({ command: "account_lines", account: w.noTrust.classicAddress, ledger_index: at });
    const issuerLines = await rpc({ command: "account_lines", account: issuer, ledger_index: at });
    const investorInfo = await rpc({ command: "account_info", account: w.investor.classicAddress, ledger_index: at });
    const unfunded = Wallet.generate().classicAddress;
    const unfundedLines = await rpc({ command: "account_lines", account: unfunded, ledger_index: at });
    const unfundedInfo = await rpc({ command: "account_info", account: unfunded, ledger_index: at });
    save("balances", {
      description: "investor (RLUSD trust line, 0 RLUSD after depositing all), noTrust (no lines), issuer (negative side), unfunded (actNotFound)",
      ledger,
      issuer,
      investorLines,
      noTrustLines,
      issuerLines,
      investorInfo,
      unfundedLines,
      unfundedInfo,
    });
  }

  // LoanSet (single-key borrower), 1 payment.
  await waitForLedgerTimeAfter(sub, (s) => process.stdout.write(`\r  waiting for Investment phase ~${s}s   `));
  process.stdout.write("\n");
  const loan = await loanSet({
    brokerOwner: w.platform,
    loanBrokerId: broker.loanBrokerId,
    borrower: w.borrower.classicAddress,
    principal: "1000",
    interestRate: 50_000,
    paymentTotal: 1,
    paymentIntervalS: 90,
    gracePeriodS: 60,
    allowOverpayment: true,
    originationFee: "5",
    borrowerSig: { single: w.borrower },
  });
  spike.rows.push({ step: "LoanSet single-key borrower", result: loan.tx.result, hash: loan.tx.hash });
  spike.log(`  ✔ LoanSet ${loan.tx.explorerUrl}`);
  await captureLoan("loan-active", loan.loanId, "1000 RLUSD, 50% APR, 1 x 90s, before any payment");
  await captureVault("vault-investment", vault.vaultId, "same vault in Investment phase after LoanSet 1000 of 1234.5");

  // Escrows from the borrower to the builder: open (7-decimal amount), expired-but-present, finished.
  const open = testConditionPair();
  const short = testConditionPair();
  const done = testConditionPair();
  const t0 = await ledgerTime();
  const escOpen = await createMilestoneEscrow({ spv: w.borrower.classicAddress, builder: w.builder.classicAddress, issuer, amount: "100.1234567", condition: open.condition, cancelAfter: t0 + 3600, singleKey: w.borrower });
  spike.rows.push({ step: "EscrowCreate open 100.1234567", result: escOpen.tx.result, hash: escOpen.tx.hash });
  const escShort = await createMilestoneEscrow({ spv: w.borrower.classicAddress, builder: w.builder.classicAddress, issuer, amount: "50", condition: short.condition, cancelAfter: t0 + 20, singleKey: w.borrower });
  spike.rows.push({ step: "EscrowCreate short CancelAfter", result: escShort.tx.result, hash: escShort.tx.hash });
  const escDone = await createMilestoneEscrow({ spv: w.borrower.classicAddress, builder: w.builder.classicAddress, issuer, amount: "25", condition: done.condition, cancelAfter: t0 + 3600, singleKey: w.borrower });
  spike.rows.push({ step: "EscrowCreate to finish", result: escDone.tx.result, hash: escDone.tx.hash });
  await spike.ok("EscrowFinish", () => finishEscrow({ submitter: w.platform, owner: w.borrower.classicAddress, offerSequence: escDone.offerSequence, condition: done.condition, fulfillment: done.fulfillment }));
  await waitForLedgerTimeAfter(t0 + 20);
  {
    const { ledger, at } = await validatedLedger();
    const owner = w.borrower.classicAddress;
    const byKey = (seq: number) => rpc({ command: "ledger_entry", escrow: { owner, seq }, ledger_index: at });
    save("escrows", {
      description: "owner=borrower: open (100.1234567, CancelAfter +1h), expired (CancelAfter passed, not cancelled), finished (entryNotFound)",
      ledger,
      owner,
      destination: w.builder.classicAddress,
      sequences: { open: escOpen.offerSequence, expired: escShort.offerSequence, finished: escDone.offerSequence },
      open: await byKey(escOpen.offerSequence),
      expired: await byKey(escShort.offerSequence),
      finished: await byKey(escDone.offerSequence),
      accountObjects: await rpc({ command: "account_objects", account: owner, type: "escrow", ledger_index: at }),
      builderLines: await rpc({ command: "account_lines", account: w.builder.classicAddress, ledger_index: at }),
    });
  }

  // Pay the loan off (single payment) -> PaymentRemaining 0.
  const entry = await getLoan(loan.loanId);
  const due = entry?.TotalValueOutstanding ?? "0";
  const payTx: TxResult = await signAndSubmit(w.borrower, {
    TransactionType: "LoanPay",
    Account: w.borrower.classicAddress,
    LoanID: loan.loanId,
    Amount: rlusdAmount(issuer, due),
  });
  spike.rows.push({ step: `LoanPay ${due}`, result: payTx.result, hash: payTx.hash });
  spike.log(`  ✔ LoanPay ${payTx.explorerUrl}`);
  await captureLoan("loan-paid", loan.loanId, "same loan after paying TotalValueOutstanding");
  await captureVault("vault-repaid", vault.vaultId, "same vault after the loan was repaid (Investment phase)");

  spike.print();
  console.log(`\nrun record: ${spike.save({ vaultId: vault.vaultId, loanBrokerId: broker.loanBrokerId, loanId: loan.loanId })}`);
} catch (e) {
  spike.print();
  console.error(`\nrun record: ${spike.save({ error: String(e) })}`);
  throw e;
} finally {
  await disconnect();
}
