// @xrlp/xrpl — public API. See packages/xrpl/API.md.

// High-level (what @xrlp/core should call)
export {
  bootstrapWallets,
  setupProjectOnChain,
  lockSpvAccount,
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
export type { WalletRole, DemoWallets } from "./wallets.ts";
export { rlusdBalance, rlusdAmount, issueRlusd, payRlusd } from "./rlusd.ts";
export { getVault, vaultPhase } from "./vault.ts";
export type { VaultLedgerEntry, VaultPhase } from "./vault.ts";
export { getSpvInfo, multisignAndSubmit, SPV_QUORUM } from "./spv.ts";
export type { SpvInfo } from "./spv.ts";
export { listEscrows } from "./escrow.ts";
export { decodeAttestation, sha256Hex, ATTESTATION_MEMO_TYPE } from "./attest.ts";
export type { AttestationPayload } from "./attest.ts";
export { credentialStatus } from "./credentials.ts";
export type { CredentialType } from "./credentials.ts";
export { toChainEvent } from "./events.ts";

// XRPL-08: fee, credentials x3, permissioned domain, private vault, attestations (xrlp/attest/v1)
export { payVerificationFee, grantCredential, createDomain, attest, submitSignedBlob, ATTEST_EVENT_KIND, VERIFICATION_FEE_RLUSD } from "./compliance.ts";
export {
  ATTEST_MEMO_TYPE,
  ATTEST_KINDS,
  validateAttestMemo,
  encodeAttestMemo,
  decodeAttestMemo,
  decodeAnyAttestation,
  buildAttestTx,
  prepareAttestTx,
  verifyAttestBlob,
} from "./attest.ts";
export type { AttestMemo, AttestKind, VerifiedAttestBlob } from "./attest.ts";
export { CREDENTIAL_TYPES, credentialTypeHex, credentialTypeFromHex, ensureCredential, ensureDomain, listDomains } from "./credentials.ts";
export type { CredentialStatus, PermissionedDomainEntry } from "./credentials.ts";
export { vaultPrivacyFields } from "./vault.ts";
