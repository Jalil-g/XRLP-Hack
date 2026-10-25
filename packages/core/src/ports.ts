// Ports now live in the shared contract (packages/shared/src/ports.ts, docs/05-api.md §3). Re-exported for core callers.
export type {
  AttestMemo,
  AttestSigner,
  CloseResult,
  CredentialType,
  EscrowRef,
  EscrowSnapshot,
  LedgerPort,
  ProjectChainSetup,
  TxResult,
  VerifierPort,
  VerifyMilestoneInput,
  VerifyProjectInput,
} from "@xrlp/shared";
export { LedgerError, TooSoonError } from "@xrlp/shared";

/** ChainEvent.projectId for events not tied to a project (credentials, KYC). */
export const PLATFORM_SCOPE = "_platform";
