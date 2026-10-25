// XRPL-01 spike: multisig-counterparty LoanSet on a closed-ended vault, with the v2 SPV signer list.
//   pnpm --filter @xrlp/xrpl spike:loanset            (~3 min, fresh faucet wallets)
// Proves on devnet:
//   - open-ended vault + LoanBrokerSet -> tecNO_PERMISSION (LendingProtocolV1_1)
//   - closed-ended vault + LoanBrokerSet with cover rates (10% / 100%) + ManagementFeeRate + LoanBrokerCoverDeposit
//   - LoanSet before SubscriptionDate -> tecTOO_SOON
//   - LoanSet: platform = Account, SPV (master disabled, SignerList {platform, builder, inspector, trustee} w1, quorum 3)
//     = Counterparty, CounterpartySignature.Signers from 3 SPV signers; LoanOriginationFee > 0; tfLoanOverpayment
// Env: SPIKE_SIGNERS=platform,builder,inspector (which 3 SPV signers countersign), SPIKE_SUBSCRIPTION_S=60.
import { AccountSetAsfFlags, rippleTimeToISOTime } from "xrpl";
import { disconnect, getLedgerEntry, ledgerTime, signAndSubmit, waitForLedgerTimeAfter } from "../src/client.ts";
import { createLoanBroker, depositBrokerCover, getLoan, loanSet, type LoanBrokerEntry } from "../src/loan.ts";
import { configureIssuer, ensureTrustline, issueRlusd, rlusdAsset, rlusdBalance } from "../src/rlusd.ts";
import { getSpvInfo } from "../src/spv.ts";
import { createVault, depositToVaultTx, getVault } from "../src/vault.ts";
import { Spike } from "./spike-lib.ts";

const PRINCIPAL = "1000";
const ORIGINATION_FEE = "10"; // 1% of principal -> platform
const COVER = "150"; // >= 10% x (principal + interest)
const COVER_RATE_MINIMUM = 10_000; // 1/10 bps -> 10%
const COVER_RATE_LIQUIDATION = 100_000; // 100% of the minimum
const MANAGEMENT_FEE_RATE = 1_000; // 1/10 bps -> 1% of interest to the broker
const INTEREST_RATE = 10_000; // 1/10 bps -> 10% annual
const PAYMENT_TOTAL = 2;
const PAYMENT_INTERVAL_S = 120;
const SUBSCRIPTION_S = Number(process.env.SPIKE_SUBSCRIPTION_S ?? 60);

const spike = new Spike("spike-xrpl01-loanset");
const ROLES = ["issuer", "platform", "builder", "inspector", "trustee", "investor", "spv"] as const;
type Role = (typeof ROLES)[number];

try {
  const w = await spike.fund(ROLES);
  const issuer = w.issuer.classicAddress;

  for (const tx of await configureIssuer(w.issuer)) spike.rows.push({ step: "issuer AccountSet", result: tx.result, hash: tx.hash });
  for (const r of ["platform", "investor", "spv", "builder"] as const) await spike.ok(`TrustSet ${r}`, () => ensureTrustline(w[r], issuer));
  await spike.ok("RLUSD -> investor 1000", () => issueRlusd(w.issuer, w.investor.classicAddress, "1000"));
  await spike.ok("RLUSD -> platform 500", () => issueRlusd(w.issuer, w.platform.classicAddress, "500"));

  // v2 SPV: {platform, builder, inspector, trustee} weight 1 each, quorum 3, master key disabled.
  await spike.ok("SPV SignerListSet (v2: 4 x w1, quorum 3)", () =>
    signAndSubmit(w.spv, {
      TransactionType: "SignerListSet",
      Account: w.spv.classicAddress,
      SignerQuorum: 3,
      SignerEntries: (["platform", "builder", "inspector", "trustee"] as const).map((r) => ({
        SignerEntry: { Account: w[r].classicAddress, SignerWeight: 1 },
      })),
    }),
  );
  await spike.ok("SPV AccountSet asfDisableMaster", () =>
    signAndSubmit(w.spv, { TransactionType: "AccountSet", Account: w.spv.classicAddress, SetFlag: AccountSetAsfFlags.asfDisableMaster }),
  );
  const spvInfo = await getSpvInfo(w.spv.classicAddress);
  spike.note(`SPV masterDisabled=${spvInfo.masterDisabled} quorum=${spvInfo.signerQuorum} signers=${spvInfo.signers.map((s) => `${s.account}:${s.weight}`).join(",")}`);

  // Negative: an open-ended vault cannot back a LoanBroker under LendingProtocolV1_1.
  const openVault = await spike.ok("VaultCreate open-ended (negative setup)", () =>
    signAndSubmit(w.platform, { TransactionType: "VaultCreate", Account: w.platform.classicAddress, Asset: rlusdAsset(issuer), Data: "78726C703A6F70656E" }),
  );
  const openVaultId = (openVault!.meta.AffectedNodes as Array<Record<string, { LedgerEntryType?: string; LedgerIndex?: string }>>)
    .map((n) => n.CreatedNode)
    .find((c) => c?.LedgerEntryType === "Vault")!.LedgerIndex!;
  await spike.fails("LoanBrokerSet on open-ended vault", "tecNO_PERMISSION", () => createLoanBroker({ owner: w.platform, vaultId: openVaultId }));

  // Closed-ended vault: Subscription -> Investment (LoanSet) -> Redemption.
  const now = await ledgerTime();
  const sub = now + SUBSCRIPTION_S;
  const red = sub + PAYMENT_INTERVAL_S * PAYMENT_TOTAL + 300;
  const vault = await createVault({ owner: w.platform, issuer, subscriptionDate: sub, redemptionDate: red, assetsMaximum: PRINCIPAL, data: "xrlp:spike-xrpl01" });
  spike.rows.push({ step: `VaultCreate closed-ended (sub ${rippleTimeToISOTime(sub)}, red ${rippleTimeToISOTime(red)})`, result: vault.tx.result, hash: vault.tx.hash });
  spike.log(`  ✔ VaultCreate closed-ended ${vault.tx.explorerUrl}`);

  const broker = await createLoanBroker({
    owner: w.platform,
    vaultId: vault.vaultId,
    coverRateMinimum: COVER_RATE_MINIMUM,
    coverRateLiquidation: COVER_RATE_LIQUIDATION,
    managementFeeRate: MANAGEMENT_FEE_RATE,
    data: "xrlp:spike-xrpl01",
  });
  spike.rows.push({ step: "LoanBrokerSet (CoverRateMinimum 10000, CoverRateLiquidation 100000, ManagementFeeRate 1000)", result: broker.tx.result, hash: broker.tx.hash });
  spike.log(`  ✔ LoanBrokerSet ${broker.tx.explorerUrl}`);
  await spike.ok(`LoanBrokerCoverDeposit ${COVER}`, () => depositBrokerCover(w.platform, broker.loanBrokerId, issuer, COVER));
  await spike.ok(`VaultDeposit investor ${PRINCIPAL}`, () => depositToVaultTx(w.investor, vault.vaultId, issuer, PRINCIPAL));

  const signerRoles = (process.env.SPIKE_SIGNERS ?? "platform,builder,inspector").split(",") as Role[];
  const signers = signerRoles.map((r) => w[r]);
  const loanParams = {
    brokerOwner: w.platform,
    loanBrokerId: broker.loanBrokerId,
    borrower: w.spv.classicAddress,
    principal: PRINCIPAL,
    interestRate: INTEREST_RATE,
    paymentTotal: PAYMENT_TOTAL,
    paymentIntervalS: PAYMENT_INTERVAL_S,
    gracePeriodS: 60,
    allowOverpayment: true,
    originationFee: ORIGINATION_FEE,
    data: "xrlp:spike-xrpl01",
    borrowerSig: { multisig: signers },
  };

  // Negative: LoanSet during Subscription.
  if ((await ledgerTime()) < sub - 5) {
    await spike.fails("LoanSet before SubscriptionDate", "tecTOO_SOON", () => loanSet(loanParams));
  } else {
    spike.note("skipped tecTOO_SOON case: subscription already ended; raise SPIKE_SUBSCRIPTION_S");
  }

  await waitForLedgerTimeAfter(sub, (s) => process.stdout.write(`\r  waiting for Investment phase ~${s}s   `));
  process.stdout.write("\n");
  const spvBefore = await rlusdBalance(w.spv.classicAddress, issuer);
  const platformBefore = await rlusdBalance(w.platform.classicAddress, issuer);
  const loan = await loanSet(loanParams);
  spike.rows.push({ step: `LoanSet countersigned by SPV multisig (${signerRoles.join(" + ")})`, result: loan.tx.result, hash: loan.tx.hash });
  spike.log(`  ✔ LoanSet ${loan.tx.explorerUrl}`);

  const tx = loan.tx.tx as { Fee?: string; CounterpartySignature?: { Signers?: unknown[] } };
  const entry = await getLoan(loan.loanId);
  const brokerAfter = await getLedgerEntry<LoanBrokerEntry>(broker.loanBrokerId);
  const vaultAfter = await getVault(vault.vaultId);
  const spvAfter = await rlusdBalance(w.spv.classicAddress, issuer);
  const platformAfter = await rlusdBalance(w.platform.classicAddress, issuer);
  spike.note(`LoanSet Fee=${tx.Fee} drops, CounterpartySignature.Signers=${tx.CounterpartySignature?.Signers?.length}`);
  spike.note(`SPV RLUSD ${spvBefore} -> ${spvAfter} (principal ${PRINCIPAL} - origination ${ORIGINATION_FEE}); platform ${platformBefore} -> ${platformAfter}`);
  spike.note(`Loan ${loan.loanId}: PrincipalOutstanding=${entry?.PrincipalOutstanding} TotalValueOutstanding=${entry?.TotalValueOutstanding} PeriodicPayment=${entry?.PeriodicPayment} PaymentRemaining=${entry?.PaymentRemaining} Flags=${entry?.Flags}`);
  spike.note(`Broker DebtTotal=${brokerAfter?.DebtTotal} CoverAvailable=${brokerAfter?.CoverAvailable}; Vault AssetsTotal=${vaultAfter?.AssetsTotal} AssetsAvailable=${vaultAfter?.AssetsAvailable ?? "0"}`);

  spike.print();
  console.log(`\nrun record: ${spike.save({ vaultId: vault.vaultId, loanBrokerId: broker.loanBrokerId, loanId: loan.loanId, openVaultId })}`);
} catch (e) {
  spike.print();
  console.error(`\nrun record: ${spike.save({ error: String(e) })}`);
  throw e;
} finally {
  await disconnect();
}
