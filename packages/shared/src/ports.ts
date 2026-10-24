// Ports = what core needs from the outside world (docs/05-api.md §3). Adapters:
//   LedgerPort   <- packages/xrpl/src/adapter.ts     (@Jalil-g)
//   VerifierPort <- packages/verifier/src/adapter.ts (@elmir132)
// Core runs on its own fakes until they land. Changing this file = contract PR reviewed by every consumer.
import type { LoanSnapshot, VaultSnapshot } from "./api.ts";
import type { BuilderDocument } from "./api.ts";
import type { Builder, ChainEventKind, Inspector, Milestone, Project, Rlusd, SovLine, XrplAddress } from "./domain.ts";
import type { Evidence, InspectorAssignment, InspectorAudit, ProjectVerification, ReleasePolicy, Verdict } from "./verdict.ts";

/** Hex string (conditions, fulfillments, blobs). */
export type Hex = string;
/** ISO-8601 timestamp. */
export type ISO = string;

/** One validated transaction. Adapters don't know project context: core turns these into ChainEvents. */
export interface TxResult {
  hash: string;
  explorerUrl: string;
  /** Engine result, e.g. "tesSUCCESS". Methods throw LedgerError for anything else unless documented. */
  result: string;
  /** Suggested ChainEvent kind for this tx, so core can label composite results. */
  kind?: ChainEventKind;
  /** Ledger close time (ISO). */
  at?: ISO;
}

/** Thrown by LedgerPort for failed/refused transactions. */
export class LedgerError extends Error {
  readonly code: "too_soon" | "ledger_error" | "unsafe_release";
  readonly txResult?: string;
  readonly txHash?: string;
  constructor(code: LedgerError["code"], message: string, opts: { txResult?: string; txHash?: string } = {}) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
    this.txResult = opts.txResult;
    this.txHash = opts.txHash;
  }
}

/** Vault phase gate not reached (tecTOO_SOON): LoanSet before SubscriptionDate, withdraw before RedemptionDate. */
export class TooSoonError extends LedgerError {
  constructor(message: string, opts: { txResult?: string; txHash?: string } = {}) {
    super("too_soon", message, opts);
    this.name = "TooSoonError";
  }
}

export type CredentialType = "VERIFIED_BUILDER" | "VERIFIED_INSPECTOR" | "KYC_INVESTOR";
export type AttestSigner = "aiAgent" | "platform" | "releaseService";

/** Memo type `xrlp/attest/v1`, JSON-encoded in the attestation tx. */
export interface AttestMemo {
  v: 1;
  kind: "audit" | "verdict" | "decision" | "release";
  milestoneId: string;
  /** sha256 of the attested object (audit, verdictHash, decision reason). */
  hash: string;
  decision?: string;
  reason?: string;
}

export interface ProjectChainSetup {
  spv: XrplAddress;
  vaultId: string;
  loanBrokerId: string;
  shareMptIssuanceId: string;
  subscriptionDate: ISO;
  redemptionDate: ISO;
  /** SPV funding + SignerListSet + disable master, VaultCreate, LoanBrokerSet, LoanBrokerCoverDeposit, ... */
  txs: TxResult[];
}

export interface EscrowRef {
  milestoneId: string;
  owner: XrplAddress; // SPV
  offerSequence: number;
  condition: Hex;
  cancelAfter: ISO;
  createTx: string;
}

export interface CloseResult {
  loanId: string;
  /** One per milestone, in project.milestones order. */
  escrows: EscrowRef[];
  /** LoanSet + one EscrowCreate per milestone. */
  txs: TxResult[];
}

export interface EscrowSnapshot {
  owner: XrplAddress;
  offerSequence: number;
  destination: XrplAddress;
  amount: Rlusd;
  condition?: Hex;
  cancelAfter?: ISO;
}

export interface LedgerPort {
  readonly mode: "fake" | "devnet";

  // onboarding / compliance
  /** builder -> platform RLUSD Payment (verification fee). */
  payVerificationFee(p: { builder: XrplAddress; amount: Rlusd }): Promise<TxResult>;
  /** CredentialCreate (platform) + CredentialAccept (subject). */
  issueCredential(p: { subject: XrplAddress; type: CredentialType }): Promise<TxResult[]>;

  // project setup
  /** Closed-ended private vault (SubscriptionDate/RedemptionDate, AssetsMaximum = principal) + LoanBroker (cover rates) +
   *  LoanBrokerCoverDeposit + SPV (SignerList platform/builder/inspector/trustee, quorum 3, master disabled). */
  setupProjectOnChain(p: {
    project: Project;
    builder: Builder;
    inspectors: XrplAddress[];
    subscriptionDate: ISO;
    redemptionDate: ISO;
    coverDeposit?: Rlusd;
  }): Promise<ProjectChainSetup>;
  /** VaultDeposit during Subscription. */
  deposit(p: { project: Project; investor: XrplAddress; amount: Rlusd }): Promise<TxResult>;
  /** VaultWithdraw. Throws TooSoonError before RedemptionDate. */
  withdraw(p: { project: Project; investor: XrplAddress; amount: Rlusd }): Promise<TxResult>;
  /** LoanSet (platform Account, SPV multisig Counterparty) then EscrowCreate x N back to back.
   *  `conditions[i]` / `cancelAfters[i]` belong to project.milestones[i]. Throws TooSoonError before SubscriptionDate;
   *  rejects duplicate conditions and any CancelAfter not before loan maturity. */
  closeLoanAndCreateEscrows(p: { project: Project; builder: Builder; conditions: Hex[]; cancelAfters: ISO[] }): Promise<CloseResult>;

  // release path
  /** Pre-reveal safety: escrow exists and is open, CancelAfter not passed (with margin), destination has an RLUSD trust line.
   *  Core MUST call this before finishEscrow: a failed finish publishes the preimage while the escrow stays open. */
  preflightFinish(p: { owner: XrplAddress; offerSequence: number; destination: XrplAddress }): Promise<{ ok: boolean; reason?: string }>;
  /** EscrowFinish submitted by releaseService. */
  finishEscrow(p: { owner: XrplAddress; offerSequence: number; condition: Hex; fulfillment: Hex }): Promise<TxResult>;
  /** Demo route 23 only: EscrowFinish from platform with a WRONG fulfillment. Resolves (does not throw) with the tec result. */
  tryFinishWithWrongFulfillment(p: { owner: XrplAddress; offerSequence: number; condition: Hex }): Promise<TxResult>;
  /** EscrowCancel after CancelAfter (anyone may submit). */
  cancelEscrow(p: { owner: XrplAddress; offerSequence: number }): Promise<TxResult>;
  /** LoanPay from the SPV (multisig). "escrow_refund" = money returned by a cancelled escrow. */
  repayLoan(p: { project: Project; amount: Rlusd; source: "builder" | "escrow_refund" }): Promise<TxResult>;
  /** Memo attestation tx (`xrlp/attest/v1`) signed by a platform-held key, sent to the SPV. */
  attest(p: { signer: AttestSigner; spv: XrplAddress; memo: AttestMemo }): Promise<TxResult>;
  /** Submit an attestation the inspector app signed itself (attest-signer SoftwareSigner). */
  submitSignedBlob(blob: Hex): Promise<TxResult>;

  // reads
  getVaultSnapshot(p: { vaultId: string }): Promise<VaultSnapshot>;
  getLoanSnapshot(p: { loanId: string }): Promise<LoanSnapshot>;
  getEscrow(owner: XrplAddress, offerSequence: number): Promise<EscrowSnapshot | null>;
  getBalance(account: XrplAddress, currency: "XRP" | "RLUSD"): Promise<string>;
}

export interface VerifyProjectInput {
  project: Project;
  builder: Builder;
  sov: SovLine[];
  documents: BuilderDocument[];
}

export interface VerifyMilestoneInput {
  project: Project;
  builder: Builder;
  milestone: Milestone;
  /** SoV lines this milestone pays for (milestone.sovCodes). */
  sov: SovLine[];
  /** Builder evidence for the current round. */
  evidence: Evidence[];
  /** Signed audits for this milestone (inspector_audit_present / audit_checklist_complete / audit_matches_evidence). */
  audits: InspectorAudit[];
  /** Earlier evidence from ALL projects (cross-project duplicate detection). */
  priorEvidence: Evidence[];
  /** EscrowCreate time; photos taken before it are suspicious. */
  escrowCreatedAt?: ISO;
  policy: ReleasePolicy;
}

export interface VerifierPort {
  readonly mode: "fake" | "mock" | "live";
  verifyProject(input: VerifyProjectInput): Promise<ProjectVerification>;
  assignInspector(input: { project: Project; panel: Inspector[]; count: 1 | 2 }): Promise<InspectorAssignment>;
  verifyMilestone(input: VerifyMilestoneInput): Promise<Verdict>;
  /** Pure + synchronous. */
  policyFor(project: Project, milestone: Milestone): ReleasePolicy;
  /** Canonical sha256 hex of a verdict (what gets attested). */
  verdictHash(v: Verdict): string;
}
