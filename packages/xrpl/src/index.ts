// @xrlp/xrpl — public API. See packages/xrpl/API.md.

// High-level (what @xrlp/core should call)
export {
  bootstrapWallets,
  setupProjectOnChain,
  lockSpvAccount,
  spvSignersFor,
  defaultSpvSignerWallets,
  depositToVault,
  withdrawFromVault,
  getVaultStatus,
  getShareBalance,
  closeLoanAndCreateEscrows,
  attestApproval,
  releaseMilestone,
  cancelExpiredMilestone,
  repayLoan,
  getLoan,
  issueCredential,
  walletAddress,
  PLATFORM_SCOPE,
} from "./api.ts";
export type {
  BootstrapOptions,
  SetupProjectOptions,
  ProjectChainSetup,
  CloseLoanOptions,
  CloseLoanResult,
  MilestoneEscrowInfo,
} from "./api.ts";

// Inspector-side, pure (no network): condition/fulfillment generation
export { generateMilestoneCondition, fulfillmentMatches, conditionFromPreimage, fulfillmentFromPreimage } from "./condition.ts";
export type { MilestoneCondition } from "./condition.ts";

// Low-level building blocks
export { getClient, disconnect, ledgerTime, waitForLedgerTimeAfter, signAndSubmit, submitBlob, XrplTxError } from "./client.ts";
export type { TxResult } from "./client.ts";
export { config, RLUSD_CURRENCY } from "./config.ts";
export { loadWallets, resolveWallet, WALLET_ROLES } from "./wallets.ts";
export { RLUSD_HOLDERS, LEGACY_ROLE_RENAMES, migrateWalletFile, rlusdTopUpPlan } from "./wallets.ts";
export type { WalletRole, DemoWallets } from "./wallets.ts";
export type { WalletFile, WalletFileMigration, StoredWallet, RlusdTarget } from "./wallets.ts";
export { rlusdBalance, rlusdAmount, issueRlusd, payRlusd } from "./rlusd.ts";
export { getVault, vaultPhase } from "./vault.ts";
export type { VaultLedgerEntry, VaultPhase } from "./vault.ts";
export { getSpvInfo, multisignAndSubmit, SPV_QUORUM } from "./spv.ts";
export { createSpv, lockSpv, submitMultisigned, multisignBlob, checkSignerQuorum, spvSignerEntries, SPV_SIGNER_WEIGHT } from "./spv.ts";
export type { SpvInfo } from "./spv.ts";
export type { SpvSigners, CreatedSpv, QuorumCheck } from "./spv.ts";
export { listEscrows } from "./escrow.ts";
export { decodeAttestation, sha256Hex, ATTESTATION_MEMO_TYPE } from "./attest.ts";
export type { AttestationPayload } from "./attest.ts";
export { credentialStatus } from "./credentials.ts";
export type { CredentialType } from "./credentials.ts";
export { toChainEvent } from "./events.ts";

// XRPL-09: read models (pure parsers over raw rippled JSON + thin validated-ledger fetches)
export {
  getVaultSnapshot,
  getLoanSnapshot,
  getEscrow,
  listEscrowsParsed,
  getBalance,
  hasRlusdTrustline,
  fetchVaultSnapshotRaw,
  parseVaultSnapshot,
  parseLoanSnapshot,
  parseEscrow,
  parseEscrowNode,
  parseEscrowList,
  parseRlusdTrustline,
  parseRlusdBalance,
  parseHasRlusdTrustline,
  parseXrpBalance,
  snapshotPhase,
  toRlusd,
  toPlainDecimal,
  divDecimal,
  dropsToXrpDecimal,
} from "./reads.ts";
export type { VaultSnapshot, LoanSnapshot, EscrowView, RlusdTrustline, VaultSnapshotRaw, RawResult } from "./reads.ts";
