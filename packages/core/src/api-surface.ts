// Internal contract between the three core workstreams (CORE-03 service, CORE-04 HTTP server, CORE-12 release service).
// CoreApi = one method per HTTP route in docs/05-api.md §2 (route number in the comment). The HTTP layer only parses,
// calls, and serializes; every rule lives behind this interface. Errors: throw DomainError (src/errors.ts);
// the HTTP layer maps them with toApiError().
import type {
  Builder,
  ChainEvent,
  CreateProjectInput,
  Inspector,
  InspectorAssignment,
  InspectorAudit,
  InspectorTask,
  Investment,
  Milestone,
  PortfolioPosition,
  Project,
  ProjectDetail,
  ProjectStatus,
  ProjectSummary,
  ProjectVerification,
  Rlusd,
  TryStealResult,
  TxResult,
  Verdict,
  XrplAddress,
  Evidence,
} from "@xrlp/shared";
import type { InspectorSiteVisit, SiteVisitReportInput } from "./site-visit.ts";

/** A file the HTTP layer already stored under DATA_DIR (multipart upload). */
export interface StoredFile {
  fileId: string;
  filename: string;
  mimeType: string;
  /** "/api/files/<fileId>" */
  uri: string;
  sha256: string;
  bytes: number;
}

export interface EvidenceUpload extends StoredFile {
  kind: Evidence["kind"];
}

/** Route 10 report body (the JSON part of the multipart). Photos come as StoredFile[]. */
export type AuditReportInput = Pick<InspectorAudit, "inspector" | "evidenceBundleHash" | "checklist" | "notes">;

/** Public demo identities for the presenter role picker; never wallet material. */
export interface DemoParty {
  address: XrplAddress;
  name: string;
  role: "investor" | "builder" | "inspector" | "platform" | "release_service" | "ai_agent" | "spv";
  kyc?: boolean;
}

/** One step the keeper tried and could not finish this tick; it retries the same step on the next tick. */
export interface KeeperIssue {
  projectId: string;
  milestoneId: string;
  step: "cancel" | "refund" | "release";
  code: string;
  message: string;
}

/** Route 22. `issues` is empty when every due step went through. */
export interface KeeperTickResult {
  events: ChainEvent[];
  issues: KeeperIssue[];
}

export interface CoreApi {
  listDemoParties(): Promise<DemoParty[]>;
  listProjects(q?: { status?: ProjectStatus }): Promise<ProjectSummary[]>; // 1
  getProject(id: string): Promise<ProjectDetail>; // 2
  createProject(input: CreateProjectInput): Promise<Project>; // 3
  payVerificationFee(id: string, body: { builder: XrplAddress }): Promise<{ project: Project; events: ChainEvent[] }>; // 4
  verifyProject(id: string): Promise<{ verification: ProjectVerification; project: Project; events: ChainEvent[] }>; // 5
  lockTermsAndOpenFunding(
    id: string,
    body: { actor: XrplAddress },
  ): Promise<{ project: Project; assignment: InspectorAssignment; events: ChainEvent[] }>; // 6
  invest(id: string, body: { investor: XrplAddress; amount: Rlusd }): Promise<{ investment: Investment; events: ChainEvent[] }>; // 7
  closeLoan(id: string, body: { actor: XrplAddress }): Promise<{ project: Project; events: ChainEvent[] }>; // 8
  submitEvidence(id: string, mid: string, files: EvidenceUpload[]): Promise<{ milestone: Milestone; evidence: Evidence[] }>; // 9
  submitAudit(
    id: string,
    mid: string,
    body: { report: AuditReportInput; photos: StoredFile[]; signedTxBlob?: string },
  ): Promise<{ milestone: Milestone; audit: InspectorAudit; events: ChainEvent[] }>; // 10
  runChecks(
    id: string,
    mid: string,
  ): Promise<{ verdict: Verdict; release?: { txHash: string; explorerUrl: string }; events: ChainEvent[] }>; // 11
  resolveNeedsHuman(
    id: string,
    mid: string,
    body: { actor: XrplAddress; decision: "approve" | "reject"; reason: string },
  ): Promise<{ milestone: Milestone; events: ChainEvent[] }>; // 12
  cancelExpired(id: string, mid: string): Promise<{ milestone: Milestone; events: ChainEvent[] }>; // 13
  repay(id: string, body: { amount: Rlusd }): Promise<{ project: Project; events: ChainEvent[] }>; // 14
  withdraw(id: string, body: { investor: XrplAddress; amount: Rlusd }): Promise<{ events: ChainEvent[] }>; // 15
  listEvents(id: string): Promise<ChainEvent[]>; // 16 (newest first)
  listBuilders(): Promise<Builder[]>; // 17
  getBuilder(id: string): Promise<Builder>; // 17
  listInspectors(): Promise<Inspector[]>; // 18
  inspectorQueue(address: XrplAddress): Promise<InspectorTask[]>; // 18
  kycInvestor(address: XrplAddress): Promise<{ events: ChainEvent[] }>; // 19
  portfolio(investor: XrplAddress): Promise<PortfolioPosition[]>; // 20
  resetDemo(body: { seed?: DemoSeed }): Promise<{ ok: true }>; // 21
  keeperTick(): Promise<KeeperTickResult>; // 22
  tryStealDemo(id: string, mid: string): Promise<TryStealResult>; // 23
  submitSiteVisit(
    id: string,
    body: { report: SiteVisitReportInput; photos: StoredFile[]; signedTxBlob?: string },
  ): Promise<{ visit: InspectorSiteVisit; events: ChainEvent[] }>; // 24
  decideProject(
    id: string,
    body: { actor: XrplAddress; decision: "approve" | "reject"; reason: string },
  ): Promise<{ project: Project; events: ChainEvent[] }>; // 25
}

/**
 * Route 21 seeds. Fake mode: "maple-st" = the back-dated scenario (others are refused). LEDGER_MODE=devnet: "prestage",
 * "maple-st" (what the web's Reset button sends) and no seed all load the XRPL prestage (CORE-07); "participants" = the
 * devnet builder, inspector panel and KYC'd investors only, no projects (CORE-05 live-flow e2e).
 */
export const DEMO_SEEDS = ["maple-st", "prestage", "participants"] as const;
export type DemoSeed = (typeof DEMO_SEEDS)[number];

/**
 * CORE-12. Owns escrow preimages (CSPRNG 32 bytes, unique per escrow, encrypted at rest under DATA_DIR) and the finish.
 * The service never sees a preimage or fulfillment.
 */
export interface ReleaseServicePort {
  /** One condition per project.milestones[i], stored with its preimage. Throws on any duplicate. */
  conditionsForClose(project: Project): Promise<string[]>;
  /** Caller has already decided evaluateRelease(...).outcome === "pass".
   *  preflightFinish (throws DomainError UNSAFE_RELEASE, nothing submitted) -> "release" attestation -> finishEscrow.
   *  Returns [attestation tx, finish tx]. If an ambiguous submit consumed the escrow, the second result uses
   *  `result: "reconciled_escrow_consumed"` with the submitted hash; this is an inference from ledger state,
   *  not a validated engine result. */
  release(p: { project: Project; milestone: Milestone }): Promise<TxResult[]>;
  /** Route 23: platform-signed finish with RANDOM bytes. Never reads the preimage store. */
  tryStealDemo(p: { project: Project; milestone: Milestone }): Promise<TxResult>;
  /** When this milestone's release key was marked exposed by a failed finish (no release can ever use it), else undefined. */
  keyExposedAt(p: { projectId: string; milestoneId: string }): Promise<string | undefined>;
  /** Demo reset. */
  clear(): Promise<void>;
}
