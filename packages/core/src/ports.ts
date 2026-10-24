// Ports = what core needs from the outside world. @xrlp/xrpl and @xrlp/verifier ship adapters that
// implement these; until then core runs on src/fakes/*.
//
// TODO(adapters): when packages/xrpl + packages/verifier land, add thin adapters in src/adapters/
//   - src/adapters/xrpl-ledger.ts     implements LedgerPort   (wraps @xrlp/xrpl, devnet)
//   - src/adapters/claude-verifier.ts implements VerifierPort (wraps @xrlp/verifier, VERIFIER_MODE=mock|live)
// and select them in src/factory.ts via LEDGER_MODE=devnet / VERIFIER_MODE. Core code must not change.
import type {
  Attestation,
  Builder,
  ChainEvent,
  Evidence,
  Milestone,
  MilestoneTemplate,
  Project,
  RiskTier,
  Rlusd,
  Verdict,
  XrplAddress,
} from "@xrlp/shared";

/** ChainEvent.projectId for events not tied to a project (e.g. credentials). */
export const PLATFORM_SCOPE = "_platform";

export type CredentialType = "VERIFIED_BUILDER" | "KYC_INVESTOR";

export interface ProjectChainSetup {
  spv: XrplAddress;
  vaultId: string;
  loanBrokerId: string;
  shareMptIssuanceId: string;
  /** vault_created, loan_broker_created, ... (SPV account + SignerListSet may be included too) */
  events: ChainEvent[];
}

export interface MilestoneEscrow {
  milestoneId: string;
  owner: XrplAddress; // SPV
  offerSequence: number;
  condition: string; // hex PREIMAGE-SHA-256 condition
  createTx: string;
}

export interface LoanClosing {
  loanId: string;
  /** One per milestone, same order as project.milestones. */
  escrows: MilestoneEscrow[];
  /** loan_set + one escrow_created per milestone */
  events: ChainEvent[];
}

/**
 * All ledger effects. Every method that submits a tx returns the ChainEvent(s) for the audit timeline
 * (explorerUrl = explorerTxUrl(hash)). Adapters own wallets/keys/preimages; core passes addresses only.
 * Throwing = tx failed; core leaves state unchanged.
 */
export interface LedgerPort {
  readonly mode: "fake" | "devnet";

  /** Create SPV account (+SignerList: inspectors w2, aiAgent w1, platform w1, quorum 3), Vault, LoanBroker.
   *  Called when the project opens for funding (investors need the vault to deposit into). */
  setupProjectOnChain(input: { project: Project; builder: Builder; inspectors: XrplAddress[] }): Promise<ProjectChainSetup>;

  /** VaultDeposit by `investor`. Returns kind "vault_deposit". */
  depositToVault(input: { project: Project; investor: XrplAddress; amount: Rlusd }): Promise<ChainEvent>;

  /** LoanSet (principal -> SPV), then IMMEDIATELY (same step) one EscrowCreate per milestone
   *  (Destination = builder, Amount = milestone.amount, CancelAfter = milestone.cancelAfter — core sets it
   *  before calling, Condition = the inspector-supplied PREIMAGE-SHA-256 condition for that milestone). */
  closeLoanAndCreateEscrows(input: {
    project: Project;
    builder: Builder;
    conditions: { milestoneId: string; condition: string }[];
  }): Promise<LoanClosing>;

  /** Memo'd attestation tx signed by `signer`. Returns kind "approval_attested" (decision in memo). */
  attestApproval(input: {
    project: Project;
    milestone: Milestone;
    role: Attestation["role"];
    signer: XrplAddress;
    decision: Attestation["decision"];
    notes?: string;
    verdictHash?: string;
  }): Promise<ChainEvent>;

  /** EscrowFinish with `fulfillment` (hex PREIMAGE-SHA-256 fulfillment). The fulfillment is generated and
   *  held by the milestone's condition-holding INSPECTOR and handed over only at release time; core checks
   *  it matches milestone.escrow.condition and that quorum is met, then passes it through. NEVER persist it. */
  releaseMilestone(input: { project: Project; milestone: Milestone; fulfillment: string }): Promise<ChainEvent>;

  /** EscrowCancel after CancelAfter. Returns kind "escrow_cancelled" (funds back to SPV; core then calls
   *  repayLoan({source: "escrow_refund"}) so the SPV LoanPays it back into the vault). */
  cancelExpiredMilestone(input: { project: Project; milestone: Milestone }): Promise<ChainEvent>;

  /** LoanPay from the SPV. source "builder": builder paid SPV first; "escrow_refund": refunded escrow money. */
  repayLoan(input: { project: Project; amount: Rlusd; source: "builder" | "escrow_refund" }): Promise<ChainEvent>;

  /** VaultWithdraw by `investor`. Returns kind "vault_withdraw". */
  withdrawFromVault(input: { project: Project; investor: XrplAddress; amount: Rlusd }): Promise<ChainEvent>;

  /** CredentialCreate (+ accept) issued by platform. Return projectId = PLATFORM_SCOPE. */
  issueCredential(input: { subject: XrplAddress; type: CredentialType }): Promise<ChainEvent>;
}

export interface BuilderDocument {
  kind: "license" | "insurance" | "track_record" | "identity" | "other";
  filename: string;
  /** Path relative to DATA_DIR or data: URL. */
  uri?: string;
  /** Structured fields the (mock) data sources return, e.g. { licenseNumber, expires }. */
  fields?: Record<string, string>;
}

export interface BuilderVerification {
  ok: boolean;
  reasons: string[];
  /** Verifier may (re)assess risk tier from the docs. */
  riskTier?: RiskTier;
}

export interface MilestonePolicy {
  requiredInspectors: 1 | 2;
  riskTier: RiskTier;
  /** AI verdicts below this confidence should be "needs_human". */
  minConfidence: number;
}

export interface VerifyMilestoneInput {
  project: Project;
  builder: Builder;
  milestone: Milestone;
  template: MilestoneTemplate;
  /** Evidence for the current submission round. */
  evidence: Evidence[];
  /** All earlier evidence from this builder (other milestones, earlier rounds) — duplicate detection. */
  priorEvidence: Evidence[];
  /** When the milestone escrow was created (photos taken before this are suspicious). */
  escrowCreatedAt?: string;
}

export interface VerifierPort {
  readonly mode: "fake" | "mock" | "live";
  verifyMilestone(input: VerifyMilestoneInput): Promise<Verdict>;
  verifyBuilder(input: { builder: Builder; documents: BuilderDocument[] }): Promise<BuilderVerification>;
  /** Pure + synchronous: called at project creation to fix requiredInspectors per milestone. */
  policyFor(project: Project, builder: Builder, milestone: Milestone): MilestonePolicy;
}
