// XRPL-13 spike: atomic loan close via XLS-56 Batch (BatchV1_1) on devnet.
//   pnpm --filter @xrlp/xrpl spike:batch            (~3 min, fresh faucet wallets)
// Order (most to least likely):
//   A  sanity: outer = SPV (multisigned 3/4), 2 × RLUSD Payment SPV->builder, no BatchSigners
//   B  sanity: outer = platform, same 2 inner Payments from the SPV, BatchSigners = SPV multisig (BatchSigner.Signers)
//   C  atomicity: outer = SPV, 2nd Payment overdraws -> Batch tesSUCCESS, no inner applied (tfAllOrNothing)
//   F1 full close: outer = platform, LoanSet (Counterparty SPV, no CounterpartySignature) + 2 × EscrowCreate, BatchSigners SPV
//   F2 full close, borrower-initiated: outer = SPV, LoanSet Account = SPV / Counterparty = platform + 2 × EscrowCreate
//   E  closeLoanAtomic mode "auto" with 3 milestones: tries the full close; on temINVALID_INNER_BATCH falls back to the
//      countersigned LoanSet, then ONE Batch with 3 × EscrowCreate from the SPV (mode "escrows")
// tem/tef results are not on-ledger: the row records the engine result + rippled's message.
import { AccountSetAsfFlags } from "xrpl";
import { explorerTxUrl } from "@xrlp/shared";
import { closeLoanAtomic, submitBatch, type AtomicMilestone, type BatchResult } from "../src/batch.ts";
import { disconnect, ledgerTime, signAndSubmit, waitForLedgerTimeAfter, XrplTxError } from "../src/client.ts";
import { testConditionPair } from "../test/support/conditions.ts";
import { listEscrows } from "../src/escrow.ts";
import { createLoanBroker, depositBrokerCover, getLoan } from "../src/loan.ts";
import { configureIssuer, ensureTrustline, issueRlusd, rlusdAmount, rlusdBalance } from "../src/rlusd.ts";
import { createVault, depositToVaultTx } from "../src/vault.ts";
import { Spike } from "./spike-lib.ts";

const PRINCIPAL = "1000";
const ORIGINATION_FEE = "10";
const COVER = "150";
const SUBSCRIPTION_S = Number(process.env.SPIKE_SUBSCRIPTION_S ?? 60);
const PAYMENT_INTERVAL_S = 120;
const PAYMENT_TOTAL = 2;

const spike = new Spike("spike-xrpl13-batch");
const ROLES = ["issuer", "platform", "builder", "inspector", "trustee", "investor", "spv"] as const;

function recordBatch(step: string, r: BatchResult): void {
  spike.rows.push({ step, result: r.tx.result, hash: r.tx.hash });
  spike.log(`  ✔ ${step}: ${r.tx.result} ${r.tx.explorerUrl}`);
  for (const i of r.inners) {
    spike.rows.push({ step: `  ↳ inner ${i.transactionType} (${i.account.slice(0, 6)}… seq ${i.sequence})`, result: i.result, ...(i.result !== "not_applied" ? { hash: i.hash } : {}) });
    spike.log(`    ↳ ${i.transactionType} ${i.result} ${i.result !== "not_applied" ? i.explorerUrl : "(not on ledger)"}`);
  }
}

/** Run a variant that may fail with a tem/tef (not on ledger). Records the result either way; never throws XrplTxError. */
async function attempt(step: string, run: () => Promise<BatchResult>): Promise<BatchResult | XrplTxError> {
  try {
    const r = await run();
    recordBatch(step, r);
    return r;
  } catch (e) {
    if (!(e instanceof XrplTxError)) throw e;
    spike.rows.push({ step, result: e.engineResult, ...(e.hash ? { hash: e.hash } : {}) });
    spike.log(`  ✘ ${step}: ${e.message}`);
    spike.note(`${step}: ${e.message}`);
    return e;
  }
}

try {
  const w = await spike.fund(ROLES);
  const issuer = w.issuer.classicAddress;
  const spv = w.spv.classicAddress;
  const builder = w.builder.classicAddress;
  const quorum = [w.platform, w.builder, w.inspector];

  for (const tx of await configureIssuer(w.issuer)) spike.rows.push({ step: "issuer AccountSet", result: tx.result, hash: tx.hash });
  for (const r of ["platform", "investor", "spv", "builder"] as const) await spike.ok(`TrustSet ${r}`, () => ensureTrustline(w[r], issuer));
  await spike.ok("RLUSD -> investor 1000", () => issueRlusd(w.issuer, w.investor.classicAddress, "1000"));
  await spike.ok("RLUSD -> platform 500", () => issueRlusd(w.issuer, w.platform.classicAddress, "500"));
  await spike.ok("RLUSD -> SPV 20 (sanity batches)", () => issueRlusd(w.issuer, spv, "20"));

  await spike.ok("SPV SignerListSet (v2: 4 x w1, quorum 3)", () =>
    signAndSubmit(w.spv, {
      TransactionType: "SignerListSet",
      Account: spv,
      SignerQuorum: 3,
      SignerEntries: (["platform", "builder", "inspector", "trustee"] as const).map((r) => ({ SignerEntry: { Account: w[r].classicAddress, SignerWeight: 1 } })),
    }),
  );
  await spike.ok("SPV AccountSet asfDisableMaster", () => signAndSubmit(w.spv, { TransactionType: "AccountSet", Account: spv, SetFlag: AccountSetAsfFlags.asfDisableMaster }));

  // Vault + broker first so the subscription clock runs while the sanity batches go through.
  const now = await ledgerTime();
  const sub = now + SUBSCRIPTION_S;
  const red = sub + PAYMENT_INTERVAL_S * PAYMENT_TOTAL + 600;
  const vault = await createVault({ owner: w.platform, issuer, subscriptionDate: sub, redemptionDate: red, assetsMaximum: PRINCIPAL, data: "xrlp:spike-xrpl13" });
  spike.rows.push({ step: "VaultCreate closed-ended", result: vault.tx.result, hash: vault.tx.hash });
  const broker = await createLoanBroker({ owner: w.platform, vaultId: vault.vaultId, data: "xrlp:spike-xrpl13" });
  spike.rows.push({ step: "LoanBrokerSet (cover 10% / 100%, mgmt fee)", result: broker.tx.result, hash: broker.tx.hash });
  await spike.ok(`LoanBrokerCoverDeposit ${COVER}`, () => depositBrokerCover(w.platform, broker.loanBrokerId, issuer, COVER));
  await spike.ok(`VaultDeposit investor ${PRINCIPAL}`, () => depositToVaultTx(w.investor, vault.vaultId, issuer, PRINCIPAL));

  const pay = (value: string) => ({ TransactionType: "Payment" as const, Account: spv, Destination: builder, Amount: rlusdAmount(issuer, value) });

  // A: outer = SPV multisig, all inners from the SPV -> no BatchSigners.
  await attempt("A Batch outer=SPV (multisig 3/4), 2 × Payment SPV->builder 1 RLUSD", () =>
    submitBatch({ account: spv, outerSigner: { multisig: quorum }, inners: [pay("1"), pay("1")] }),
  );
  // B: outer = platform, inners from the SPV -> BatchSigners [{Account: SPV, Signers: [3]}].
  await attempt("B Batch outer=platform, 2 × Payment SPV->builder, BatchSigners SPV multisig (3/4)", () =>
    submitBatch({ account: w.platform.classicAddress, outerSigner: { single: w.platform }, inners: [pay("1"), pay("1")], batchSigners: { [spv]: quorum } }),
  );
  // C: tfAllOrNothing really rolls back.
  const spvBeforeC = await rlusdBalance(spv, issuer);
  await attempt("C Batch outer=SPV, Payment 1 + Payment 999 (overdraw) -> nothing applied", () =>
    submitBatch({ account: spv, outerSigner: { multisig: quorum }, inners: [pay("1"), pay("999")] }),
  );
  spike.note(`C: SPV RLUSD ${spvBeforeC} -> ${await rlusdBalance(spv, issuer)} (unchanged = all-or-nothing works)`);

  await waitForLedgerTimeAfter(sub, (s) => process.stdout.write(`\r  waiting for Investment phase ~${s}s   `));
  process.stdout.write("\n");

  const cancelAfter = (await ledgerTime()) + 3600;
  const milestones = (n: number, amount: string): AtomicMilestone[] =>
    Array.from({ length: n }, (_, i) => ({ milestoneId: `m${i + 1}`, amount, condition: testConditionPair().condition, cancelAfter }));
  const loan = {
    brokerOwner: w.platform,
    loanBrokerId: broker.loanBrokerId,
    borrower: spv,
    principal: PRINCIPAL,
    interestRate: 10_000,
    paymentTotal: PAYMENT_TOTAL,
    paymentIntervalS: PAYMENT_INTERVAL_S,
    gracePeriodS: 60,
    allowOverpayment: true,
    originationFee: ORIGINATION_FEE,
    data: "xrlp:spike-xrpl13",
  };

  // F1: the real atomic close.
  const f1 = await closeLoanAtomic({ loan, builder, issuer, milestones: milestones(2, "400"), spvSigners: quorum, mode: "full" }).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
  if (f1 instanceof XrplTxError) {
    spike.rows.push({ step: "F1 Batch outer=platform: LoanSet (Counterparty SPV, no CounterpartySignature) + 2 × EscrowCreate, BatchSigners SPV", result: f1.engineResult, ...(f1.hash ? { hash: f1.hash } : {}) });
    spike.note(`F1: ${f1.message}`);
  } else if (f1 instanceof Error) {
    throw f1;
  } else {
    spike.rows.push({ step: "F1 full atomic close (LoanSet + 2 × EscrowCreate)", result: f1.batchTx.result, hash: f1.batchTx.hash });
    spike.note(`F1 WORKED: loan ${f1.loanId}, escrows ${f1.escrows.map((e) => e.explorerUrl).join(" ")}`);
  }

  // F2: borrower-initiated LoanSet inside a Batch from the SPV (platform = counterparty, single-sig BatchSigner).
  if (f1 instanceof XrplTxError) {
    const c1 = testConditionPair().condition;
    const c2 = testConditionPair().condition;
    await attempt("F2 Batch outer=SPV (multisig): LoanSet Account=SPV/Counterparty=platform + 2 × EscrowCreate, BatchSigners platform", () =>
      submitBatch({
        account: spv,
        outerSigner: { multisig: quorum },
        inners: [
          {
            TransactionType: "LoanSet",
            Account: spv,
            LoanBrokerID: broker.loanBrokerId,
            Counterparty: w.platform.classicAddress,
            PrincipalRequested: PRINCIPAL,
            InterestRate: 10_000,
            PaymentTotal: PAYMENT_TOTAL,
            PaymentInterval: PAYMENT_INTERVAL_S,
            GracePeriod: 60,
          },
          { TransactionType: "EscrowCreate", Account: spv, Destination: builder, Amount: rlusdAmount(issuer, "400"), Condition: c1, CancelAfter: cancelAfter },
          { TransactionType: "EscrowCreate", Account: spv, Destination: builder, Amount: rlusdAmount(issuer, "400"), Condition: c2, CancelAfter: cancelAfter },
        ],
        batchSigners: { [w.platform.classicAddress]: [w.platform] },
      }),
    );

    // E: mode "auto" = full close if the network takes it, else the fallback that works today.
    const spvBefore = await rlusdBalance(spv, issuer);
    const ms = milestones(3, "330");
    const e = await closeLoanAtomic({ loan, builder, issuer, milestones: ms, spvSigners: quorum, mode: "auto" });
    spike.note(e.fallback ? `E (auto): full close refused (${e.fallback.engineResult}: ${e.fallback.message}) -> fell back to mode "${e.mode}"` : `E (auto): FULL atomic close worked (mode "${e.mode}")`);
    spike.rows.push({ step: "E1 LoanSet countersigned by SPV multisig (standalone)", result: e.loanSetTx.result, hash: e.loanSetTx.hash });
    spike.rows.push({ step: "E2 Batch outer=SPV (multisig 3/4): 3 × EscrowCreate 330 RLUSD, tfAllOrNothing", result: e.batchTx.result, hash: e.batchTx.hash });
    for (const x of e.escrows) spike.rows.push({ step: `  ↳ inner EscrowCreate ${x.milestoneId} (OfferSequence ${x.offerSequence})`, result: "tesSUCCESS", hash: x.createTx });
    const spvAfter = await rlusdBalance(spv, issuer);
    const onLedger = await listEscrows(spv);
    const entry = await getLoan(e.loanId);
    const loanLedger = Number((e.batchTx.tx as { ledger_index?: number }).ledger_index ?? e.batchTx.ledgerIndex);
    spike.note(`E: loan ${e.loanId} (PrincipalOutstanding ${entry?.PrincipalOutstanding}); SPV RLUSD ${spvBefore} -> ${spvAfter}; ${onLedger.length} escrows on ledger`);
    spike.note(`E: Batch fee ${(e.batchTx.tx as { Fee?: string }).Fee} drops; batch ledger ${loanLedger}. SPV held liquid principal from the LoanSet ledger until the Batch ledger.`);
    spike.note(`E escrows: ${e.escrows.map((x) => `${x.milestoneId} seq ${x.offerSequence} ${explorerTxUrl(x.createTx)}`).join(" · ")}`);
  }

  spike.print();
  console.log(`\nrun record: ${spike.save({ vaultId: vault.vaultId, loanBrokerId: broker.loanBrokerId })}`);
} catch (e) {
  spike.print();
  console.error(`\nrun record: ${spike.save({ error: String(e) })}`);
  throw e;
} finally {
  await disconnect();
}
