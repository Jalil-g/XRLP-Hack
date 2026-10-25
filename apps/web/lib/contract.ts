// The contract as the web consumes it: @xrlp/shared v2 (CORE-01) plus the fields the web proposed on #53.
// Import contract types from here, not from @xrlp/shared directly, so the PROPOSED extensions stay in one place.
// PROPOSED fields are optional: the UI degrades when core doesn't send them. Delete each one when shared adopts it.
import type {
  Attestation as SharedAttestation,
  ChecksStatus as SharedChecksStatus,
  Evidence,
  ProjectDetail as SharedProjectDetail,
  ProjectSummary as SharedProjectSummary,
  Rlusd,
  XrplAddress,
} from "@xrlp/shared";

export type {
  ApiError as ApiErrorBody,
  Builder,
  BuilderDocument,
  ChainEvent,
  ChainEventKind,
  CheckResult,
  CreateProjectInput,
  ErrorCode,
  Evidence,
  EvidenceKind,
  EvidenceRequirement,
  Inspector,
  InspectorAssignment,
  InspectorAudit,
  InspectorTask,
  Investment,
  LoanSnapshot,
  LoanTerms,
  Milestone,
  MilestoneStatus,
  MilestoneStatusV2,
  PortfolioPosition,
  Project,
  ProjectStatus,
  ProjectType,
  ProjectVerification,
  RiskTier,
  Rlusd,
  SovLine,
  TryStealResult,
  VaultSnapshot,
  Verdict,
  XrplAddress,
} from "@xrlp/shared";

import type { InspectorAssignment, InspectorAudit, Investment, Milestone, Project, ProjectVerification, Verdict, ChainEvent } from "@xrlp/shared";

// ---------------------------------------------------------------- PROPOSED on #53

export type PartyRole = "investor" | "builder" | "inspector" | "platform" | "release_service" | "ai_agent" | "trustee" | "spv";

/** PROPOSED: GET /api/admin/demo/parties — demo identities for the role switcher, `actor` fields and display names. */
export type Party = { address: XrplAddress; name: string; role: PartyRole; detail?: string; kyc?: boolean };

export type Attestation = SharedAttestation & {
  /** PROPOSED: memo kind, so each check row can link its own proof. */
  kind?: "audit" | "verdict" | "decision" | "release";
  /** PROPOSED: the attested hash (audit hash, verdictHash). */
  hash?: string;
};

export type ChecksStatus = SharedChecksStatus & {
  /** PROPOSED: check names fixed at lock-terms, so the panel lists queued checks before the first run. */
  suite?: string[];
};

export type ProjectSummary = SharedProjectSummary & {
  /** PROPOSED: the marketplace shows the rate (WEB-02). */
  interestRateBps?: number;
  /** PROPOSED: the builder workspace filters by it. */
  builderId?: string;
  /** PROPOSED: builder credential badge on the marketplace (WEB-02). */
  builderVerified?: boolean;
};

export type ProjectDetail = Omit<SharedProjectDetail, "checks" | "attestations"> & {
  checks: Record<string, ChecksStatus>;
  attestations: Record<string, Attestation[]>;
  /** PROPOSED: builder evidence per milestone (check rows show thumbnails; CheckResult only carries ids). */
  evidence?: Record<string, Evidence[]>;
  /** PROPOSED: live RLUSD balances for the money map (WEB-05) and "builder balance ticks" (demo beat 3). */
  balances?: { spv: Rlusd; builder: Rlusd };
};

// ---------------------------------------------------------------- route bodies and responses (05-api §2)

/** Route 10 `report` part (core picks exactly these; milestone, time, tx and photos come from the route). */
export type AuditReport = Pick<InspectorAudit, "inspector" | "evidenceBundleHash" | "checklist" | "notes">;

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
