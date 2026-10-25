// XLS-66 Lending Protocol: LoanBroker, first-loss cover, LoanSet (dual-signed), LoanPay.
import {
  combineLoanSetCounterpartySigners,
  convertStringToHex,
  LoanPayFlags,
  LoanSetFlags,
  signLoanSetByCounterparty,
  type LoanPay,
  type LoanSet,
  type Wallet,
} from "xrpl";
import { createdNodeId, getClient, getLedgerEntry, signAndSubmit, submitBlob, withAccountLock, type TxResult } from "./client.ts";
import { COVER_RATE_LIQUIDATION, COVER_RATE_MINIMUM, fromMicro, MANAGEMENT_FEE_RATE, toMicro, validateBrokerRates } from "./lending-math.ts";
import { toPlainDecimal } from "./reads.ts";
import { rlusdAmount } from "./rlusd.ts";
import { submitMultisigned } from "./spv.ts";

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

/** Loan.Flags: created with tfLoanOverpayment (overpayments allowed). */
export const LSF_LOAN_OVERPAYMENT = 0x00040000;

export function loanPayFlags(mode: LoanPayMode = "regular"): number {
  return mode === "overpayment"
    ? LoanPayFlags.tfLoanOverpayment
    : mode === "full"
      ? LoanPayFlags.tfLoanFullPayment
      : mode === "late"
        ? LoanPayFlags.tfLoanLatePayment
        : 0;
}

/**
 * LoanPay from a multisig SPV borrower (v2 signers, any 3 of 4) via `submitMultisigned`: holds the SPV's per-account
 * lock across autofill -> multisign -> submit -> validation (XRPL-12), so it never races another SPV tx, re-signs on
 * transient failures, and checks the signers against the on-ledger SignerList first (a tef would never land).
 * `overpayment: true` = `mode: "overpayment"` (extra principal paydown; needs the loan's lsfLoanOverpayment).
 */
export async function loanPayMultisig(p: {
  borrower: string;
  loanId: string;
  issuer: string;
  amount: string;
  signers: Wallet[];
  mode?: LoanPayMode;
  overpayment?: boolean;
  checkQuorum?: boolean;
}): Promise<TxResult> {
  if (!p.signers.length) throw new Error("LoanPay: multisig needs at least one signer");
  const flags = loanPayFlags(p.overpayment ? "overpayment" : p.mode);
  const tx: LoanPay = {
    TransactionType: "LoanPay",
    Account: p.borrower,
    LoanID: p.loanId,
    Amount: rlusdAmount(p.issuer, p.amount),
    ...(flags ? { Flags: flags } : {}),
  };
  return submitMultisigned(tx, p.signers, { checkQuorum: p.checkQuorum !== false });
}

// ---------------------------------------------------------------- repayment planning (pure)

/** Client-side LoanPay amount/mode refusal (`code: "validation"`). Nothing was submitted. */
export class LoanPayAmountError extends Error {
  readonly code = "validation" as const;
  constructor(
    message: string,
    readonly minimum?: string,
    readonly maximum?: string,
  ) {
    super(message);
    this.name = "LoanPayAmountError";
  }
}

export interface LoanPayPlan {
  amount: string;
  mode: LoanPayMode;
  /** Smallest amount the ledger accepts now: min(one periodic payment + service fee, everything outstanding), rounded up. */
  minimum: string;
  /** Everything outstanding (TotalValueOutstanding + one service fee), rounded up. */
  outstanding: string;
  late: boolean;
  overpaymentAllowed: boolean;
}

/** Ledger decimal ("7500.017836764691587", "1e-7") -> micro-RLUSD, rounded UP. */
export function ceilMicro(v: string | undefined): bigint {
  if (v == null || v === "") return 0n;
  const plain = toPlainDecimal(v);
  if (plain.startsWith("-")) throw new Error(`negative amount ${v}`);
  const [i = "0", f = ""] = plain.split(".");
  const base = BigInt(i) * 1_000_000n + BigInt(f.slice(0, 6).padEnd(6, "0"));
  return /[1-9]/.test(f.slice(6)) ? base + 1n : base;
}

/**
 * Pure: amount + LoanPay mode for a repayment at ledger time `nowRipple`.
 * Mode (unless given): past NextPaymentDueDate -> "late"; `source: "escrow_refund"` above one periodic payment on a
 * loan with lsfLoanOverpayment -> "overpayment" (the excess pays principal down early); otherwise "regular".
 * Amount (default: one periodic payment) must be >= `minimum` (else the ledger says tecINSUFFICIENT_PAYMENT) and, for
 * non-"full" modes, <= `outstanding`. Throws LoanPayAmountError; `skipAmountCheck` only for negative spikes.
 */
export function planLoanPayment(p: {
  loan: Pick<LoanEntry, "PeriodicPayment" | "LoanServiceFee" | "TotalValueOutstanding" | "PaymentRemaining" | "NextPaymentDueDate" | "Flags">;
  nowRipple: number;
  amount?: string;
  source?: "builder" | "escrow_refund";
  mode?: LoanPayMode;
  skipAmountCheck?: boolean;
}): LoanPayPlan {
  const { loan } = p;
  const fee = ceilMicro(loan.LoanServiceFee);
  const totalValue = ceilMicro(loan.TotalValueOutstanding);
  if (!loan.PaymentRemaining || totalValue === 0n) throw new LoanPayAmountError("loan is fully repaid (PaymentRemaining 0)");
  const periodic = ceilMicro(loan.PeriodicPayment) + fee;
  const outstanding = totalValue + fee;
  const minimum = periodic < outstanding ? periodic : outstanding;
  const amount = p.amount ?? fromMicro(minimum);
  const amt = toMicro(amount);
  if (amt <= 0n) throw new LoanPayAmountError(`LoanPay amount must be > 0 (got ${amount})`);
  const late = loan.NextPaymentDueDate != null && p.nowRipple > loan.NextPaymentDueDate;
  const overpaymentAllowed = ((loan.Flags ?? 0) & LSF_LOAN_OVERPAYMENT) !== 0;
  const mode: LoanPayMode = p.mode ?? (late ? "late" : p.source === "escrow_refund" && overpaymentAllowed && amt > minimum ? "overpayment" : "regular");
  if (mode === "overpayment" && !overpaymentAllowed) throw new LoanPayAmountError("loan was not created with tfLoanOverpayment; overpayment is not allowed");
  if (!p.skipAmountCheck) {
    if (mode !== "full" && amt < minimum) {
      throw new LoanPayAmountError(`LoanPay ${amount} < one periodic payment ${fromMicro(minimum)} (the ledger would return tecINSUFFICIENT_PAYMENT)`, fromMicro(minimum));
    }
    if (mode !== "full" && amt > outstanding) {
      throw new LoanPayAmountError(`LoanPay ${amount} > everything outstanding ${fromMicro(outstanding)}; pay at most that, or use mode "full"`, fromMicro(minimum), fromMicro(outstanding));
    }
  }
  return { amount, mode, minimum: fromMicro(minimum), outstanding: fromMicro(outstanding), late, overpaymentAllowed };
}
