// v2 contract as the web consumes it (docs/05-api.md §2, CORE-01 #53).
// packages/shared on main is still v1. Until CORE-01 merges, the v2 shapes are mirrored here; when it merges, replace each
// declaration with a re-export from @xrlp/shared and fix the diffs. Nothing in apps/web should import v1 domain types
// (Project, Milestone, ChainEvent, Attestation) from @xrlp/shared directly — import from here.
//   ASSUMED  = not spelled out in 05-api; kept as close to v1 as possible.
//   PROPOSED = asked for on #53; optional so the UI degrades when core doesn't send it.
import type {
  Builder,
  CheckResult,
  Evidence,
  EvidenceKind,
  LoanTerms,
  ProjectType,
  RiskTier,
  Rlusd,
  Verdict,
  XrplAddress,
} from "@xrlp/shared";

export type { Builder, CheckResult, Evidence, EvidenceKind, LoanTerms, ProjectType, RiskTier, Rlusd, Verdict, XrplAddress };

// ---------------------------------------------------------------- states (CORE-01)

export type ProjectStatus =
  | "draft"
  | "verifying"
  | "verified"
  | "rejected"
  | "terms_locked"
  | "funding"
  | "funded"
  | "escrowed"
  | "repaying"
  | "completed"
  | "stalled";

export type MilestoneStatus =
  | "pending"
  | "escrowed"
  | "evidence_submitted"
  | "audited"
  | "verified"
  | "failed"
  | "needs_human"
  | "released"
  | "expired"
  | "refunded";

// ---------------------------------------------------------------- Schedule of Values

export type EvidenceRequirement = { kind: EvidenceKind; description: string; minCount: number };

export type SovLine = {
  code: string;
  title: string;
  amount: Rlusd;
  trade: string;
  evidence: EvidenceRequirement[];
  visualCriteria: string[];
};

// ---------------------------------------------------------------- project + milestones

export type Milestone = {
  id: string;
  index: number;
  title: string;
  amount: Rlusd;
  /** ASSUMED: SoV line codes this milestone draws on. */
  sovCodes: string[];
  /** v1 name kept (05 calls it requiredAudits in ReleasePolicy). */
  requiredInspectors: number;
  status: MilestoneStatus;
  cancelAfter?: string;
  escrow?: {
    owner: XrplAddress;
    offerSequence: number;
    condition: string;
    createTx: string;
    finishTx?: string;
    cancelTx?: string;
  };
};

export type Project = {
  id: string;
  name: string;
  type: ProjectType;
  builderId: string;
  siteAddress: string;
  siteGeo: { lat: number; lng: number; radiusM: number };
  description: string;
  terms: LoanTerms;
  status: ProjectStatus;
  /** ASSUMED: the locked Schedule of Values. */
  sov: SovLine[];
  milestones: Milestone[];
  chain: {
    spv?: XrplAddress;
    vaultId?: string;
    loanBrokerId?: string;
    loanId?: string;
    shareMptIssuanceId?: string;
  };
};

export type Investment = { projectId: string; investor: XrplAddress; amount: Rlusd; tx: string; at: string };

// ---------------------------------------------------------------- people

/** ASSUMED shape (CORE-01 lists `Inspector` without fields). */
export type Inspector = {
  address: XrplAddress;
  name: string;
  licence: string;
  firm: string;
  region: string;
  trades: string[];
  credentialTx?: string;
};

export type PartyRole = "investor" | "builder" | "inspector" | "platform" | "release_service" | "ai_agent" | "trustee" | "spv";

/** PROPOSED (#53): GET /api/admin/demo/parties — demo identities for the role switcher, `actor` fields and display names. */
export type Party = { address: XrplAddress; name: string; role: PartyRole; detail?: string; kyc?: boolean };

// ---------------------------------------------------------------- on-chain record

export type ChainEventKind =
  // v1
  | "credential_issued"
  | "vault_created"
  | "vault_deposit"
  | "loan_broker_created"
  | "loan_set"
  | "escrow_created"
  | "approval_attested"
  | "escrow_finished"
  | "escrow_cancelled"
  | "loan_payment"
  | "vault_withdraw"
  // v2 (CORE-01)
  | "verification_fee_paid"
  | "project_verified"
  | "inspector_assigned"
  | "audit_attested"
  | "verdict_attested"
  | "decision_attested"
  | "cover_deposited"
  | "credential_accepted"
  | "loan_default"
  | "release_refused";

export type ChainEvent = {
  projectId: string;
  milestoneId?: string;
  kind: ChainEventKind;
  txHash: string;
  explorerUrl: string;
  actor?: XrplAddress;
  amount?: Rlusd;
  at: string;
};

export type Attestation = {
  milestoneId: string;
  role: "inspector" | "ai_agent" | "platform" | "release_service";
  /** PROPOSED: memo kind, so the UI can find the audit / verdict / decision / release attestation for a milestone. */
  kind?: "audit" | "verdict" | "decision" | "release";
  /** PROPOSED: the attested hash (audit hash, verdictHash). */
  hash?: string;
  signer: XrplAddress;
  decision: "approve" | "reject";
  notes: string;
  txHash?: string;
  at: string;
};

// ---------------------------------------------------------------- verification, audits, checks

export type ProjectVerification = {
  identity: CheckResult[];
  feasibility: CheckResult[];
  capability: CheckResult[];
  decision: "pass" | "fail" | "needs_human";
  riskTier: RiskTier;
  summary: string;
  model: string;
  createdAt: string;
};

export type InspectorAssignment = { inspectors: XrplAddress[]; scores: Record<XrplAddress, number>; reasons: string[] };

export type AuditChecklistLine = { sovCode: string; status: "done" | "partial" | "not_done"; note?: string };

export type InspectorAudit = {
  milestoneId: string;
  inspector: XrplAddress;
  evidenceBundleHash: string;
  checklist: AuditChecklistLine[];
  photos: Evidence[];
  notes: string;
  txHash?: string;
  at: string;
};

export type ChecksStatus = {
  required: CheckResult[];
  optional: CheckResult[];
  verdict?: Verdict;
  outcome: "pending" | "pass" | "fail" | "needs_human";
  /** PROPOSED: check names fixed at lock-terms, so the panel can list queued checks before the first run. */
  suite?: string[];
};

// ---------------------------------------------------------------- read models (05 §2)

export type VaultSnapshot = {
  assetsTotal: Rlusd;
  assetsAvailable: Rlusd;
  sharesOutstanding: string;
  sharePrice: string;
  subscriptionDate: string;
  redemptionDate: string;
  phase: "subscription" | "investment" | "redemption";
};

export type LoanSnapshot = {
  principalOutstanding: Rlusd;
  totalValueOutstanding: Rlusd;
  periodicPayment: Rlusd;
  paymentRemaining: number;
  nextPaymentDueDate: string;
};

export type ProjectSummary = Pick<Project, "id" | "name" | "type" | "status" | "siteAddress"> & {
  principal: Rlusd;
  raised: Rlusd;
  investorCount: number;
  builderName: string;
  fundingDeadline: string;
  verified: boolean;
  /** PROPOSED: card shows the rate (WEB-02). */
  interestRateBps?: number;
  /** PROPOSED: builder workspace filters by it. */
  builderId?: string;
  /** PROPOSED: builder credential badge on the card (WEB-02). */
  builderVerified?: boolean;
};

export type ProjectDetail = {
  project: Project;
  builder: Builder;
  verification?: ProjectVerification;
  inspectors: Inspector[];
  investments: Investment[];
  events: ChainEvent[];
  checks: Record<string, ChecksStatus>;
  audits: Record<string, InspectorAudit[]>;
  attestations: Record<string, Attestation[]>;
  vault?: VaultSnapshot;
  loan?: LoanSnapshot;
  /** PROPOSED: builder evidence per milestone (check rows show thumbnails; CheckResult only carries ids). */
  evidence?: Record<string, Evidence[]>;
  /** PROPOSED: live RLUSD balances for the money map (WEB-05) and "builder balance ticks" (demo beat 3). */
  balances?: { spv: Rlusd; builder: Rlusd };
};

export type InspectorTask = {
  projectId: string;
  projectName: string;
  milestone?: Milestone;
  sov: SovLine[];
  evidence: Evidence[];
  needs: "pre_visit" | "audit" | "re_audit" | "none";
  siteGeo: Project["siteGeo"];
  priorAudits: InspectorAudit[];
};

export type PortfolioPosition = {
  projectId: string;
  projectName: string;
  shares: string;
  value: Rlusd;
  phase: VaultSnapshot["phase"];
  redemptionDate: string;
};

// ---------------------------------------------------------------- inputs

/** ASSUMED shape. */
export type BuilderDocument = {
  kind: "licence" | "insurance" | "entity" | "permit" | "plans";
  filename: string;
  reference?: string;
};

export type CreateProjectInput = Pick<Project, "name" | "type" | "builderId" | "siteAddress" | "siteGeo" | "description"> & {
  terms: LoanTerms;
  sov: SovLine[];
  documents: BuilderDocument[];
};

/** Route 10 `report` part: the audit as built by the inspector (core fills txHash; photos travel as files). */
export type AuditReport = Omit<InspectorAudit, "photos" | "txHash">;

// ---------------------------------------------------------------- responses

export type TxRef = { txHash: string; explorerUrl: string };
export type WithEvents<T> = T & { events: ChainEvent[] };

export type PayFeeResult = WithEvents<{ project: Project }>;
export type VerifyProjectResult = WithEvents<{ verification: ProjectVerification; project: Project }>;
export type LockTermsResult = WithEvents<{ project: Project; assignment: InspectorAssignment }>;
export type InvestResult = WithEvents<{ investment: Investment }>;
export type CloseLoanResult = WithEvents<{ project: Project }>;
export type SubmitEvidenceResult = { milestone: Milestone; evidence: Evidence[] };
export type SubmitAuditResult = WithEvents<{ milestone: Milestone; audit: InspectorAudit }>;
export type RunChecksResult = WithEvents<{ verdict: Verdict; release?: TxRef }>;
export type DecisionResult = WithEvents<{ milestone: Milestone }>;
export type CancelResult = WithEvents<{ milestone: Milestone }>;
export type RepayResult = WithEvents<{ project: Project }>;
export type EventsOnly = { events: ChainEvent[] };
export type TryStealResult = TxRef & { result: "tecCRYPTOCONDITION_ERROR" };

// ---------------------------------------------------------------- errors

export type ErrorCode =
  | "not_found"
  | "invalid_state"
  | "validation"
  | "checks_failed"
  | "needs_human"
  | "too_soon"
  | "ledger_error"
  | "verifier_error"
  | "unsafe_release";

export type ApiErrorBody = { error: { code: ErrorCode; message: string; txResult?: string; txHash?: string } };
