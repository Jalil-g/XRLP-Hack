// XLS-65 Single Asset Vault. On devnet LendingProtocolV1_1 is enabled, so a vault that backs a
// LoanBroker MUST be closed-ended: Subscription (deposits) -> Investment (LoanSet, no withdrawals)
// -> Redemption (withdrawals). Phase is derived from the parent ledger close time.
import { convertStringToHex, type Wallet } from "xrpl";
import { createdNodeId, getClient, isNotFound, getLedgerEntry, signAndSubmit, type TxResult } from "./client.ts";
import { rlusdAmount, rlusdAsset } from "./rlusd.ts";

export const VAULT_KIND_CLOSED_ENDED = 1;
/** Spec minimum: RedemptionDate - SubscriptionDate >= 180s. */
export const MIN_INVESTMENT_PERIOD_S = 180;

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
}

export interface CreateVaultResult {
  tx: TxResult;
  vaultId: string;
  shareMptIssuanceId: string;
  pseudoAccount: string;
}

export async function createVault(p: CreateVaultParams): Promise<CreateVaultResult> {
  if (p.redemptionDate - p.subscriptionDate < MIN_INVESTMENT_PERIOD_S) {
    throw new Error(`RedemptionDate must be >= SubscriptionDate + ${MIN_INVESTMENT_PERIOD_S}s`);
  }
  const tx = await signAndSubmit(p.owner, {
    TransactionType: "VaultCreate",
    Account: p.owner.classicAddress,
    Asset: rlusdAsset(p.issuer),
    VaultKind: VAULT_KIND_CLOSED_ENDED,
    SubscriptionDate: p.subscriptionDate,
    RedemptionDate: p.redemptionDate,
    ...(p.assetsMaximum ? { AssetsMaximum: p.assetsMaximum } : {}),
    ...(p.data ? { Data: convertStringToHex(p.data.slice(0, 200)) } : {}),
  });
  const vaultId = createdNodeId(tx, "Vault");
  if (!vaultId) throw new Error(`VaultCreate ${tx.hash}: no Vault node in metadata`);
  const vault = await getVault(vaultId);
  if (!vault) throw new Error(`Vault ${vaultId} not found after create`);
  return { tx, vaultId, shareMptIssuanceId: vault.ShareMPTID, pseudoAccount: vault.Account };
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

/** Withdraw `amount` RLUSD worth of assets (burns the corresponding shares). Only in Redemption phase for closed-ended vaults. */
export async function withdrawFromVaultTx(investor: Wallet, vaultId: string, issuer: string, amount: string): Promise<TxResult> {
  return signAndSubmit(investor, {
    TransactionType: "VaultWithdraw",
    Account: investor.classicAddress,
    VaultID: vaultId,
    Amount: rlusdAmount(issuer, amount),
  });
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
