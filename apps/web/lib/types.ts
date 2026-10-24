// View models returned by lib/api.ts. These are the read-model shapes @xrlp/core must produce.
// Domain primitives come from @xrlp/shared; nothing here redefines them.
import type {
  Attestation,
  Builder,
  ChainEvent,
  Evidence,
  EvidenceKind,
  Investment,
  Milestone,
  MilestoneTemplate,
  Project,
  Rlusd,
  Verdict,
  XrplAddress,
} from "@xrlp/shared";

export type Role = "investor" | "builder" | "inspector" | "platform";

/** Any named on-chain participant. (Shared has Builder; investors/inspectors/agents have no shared type yet.) */
export interface Party {
  address: XrplAddress;
  name: string;
  role: "investor" | "inspector" | "ai_agent" | "platform" | "builder" | "spv";
  /** Short secondary line, e.g. firm or license. */
  detail?: string;
}

/** Project-level money breakdown, all RLUSD decimal strings. */
export interface FundsBreakdown {
  target: Rlusd;
  raised: Rlusd;
  /** Deposited, loan not yet closed. */
  awaitingClose: Rlusd;
  /** Sitting in milestone escrows (locked). */
  escrowed: Rlusd;
  /** Released to the builder via EscrowFinish (cumulative). */
  released: Rlusd;
  /** Principal repaid by the builder via LoanPay (cumulative). */
  repaid: Rlusd;
  /** Escrows cancelled after expiry and returned to the vault (cumulative). */
  refunded: Rlusd;
  interestPaid: Rlusd;
}

export interface VaultState {
  /** RLUSD per share, decimal string with 6 dp. Starts at "1.000000", rises as interest is paid. */
  sharePrice: string;
  totalShares: string;
  totalAssets: Rlusd;
}

export interface ProjectSummary {
  project: Project;
  builder: Builder;
  funding: { raised: Rlusd; target: Rlusd; pct: number; investorCount: number; deadline: string };
  funds: FundsBreakdown;
  /** First milestone not yet released/refunded, if any. */
  currentMilestone: Milestone | null;
  milestonesReleased: number;
}

export interface SignerSlot {
  /** v1 quorum signers. The v2 `release_service` role never signs a quorum slot. */
  role: Exclude<Attestation["role"], "release_service">;
  address: XrplAddress;
  name: string;
  weight: number;
  /** Inspectors are mandatory: no release without one. */
  mandatory: boolean;
  attestation: Attestation | null;
}

export interface Quorum {
  /** SignerQuorum on the SPV (3). */
  required: number;
  /** Sum of weights of current approvals. */
  collected: number;
  inspectorsRequired: number;
  inspectorsSigned: number;
  met: boolean;
  signers: SignerSlot[];
}

export interface MilestoneView {
  milestone: Milestone;
  template: MilestoneTemplate | null;
  evidence: Evidence[];
  verdict: Verdict | null;
  attestations: Attestation[];
  quorum: Quorum;
  /**
   * Inspector who generated this escrow's crypto-condition preimage. Only they can reveal the
   * fulfillment, so only their "Sign approval" can finish the escrow. The platform never sees it.
   */
  releaseKeyHolder: Party | null;
  /** Quorum met and escrow still open. */
  canRelease: boolean;
}

export interface ProjectDetail extends ProjectSummary {
  milestones: MilestoneView[];
  /** Newest first. */
  timeline: ChainEvent[];
  investments: Investment[];
  vault: VaultState;
  /** Address → display info for everything that appears in the timeline / approvals. */
  directory: Record<string, Party>;
}

export interface MarketplaceView {
  stats: {
    totalCommitted: Rlusd;
    lockedInEscrow: Rlusd;
    releasedOnProof: Rlusd;
    milestonesVerified: number;
    verifiedBuilders: number;
    activeProjects: number;
  };
  projects: ProjectSummary[];
}

export interface InvestorPosition {
  summary: ProjectSummary;
  deposited: Rlusd;
  shares: string;
  sharePrice: string;
  value: Rlusd;
  /** 0..1 share of the project vault. */
  ownership: number;
  /** Pro-rata slice of the project's FundsBreakdown. */
  exposure: { awaitingClose: Rlusd; escrowed: Rlusd; released: Rlusd; returned: Rlusd };
}

export interface InvestorPortfolio {
  investor: Party;
  positions: InvestorPosition[];
  totals: { deposited: Rlusd; value: Rlusd; awaitingClose: Rlusd; escrowed: Rlusd; released: Rlusd; returned: Rlusd };
  /** Events across the investor's projects, newest first. */
  events: ChainEvent[];
  directory: Record<string, Party>;
}

export interface InspectionTask {
  project: Project;
  builder: Builder;
  milestone: MilestoneView;
  /** This inspector's own attestation, if any. */
  mine: Attestation | null;
}

export interface InspectorQueue {
  inspector: Party;
  pending: InspectionTask[];
  completed: InspectionTask[];
}

export interface BuilderProjectView {
  summary: ProjectSummary;
  /** The milestone the builder should act on (escrowed / rejected / in review), or null. */
  current: MilestoneView | null;
}

export interface BuilderDashboard {
  builder: Builder;
  projects: BuilderProjectView[];
  totals: { raised: Rlusd; released: Rlusd; escrowed: Rlusd };
  /** escrow_finished events paid to this builder, newest first. */
  payouts: ChainEvent[];
}

// ---------- action inputs / results ----------

export interface InvestInput {
  projectId: string;
  investor: XrplAddress;
  amount: Rlusd;
}

export interface InvestResult {
  investment: Investment;
  sharesIssued: string;
  sharePrice: string;
  event: ChainEvent;
}

/** One uploaded file. sha256 is computed client-side over the raw bytes. */
export interface EvidenceUpload {
  kind: EvidenceKind;
  filename: string;
  mimeType: string;
  sha256: string;
  /** data: URL thumbnail (images) or a stored path. */
  uri?: string;
  meta?: Evidence["meta"];
}

export interface SubmitEvidenceInput {
  projectId: string;
  milestoneId: string;
  files: EvidenceUpload[];
}

export interface AttestInput {
  projectId: string;
  milestoneId: string;
  signer: XrplAddress;
  decision: "approve" | "reject";
  notes: string;
  /** Detached signature over sha256({milestoneId, decision, notes, verdictHash}). */
  signature?: { scheme: "local-mock" | "ledger"; payloadHash: string; signature: string; publicKey?: string };
}

export interface AttestResult {
  attestation: Attestation;
  /** Set when this signature completed the quorum and the key holder's fulfillment finished the escrow. */
  release: ChainEvent | null;
}

export interface MilestoneRef {
  projectId: string;
  milestoneId: string;
}

export type DemoAction =
  | "reset"
  | "advance_funding"
  | "close_loan"
  | "submit_good_evidence"
  | "submit_fraud_evidence"
  | "inspector_approve"
  | "fast_forward_expiry"
  | "repay";

export interface DemoStep {
  action: Exclude<DemoAction, "reset">;
  scriptStep: number;
  title: string;
  description: string;
  enabled: boolean;
  /** Why it's disabled, or what it will act on. */
  hint: string;
}

export interface DemoState {
  project: ProjectSummary;
  steps: DemoStep[];
  log: ChainEvent[];
}

export interface DemoResult {
  message: string;
  events: ChainEvent[];
}
