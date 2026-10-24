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
import { createdNodeId, getClient, getLedgerEntry, signAndSubmit, submitBlob, type TxResult } from "./client.ts";
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
  /** 1/10 bps of DebtTotal that first-loss capital must cover (0 = none). Paired with coverRateLiquidation. */
  coverRateMinimum?: number;
  coverRateLiquidation?: number;
  managementFeeRate?: number;
  debtMaximum?: string;
  data?: string;
}

export async function createLoanBroker(p: CreateLoanBrokerParams): Promise<{ tx: TxResult; loanBrokerId: string; pseudoAccount: string }> {
  const tx = await signAndSubmit(p.owner, {
    TransactionType: "LoanBrokerSet",
    Account: p.owner.classicAddress,
    VaultID: p.vaultId,
    ...(p.coverRateMinimum ? { CoverRateMinimum: p.coverRateMinimum, CoverRateLiquidation: p.coverRateLiquidation ?? p.coverRateMinimum } : {}),
    ...(p.managementFeeRate ? { ManagementFeeRate: p.managementFeeRate } : {}),
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
 */
export async function loanSet(p: LoanSetParams): Promise<{ tx: TxResult; loanId: string }> {
  const client = await getClient();
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
    ...(p.data ? { Data: convertStringToHex(p.data.slice(0, 200)) } : {}),
  };
  const prepared = await client.autofill(base);
  const firstSigned = p.brokerOwner.sign(prepared);
  let blob: string;
  if ("multisig" in p.borrowerSig) {
    const parts = p.borrowerSig.multisig.map((w) => signLoanSetByCounterparty(w, firstSigned.tx_blob, { multisign: true }).tx);
    blob = combineLoanSetCounterpartySigners(parts).tx_blob;
  } else {
    blob = signLoanSetByCounterparty(p.borrowerSig.single, firstSigned.tx_blob).tx_blob;
  }
  const tx = await submitBlob(blob, "LoanSet");
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
