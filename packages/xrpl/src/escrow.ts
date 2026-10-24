// Milestone escrows: IOU (RLUSD) escrows owned by the SPV, payable only to the builder,
// gated by a PREIMAGE-SHA-256 condition, refundable to the SPV after CancelAfter.
import type { Wallet } from "xrpl";
import { getClient, signAndSubmit, type TxResult } from "./client.ts";
import { fulfillmentMatches } from "./condition.ts";
import { assertPreflightOk, preflightFinish } from "./preflight.ts";
import { rlusdAmount } from "./rlusd.ts";
import { multisignAndSubmit } from "./spv.ts";

export interface CreateEscrowParams {
  spv: string;
  builder: string;
  issuer: string;
  amount: string;
  /** Hex PREIMAGE-SHA-256 condition from the inspector (generateMilestoneCondition). */
  condition: string;
  /** Ripple-epoch seconds. Required for token escrows. */
  cancelAfter: number;
  /** SPV signers reaching quorum (e.g. inspectorA + aiAgent). */
  signers?: Wallet[];
  /** Fallback: SPV master key (only before the SPV is locked). */
  singleKey?: Wallet;
}

export interface CreatedEscrow {
  tx: TxResult;
  owner: string;
  /** Sequence of the EscrowCreate — needed for finish/cancel. */
  offerSequence: number;
}

export async function createMilestoneEscrow(p: CreateEscrowParams): Promise<CreatedEscrow> {
  const ec = {
    TransactionType: "EscrowCreate" as const,
    Account: p.spv,
    Destination: p.builder,
    Amount: rlusdAmount(p.issuer, p.amount),
    Condition: p.condition,
    CancelAfter: p.cancelAfter,
  };
  const tx = p.singleKey ? await signAndSubmit(p.singleKey, ec) : await multisignAndSubmit(ec, p.signers ?? []);
  const seq = Number(tx.tx.Sequence);
  return { tx, owner: p.spv, offerSequence: seq };
}

/**
 * EscrowFinish — anyone may submit; the fulfillment is the gate. `submitter` pays the fee.
 * Runs preflightFinish first (throws UnsafeReleaseError, nothing submitted) unless `skipPreflight`.
 */
export async function finishEscrow(p: { submitter: Wallet; owner: string; offerSequence: number; condition: string; fulfillment: string; skipPreflight?: boolean }): Promise<TxResult> {
  if (!fulfillmentMatches(p.condition, p.fulfillment)) throw new Error("fulfillment does not match escrow condition");
  const pf = p.skipPreflight ? undefined : await preflightFinish({ ...p, submitter: p.submitter.classicAddress });
  if (pf) assertPreflightOk(pf);
  return signAndSubmit(p.submitter, {
    ...(pf ? { Fee: pf.details.recommendedFee, LastLedgerSequence: pf.details.lastLedgerSequence } : {}),
    TransactionType: "EscrowFinish",
    Account: p.submitter.classicAddress,
    Owner: p.owner,
    OfferSequence: p.offerSequence,
    Condition: p.condition,
    Fulfillment: p.fulfillment,
  });
}

/** EscrowCancel — anyone may submit after CancelAfter; funds return to the owner (SPV). */
export async function cancelEscrow(p: { submitter: Wallet; owner: string; offerSequence: number }): Promise<TxResult> {
  return signAndSubmit(p.submitter, {
    TransactionType: "EscrowCancel",
    Account: p.submitter.classicAddress,
    Owner: p.owner,
    OfferSequence: p.offerSequence,
  });
}

export interface EscrowEntry {
  index: string;
  Account: string;
  Destination: string;
  Amount: unknown;
  Condition?: string;
  CancelAfter?: number;
  PreviousTxnID: string;
}

export async function listEscrows(owner: string): Promise<EscrowEntry[]> {
  const client = await getClient();
  const res = await client.request({ command: "account_objects", account: owner, type: "escrow", ledger_index: "validated" });
  return res.result.account_objects as unknown as EscrowEntry[];
}
