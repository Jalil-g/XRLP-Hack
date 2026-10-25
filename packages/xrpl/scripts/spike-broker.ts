// XRPL-04 devnet proof: closed-ended vault from the date helper, LoanBrokerSet with default rates
// (cover 10% / 100%, ManagementFeeRate), mandatory first-loss cover, LoanSet with a LoanOriginationFee to the platform.
//   pnpm --filter @xrlp/xrpl spike:broker            (~2 min, fresh faucet wallets)
// Proves on devnet:
//   - VaultCreate closed-ended, SubscriptionDate/RedemptionDate from vaultDatesFor(), AssetsMaximum = principal
//   - LoanBrokerSet with COVER_RATE_MINIMUM / COVER_RATE_LIQUIDATION / MANAGEMENT_FEE_RATE (defaults of createLoanBroker)
//   - LoanSet with cover below the protocol minimum -> tecINSUFFICIENT_FUNDS (recorded, whatever it is)
//   - cover topped up to defaultCoverDeposit() -> LoanSet OK, LoanOriginationFee = originationFeeFor(principal) paid to platform
// Single-key SPV counterparty (XRPL-05 owns the multisig SPV). The loan schedule is 2 x 15 days so interest (and the
// management fee) is visible; we never wait for RedemptionDate here.
// Env: SPIKE_SUBSCRIPTION_S=60.
import { rippleTimeToISOTime } from "xrpl";
import { disconnect, getLedgerEntry, ledgerTime, waitForLedgerTimeAfter, XrplTxError } from "../src/client.ts";
import {
  COVER_RATE_LIQUIDATION,
  COVER_RATE_MINIMUM,
  defaultCoverDeposit,
  expectedInterest,
  fromMicro,
  managementFeeOn,
  MANAGEMENT_FEE_RATE,
  minimumCover,
  originationFeeFor,
  toMicro,
  validateBrokerRates,
  vaultDatesFor,
} from "../src/lending-math.ts";
import { createLoanBroker, depositBrokerCover, getLoan, loanSet, type LoanBrokerEntry } from "../src/loan.ts";
import { configureIssuer, ensureTrustline, issueRlusd, rlusdBalance } from "../src/rlusd.ts";
import { createVault, depositToVaultTx, getVault } from "../src/vault.ts";
import { Spike } from "./spike-lib.ts";

const PRINCIPAL = "1000";
const INTEREST_RATE = 10_000; // 1/10 bps -> 10% annual
const SCHEDULE = { paymentTotal: 2, paymentIntervalS: 15 * 86_400 };
const SHORT_COVER = "50"; // below the 10% minimum
const SUBSCRIPTION_S = Number(process.env.SPIKE_SUBSCRIPTION_S ?? 60);

const spike = new Spike("spike-xrpl04-broker");
const ROLES = ["issuer", "platform", "investor", "spv"] as const;

try {
  const w = await spike.fund(ROLES);
  const issuer = w.issuer.classicAddress;
  for (const tx of await configureIssuer(w.issuer)) spike.rows.push({ step: "issuer AccountSet", result: tx.result, hash: tx.hash });
  for (const r of ["platform", "investor", "spv"] as const) await spike.ok(`TrustSet ${r}`, () => ensureTrustline(w[r], issuer));
  await spike.ok(`RLUSD -> investor ${PRINCIPAL}`, () => issueRlusd(w.issuer, w.investor.classicAddress, PRINCIPAL));
  await spike.ok("RLUSD -> platform 500", () => issueRlusd(w.issuer, w.platform.classicAddress, "500"));

  // Client-side guard: mismatched cover rates never reach the ledger (would be temINVALID).
  try {
    validateBrokerRates({ coverRateMinimum: COVER_RATE_MINIMUM, coverRateLiquidation: 0, managementFeeRate: 0 });
    throw new Error("validateBrokerRates accepted a mismatched pair");
  } catch (e) {
    spike.note(`client-side guard: ${(e as Error).message}`);
  }

  const interest = expectedInterest({ principal: PRINCIPAL, interestRate: INTEREST_RATE, ...SCHEDULE });
  const coverMin = minimumCover({ principal: PRINCIPAL, interest });
  const cover = defaultCoverDeposit({ principal: PRINCIPAL, interest });
  const originationFee = originationFeeFor(PRINCIPAL);
  spike.note(`expected interest ${interest.toFixed(6)} (mgmt fee ${managementFeeOn(interest).toFixed(6)}); cover minimum ${coverMin}, default deposit ${cover}; origination fee ${originationFee}`);

  const dates = vaultDatesFor({ subscriptionDate: (await ledgerTime()) + SUBSCRIPTION_S, ...SCHEDULE, bufferS: 3_600 });
  const vault = await createVault({ owner: w.platform, issuer, ...dates, assetsMaximum: PRINCIPAL, loanSchedule: SCHEDULE, data: "xrlp:spike-xrpl04" });
  spike.rows.push({
    step: `VaultCreate closed-ended, AssetsMaximum ${PRINCIPAL} (sub ${rippleTimeToISOTime(dates.subscriptionDate)}, red ${rippleTimeToISOTime(dates.redemptionDate)})`,
    result: vault.tx.result,
    hash: vault.tx.hash,
  });
  spike.log(`  ✔ VaultCreate ${vault.tx.explorerUrl}`);

  const broker = await createLoanBroker({ owner: w.platform, vaultId: vault.vaultId, data: "xrlp:spike-xrpl04" });
  spike.rows.push({
    step: `LoanBrokerSet defaults (CoverRateMinimum ${COVER_RATE_MINIMUM}, CoverRateLiquidation ${COVER_RATE_LIQUIDATION}, ManagementFeeRate ${MANAGEMENT_FEE_RATE})`,
    result: broker.tx.result,
    hash: broker.tx.hash,
  });
  spike.log(`  ✔ LoanBrokerSet ${broker.tx.explorerUrl}`);
  const brokerEntry = await getLedgerEntry<LoanBrokerEntry>(broker.loanBrokerId);
  spike.note(`Broker entry: CoverRateMinimum=${brokerEntry?.CoverRateMinimum} CoverRateLiquidation=${brokerEntry?.CoverRateLiquidation} ManagementFeeRate=${brokerEntry?.ManagementFeeRate}`);

  await spike.ok(`LoanBrokerCoverDeposit ${SHORT_COVER} (below minimum ${coverMin})`, () => depositBrokerCover(w.platform, broker.loanBrokerId, issuer, SHORT_COVER));
  await spike.ok(`VaultDeposit investor ${PRINCIPAL}`, () => depositToVaultTx(w.investor, vault.vaultId, issuer, PRINCIPAL));

  const loanParams = {
    brokerOwner: w.platform,
    loanBrokerId: broker.loanBrokerId,
    borrower: w.spv.classicAddress,
    principal: PRINCIPAL,
    interestRate: INTEREST_RATE,
    ...SCHEDULE,
    gracePeriodS: 60,
    allowOverpayment: true,
    originationFee,
    data: "xrlp:spike-xrpl04",
    borrowerSig: { single: w.spv },
  };

  await waitForLedgerTimeAfter(dates.subscriptionDate, (s) => process.stdout.write(`\r  waiting for Investment phase ~${s}s   `));
  process.stdout.write("\n");

  // Negative: cover below CoverRateMinimum x (DebtTotal + principal + interest). Spec: tecINSUFFICIENT_FUNDS.
  try {
    await spike.fails(`LoanSet with cover ${SHORT_COVER} < minimum ${coverMin}`, "tecINSUFFICIENT_FUNDS", () => loanSet(loanParams));
  } catch (e) {
    if (!(e instanceof XrplTxError)) throw e;
    spike.note(`insufficient-cover LoanSet returned ${e.engineResult}, not tecINSUFFICIENT_FUNDS`);
  }

  const topUp = fromMicro(toMicro(cover) - toMicro(SHORT_COVER));
  await spike.ok(`LoanBrokerCoverDeposit +${topUp} (total ${cover} = minimum + 10% headroom)`, () => depositBrokerCover(w.platform, broker.loanBrokerId, issuer, topUp));

  const spvBefore = await rlusdBalance(w.spv.classicAddress, issuer);
  const platformBefore = await rlusdBalance(w.platform.classicAddress, issuer);
  const loan = await loanSet(loanParams);
  spike.rows.push({ step: `LoanSet ${PRINCIPAL} @10%, 2 x 15d, LoanOriginationFee ${originationFee} (single-key SPV)`, result: loan.tx.result, hash: loan.tx.hash });
  spike.log(`  ✔ LoanSet ${loan.tx.explorerUrl}`);

  const entry = await getLoan(loan.loanId);
  const brokerAfter = await getLedgerEntry<LoanBrokerEntry>(broker.loanBrokerId);
  const vaultAfter = await getVault(vault.vaultId);
  const spvAfter = await rlusdBalance(w.spv.classicAddress, issuer);
  const platformAfter = await rlusdBalance(w.platform.classicAddress, issuer);
  spike.note(`SPV RLUSD ${spvBefore} -> ${spvAfter} (principal ${PRINCIPAL} - origination ${originationFee}); platform ${platformBefore} -> ${platformAfter}`);
  spike.note(`Loan ${loan.loanId}: PrincipalOutstanding=${entry?.PrincipalOutstanding} TotalValueOutstanding=${entry?.TotalValueOutstanding} PeriodicPayment=${entry?.PeriodicPayment} ManagementFeeOutstanding=${entry?.ManagementFeeOutstanding}`);
  spike.note(`Broker DebtTotal=${brokerAfter?.DebtTotal} CoverAvailable=${brokerAfter?.CoverAvailable}; Vault AssetsTotal=${vaultAfter?.AssetsTotal} AssetsAvailable=${vaultAfter?.AssetsAvailable ?? "0"}`);

  spike.print();
  console.log(`\nrun record: ${spike.save({ vaultId: vault.vaultId, loanBrokerId: broker.loanBrokerId, loanId: loan.loanId, loan: entry, broker: brokerAfter, vault: vaultAfter })}`);
} catch (e) {
  spike.print();
  console.error(`\nrun record: ${spike.save({ error: String(e) })}`);
  throw e;
} finally {
  await disconnect();
}
