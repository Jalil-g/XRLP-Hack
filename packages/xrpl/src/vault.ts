// XLS-65 Single Asset Vault. On devnet LendingProtocolV1_1 is enabled, so a vault that backs a
// LoanBroker MUST be closed-ended: Subscription (deposits) -> Investment (LoanSet, no withdrawals)
// -> Redemption (withdrawals). Phase is derived from the parent ledger close time.
import { TooSoonError } from "@xrlp/shared";
import { convertStringToHex, rippleTimeToISOTime, VaultCreateFlags, type Wallet } from "xrpl";
import { createdNodeId, getClient, isNotFound, getLedgerEntry, signAndSubmit, XrplTxError, type TxResult } from "./client.ts";
import { validateVaultDates, type LoanSchedule } from "./lending-math.ts";
import { rlusdAmount, rlusdAsset } from "./rlusd.ts";

export const VAULT_KIND_CLOSED_ENDED = 1;
export { MIN_INVESTMENT_PERIOD_S, vaultDatesFor, validateVaultDates } from "./lending-math.ts";

export interface VaultLedgerEntry {
  index: string;
  Owner: string;
  Account: string; // pseudo-account
  Asset: { currency: string; issuer: string };
  AssetsTotal?: string;
  AssetsAvailable?: string;
  LossUnrealized?: string;
  ShareMPTID: string;
  VaultKind?: number;
  SubscriptionDate?: number;
  RedemptionDate?: number;
  [k: string]: unknown;
}

export interface CreateVaultParams {
  owner: Wallet;
  issuer: string;
  /** Ripple-epoch seconds: last second deposits are accepted. */
  subscriptionDate: number;
  /** Ripple-epoch seconds: first second withdrawals are allowed again. */
  redemptionDate: number;
  /** Optional cap on total assets (RLUSD). */
  assetsMaximum?: string;
  /** Short label stored in Vault.Data (<=256 bytes). */
  data?: string;
  /**
   * The loan schedule this vault will back. If given, RedemptionDate is checked to fit
   * SubscriptionDate + PaymentInterval x PaymentTotal + 60 + LoanSet window (else LoanSet -> tecNO_PERMISSION later).
   */
  loanSchedule?: LoanSchedule;
  /** Slack after SubscriptionDate for the LoanSet to land (default MIN_LOANSET_WINDOW_S = 60). */
  minLoanSetWindowS?: number;
  /** XRPL-08: private vault gated by this PermissionedDomain (sets tfVaultPrivate + DomainID). Only domain members (and the owner) can deposit. */
  domainId?: string;
  /** XRPL-08: tfVaultShareNonTransferable (no secondary market for shares). */
  nonTransferableShares?: boolean;
}

export interface CreateVaultResult {
  tx: TxResult;
  vaultId: string;
  shareMptIssuanceId: string;
  pseudoAccount: string;
}

export async function createVault(p: CreateVaultParams): Promise<CreateVaultResult> {
  validateVaultDates({ subscriptionDate: p.subscriptionDate, redemptionDate: p.redemptionDate, ...p.loanSchedule, minLoanSetWindowS: p.minLoanSetWindowS });
  const tx = await signAndSubmit(p.owner, {
    TransactionType: "VaultCreate",
    Account: p.owner.classicAddress,
    Asset: rlusdAsset(p.issuer),
    VaultKind: VAULT_KIND_CLOSED_ENDED,
    SubscriptionDate: p.subscriptionDate,
    RedemptionDate: p.redemptionDate,
    ...(p.assetsMaximum ? { AssetsMaximum: p.assetsMaximum } : {}),
    ...(p.data ? { Data: convertStringToHex(p.data.slice(0, 200)) } : {}),
    ...vaultPrivacyFields(p),
  });
  const vaultId = createdNodeId(tx, "Vault");
  if (!vaultId) throw new Error(`VaultCreate ${tx.hash}: no Vault node in metadata`);
  const vault = await getVault(vaultId);
  if (!vault) throw new Error(`Vault ${vaultId} not found after create`);
  return { tx, vaultId, shareMptIssuanceId: vault.ShareMPTID, pseudoAccount: vault.Account };
}

/** XRPL-08: Flags/DomainID for a private (domain-gated) and/or non-transferable-share vault. */
export function vaultPrivacyFields(p: Pick<CreateVaultParams, "domainId" | "nonTransferableShares">): { Flags?: number; DomainID?: string } {
  const flags = (p.domainId ? VaultCreateFlags.tfVaultPrivate : 0) | (p.nonTransferableShares ? VaultCreateFlags.tfVaultShareNonTransferable : 0);
  return { ...(flags ? { Flags: flags } : {}), ...(p.domainId ? { DomainID: p.domainId } : {}) };
}

export async function getVault(vaultId: string): Promise<VaultLedgerEntry | undefined> {
  return getLedgerEntry<VaultLedgerEntry>(vaultId);
}

export async function depositToVaultTx(investor: Wallet, vaultId: string, issuer: string, amount: string): Promise<TxResult> {
  return signAndSubmit(investor, {
    TransactionType: "VaultDeposit",
    Account: investor.classicAddress,
    VaultID: vaultId,
    Amount: rlusdAmount(issuer, amount),
  });
}

/**
 * Withdraw `amount` RLUSD worth of assets (burns the corresponding shares). Closed-ended vaults only allow this in
 * Subscription or Redemption; an on-ledger `tecTOO_SOON` (Investment phase) is rethrown as shared `TooSoonError`.
 * Use `withdrawPhaseCheck` first to refuse without submitting (api.ts `withdrawFromVault` does).
 */
export async function withdrawFromVaultTx(investor: Wallet, vaultId: string, issuer: string, amount: string): Promise<TxResult> {
  try {
    return await signAndSubmit(investor, {
      TransactionType: "VaultWithdraw",
      Account: investor.classicAddress,
      VaultID: vaultId,
      Amount: rlusdAmount(issuer, amount),
    });
  } catch (e) {
    if (e instanceof XrplTxError && e.engineResult === "tecTOO_SOON") {
      throw new TooSoonError(`VaultWithdraw before RedemptionDate (${e.explorerUrl ?? "on-ledger"})`, { txResult: e.engineResult, ...(e.hash ? { txHash: e.hash } : {}) });
    }
    throw e;
  }
}

/**
 * Pure: may `VaultWithdraw` succeed at ledger time `nowRipple`? Closed-ended vaults block withdrawals in the
 * Investment phase (SubscriptionDate < now < RedemptionDate -> tecTOO_SOON); Subscription, Redemption and open
 * vaults allow them.
 */
export function withdrawPhaseCheck(v: VaultLedgerEntry, nowRipple: number): { ok: true; phase: VaultPhase } | { ok: false; phase: "investment"; secondsLeft: number; message: string } {
  const phase = vaultPhase(v, nowRipple);
  if (phase !== "investment") return { ok: true, phase };
  const secondsLeft = v.RedemptionDate! - nowRipple;
  return {
    ok: false,
    phase,
    secondsLeft,
    message: `vault ${v.index} is in its Investment phase: withdrawals reopen at RedemptionDate ${rippleTimeToISOTime(v.RedemptionDate!)} (ledger time, ${secondsLeft}s to go)`,
  };
}

/** Raw share (MPT) balance of `holder` for the vault's share issuance, as an integer string. */
export async function getShareBalance(holder: string, shareMptIssuanceId: string): Promise<string> {
  const client = await getClient();
  try {
    const res = (await client.request({
      command: "ledger_entry",
      mptoken: { mpt_issuance_id: shareMptIssuanceId, account: holder },
      ledger_index: "validated",
    } as Parameters<typeof client.request>[0])) as { result: unknown };
    const node = (res.result as { node?: { MPTAmount?: string } }).node;
    return node?.MPTAmount ?? "0";
  } catch (e) {
    if (isNotFound(e)) return "0";
    throw e;
  }
}

export type VaultPhase = "open" | "subscription" | "investment" | "redemption";

export function vaultPhase(v: VaultLedgerEntry, nowRipple: number): VaultPhase {
  if (v.VaultKind !== VAULT_KIND_CLOSED_ENDED || v.SubscriptionDate == null || v.RedemptionDate == null) return "open";
  if (nowRipple <= v.SubscriptionDate) return "subscription";
  if (nowRipple < v.RedemptionDate) return "investment";
  return "redemption";
}
