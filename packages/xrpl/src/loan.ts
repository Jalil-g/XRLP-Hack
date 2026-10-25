// XLS-66 Lending Protocol: LoanBroker, first-loss cover, LoanSet (dual-signed), LoanPay.
import {
  combineLoanSetCounterpartySigners,
  convertStringToHex,
  LoanPayFlags,
  LoanSetFlags,
  signLoanSetByCounterparty,
  type LoanSet,
  type Wallet,
} from "xrpl";
import { createdNodeId, getClient, getLedgerEntry, signAndSubmit, submitBlob, withAccountLock, type TxResult } from "./client.ts";
import { COVER_RATE_LIQUIDATION, COVER_RATE_MINIMUM, MANAGEMENT_FEE_RATE, validateBrokerRates } from "./lending-math.ts";
import { rlusdAmount } from "./rlusd.ts";
import { multisignAndSubmit } from "./spv.ts";

export interface LoanBrokerEntry {
  index: string;
  Owner: string;
  Account: string; // pseudo-account
  VaultID: string;
  DebtTotal?: string;
  CoverAvailable?: string;
  [k: string]: unknown;
}

export interface LoanEntry {
  index: string;
  Borrower: string;
  LoanBrokerID: string;
  PrincipalOutstanding?: string;
  TotalValueOutstanding?: string;
  PeriodicPayment?: string;
  PaymentRemaining?: number;
  NextPaymentDueDate?: number;
  PaymentInterval?: number;
  LoanServiceFee?: string;
  Flags?: number;
  [k: string]: unknown;
}

export interface CreateLoanBrokerParams {
  owner: Wallet; // must be the Vault owner
  vaultId: string;
  /** 1/10 bps of DebtTotal that first-loss cover must stay above. Default COVER_RATE_MINIMUM (10000 = 10%). */
  coverRateMinimum?: number;
  /** 1/10 bps of the minimum cover liquidated on default. Default COVER_RATE_LIQUIDATION (100000 = 100%). Both-zero or both-non-zero. */
  coverRateLiquidation?: number;
  /** 1/10 bps of interest paid to the broker owner. Default MANAGEMENT_FEE_RATE (10000 = 10%, protocol max). */
  managementFeeRate?: number;
  debtMaximum?: string;
  data?: string;
}

/** LoanBrokerSet (create) with Drawproof's rates: first-loss cover 10% / 100% and a management fee, unless overridden. */
export async function createLoanBroker(p: CreateLoanBrokerParams): Promise<{ tx: TxResult; loanBrokerId: string; pseudoAccount: string }> {
  const rates = validateBrokerRates({
    coverRateMinimum: p.coverRateMinimum ?? COVER_RATE_MINIMUM,
    coverRateLiquidation: p.coverRateLiquidation ?? COVER_RATE_LIQUIDATION,
    managementFeeRate: p.managementFeeRate ?? MANAGEMENT_FEE_RATE,
  });
  const tx = await signAndSubmit(p.owner, {
    TransactionType: "LoanBrokerSet",
    Account: p.owner.classicAddress,
    VaultID: p.vaultId,
    ...(rates.coverRateMinimum ? { CoverRateMinimum: rates.coverRateMinimum, CoverRateLiquidation: rates.coverRateLiquidation } : {}),
    ...(rates.managementFeeRate ? { ManagementFeeRate: rates.managementFeeRate } : {}),
    ...(p.debtMaximum ? { DebtMaximum: p.debtMaximum } : {}),
    ...(p.data ? { Data: convertStringToHex(p.data.slice(0, 200)) } : {}),
  });
  const loanBrokerId = createdNodeId(tx, "LoanBroker");
  if (!loanBrokerId) throw new Error(`LoanBrokerSet ${tx.hash}: no LoanBroker node in metadata`);
  const broker = await getLedgerEntry<LoanBrokerEntry>(loanBrokerId);
  return { tx, loanBrokerId, pseudoAccount: broker?.Account ?? "" };
}

/** Platform first-loss capital (RLUSD) into the broker's cover pool. */
export async function depositBrokerCover(owner: Wallet, loanBrokerId: string, issuer: string, amount: string): Promise<TxResult> {
  return signAndSubmit(owner, {
    TransactionType: "LoanBrokerCoverDeposit",
    Account: owner.classicAddress,
    LoanBrokerID: loanBrokerId,
    Amount: rlusdAmount(issuer, amount),
  });
}

export interface LoanSetParams {
  brokerOwner: Wallet;
  loanBrokerId: string;
  borrower: string;
  principal: string;
  /** Annual rate in 1/10 bps (10% = 10000). */
  interestRate: number;
  paymentTotal: number;
  paymentIntervalS: number;
  gracePeriodS?: number;
  /** Allow overpayments (early principal paydown) — needed for the stall path. */
  allowOverpayment?: boolean;
  /** RLUSD taken from the principal at LoanSet and paid to the broker owner (platform). */
  originationFee?: string;
  /** RLUSD added to every LoanPay, paid to the broker owner. */
  serviceFee?: string;
  /** Drops. Default: xrpl.js autofill (counts the borrower's SignerList entries for LoanSet). */
  fee?: string;
  data?: string;
  /**
   * How the borrower countersigns:
   *  - { multisig: Wallet[] }  borrower is a multisig SPV; these signers produce CounterpartySignature.Signers
   *  - { single: Wallet }      borrower signs with its own key
   */
  borrowerSig: { multisig: Wallet[] } | { single: Wallet };
}

/**
 * Broker-owner-initiated LoanSet: platform signs as Account with Counterparty = borrower,
 * then the borrower (SPV multisig quorum, or single key) fills CounterpartySignature.
 * Drawproof terms: PaymentTotal ≥ 2, InterestRate > 0, no late fees (LatePaymentFee / LateInterestRate never set).
 * autofill → sign → countersign → submit runs under the broker owner's account lock (XRPL-12), so no other tx from
 * the platform can take this Sequence in between.
 */
export async function loanSet(p: LoanSetParams): Promise<{ tx: TxResult; loanId: string }> {
  if (!Number.isInteger(p.paymentTotal) || p.paymentTotal < 2) throw new Error(`LoanSet: PaymentTotal must be an integer >= 2, got ${p.paymentTotal}`);
  if (!Number.isInteger(p.interestRate) || p.interestRate <= 0) throw new Error(`LoanSet: InterestRate must be a positive integer (1/10 bps), got ${p.interestRate}`);
  const base: LoanSet = {
    TransactionType: "LoanSet",
    Account: p.brokerOwner.classicAddress,
    LoanBrokerID: p.loanBrokerId,
    Counterparty: p.borrower,
    PrincipalRequested: p.principal,
    InterestRate: p.interestRate,
    PaymentTotal: p.paymentTotal,
    PaymentInterval: p.paymentIntervalS,
    GracePeriod: p.gracePeriodS ?? Math.min(p.paymentIntervalS, 60),
    ...(p.allowOverpayment ? { Flags: LoanSetFlags.tfLoanOverpayment } : {}),
    ...(p.originationFee ? { LoanOriginationFee: p.originationFee } : {}),
    ...(p.serviceFee ? { LoanServiceFee: p.serviceFee } : {}),
    ...(p.fee ? { Fee: p.fee } : {}),
    ...(p.data ? { Data: convertStringToHex(p.data.slice(0, 200)) } : {}),
  };
  const tx = await withAccountLock(p.brokerOwner.classicAddress, async () => {
    const client = await getClient();
    const prepared = await client.autofill(base);
    const firstSigned = p.brokerOwner.sign(prepared);
    let blob: string;
    if ("multisig" in p.borrowerSig) {
      const parts = p.borrowerSig.multisig.map((w) => signLoanSetByCounterparty(w, firstSigned.tx_blob, { multisign: true }).tx);
      blob = combineLoanSetCounterpartySigners(parts).tx_blob;
    } else {
      blob = signLoanSetByCounterparty(p.borrowerSig.single, firstSigned.tx_blob).tx_blob;
    }
    return submitBlob(blob, "LoanSet");
  });
  const loanId = createdNodeId(tx, "Loan");
  if (!loanId) throw new Error(`LoanSet ${tx.hash}: no Loan node in metadata`);
  return { tx, loanId };
}

export async function getLoan(loanId: string): Promise<LoanEntry | undefined> {
  return getLedgerEntry<LoanEntry>(loanId);
}

export type LoanPayMode = "regular" | "overpayment" | "full" | "late";

/** LoanPay from a multisig SPV borrower. */
export async function loanPayMultisig(p: {
  borrower: string;
  loanId: string;
  issuer: string;
  amount: string;
  signers: Wallet[];
  mode?: LoanPayMode;
}): Promise<TxResult> {
  const flags =
    p.mode === "overpayment"
      ? LoanPayFlags.tfLoanOverpayment
      : p.mode === "full"
        ? LoanPayFlags.tfLoanFullPayment
        : p.mode === "late"
          ? LoanPayFlags.tfLoanLatePayment
          : 0;
  return multisignAndSubmit(
    {
      TransactionType: "LoanPay",
      Account: p.borrower,
      LoanID: p.loanId,
      Amount: rlusdAmount(p.issuer, p.amount),
      ...(flags ? { Flags: flags } : {}),
    },
    p.signers,
  );
}
