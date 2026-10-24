// Verifier-local types. Cross-package contract types (Verdict, Evidence, ...) live in @xrlp/shared.
import type { Builder, CheckResult, Evidence, Milestone, MilestoneTemplate, Project, RiskTier } from "@xrlp/shared";

export const MILESTONE_CHECKS = [
  "required_evidence_present",
  "gps_within_site",
  "photo_fresh",
  "no_duplicate_photo",
  "invoice_matches_budget",
  "lien_waiver_matches_invoices",
  "stage_visually_consistent",
  "document_consistency",
] as const;
export type MilestoneCheckName = (typeof MILESTONE_CHECKS)[number];

/**
 * Checks decided by code. Strength differs — be honest about it in the pitch:
 * - STRONG: no_duplicate_photo (cross-project perceptual-hash dedupe), invoice_matches_budget,
 *   lien_waiver_matches_invoices, required_evidence_present.
 * - CATCHES LAZY FRAUD ONLY: gps_within_site, photo_fresh. EXIF GPS/time are trivially spoofable;
 *   they catch someone re-uploading an old phone photo, not a determined fraudster.
 */
export const DETERMINISTIC_CHECKS: readonly MilestoneCheckName[] = [
  "required_evidence_present",
  "gps_within_site",
  "photo_fresh",
  "no_duplicate_photo",
  "invoice_matches_budget",
  "lien_waiver_matches_invoices",
];
export const LAZY_FRAUD_ONLY_CHECKS: readonly MilestoneCheckName[] = ["gps_within_site", "photo_fresh"];
export const LLM_CHECKS: readonly MilestoneCheckName[] = ["stage_visually_consistent", "document_consistency"];

export type VerifierMode = "mock" | "live";

/** Evidence previously submitted anywhere on the platform (any project), used for reuse detection. */
export interface PriorEvidence {
  evidence: Evidence;
  projectId: string;
  milestoneId: string;
  /** Optional, only used to make reasons readable ("... from project Oak Ave Fourplex"). */
  projectName?: string;
}

export interface MilestoneTimeline {
  /** When this milestone's escrow was created on-chain (ISO). Photos must be taken after this. */
  escrowCreatedAt?: string;
  /** When the previous milestone was approved/released (ISO). Photos must be taken after this too. */
  previousMilestoneApprovedAt?: string;
  /** "Now" for freshness checks (ISO). Defaults to the real clock. Fixtures pin it for determinism. */
  now?: string;
}

export interface VerifyMilestoneInput {
  project: Project;
  builder: Builder;
  milestone: Milestone;
  /** The evidence bundle submitted for this milestone. `meta` is filled in if missing. */
  evidence: Evidence[];
  /** All other evidence on the platform (ALL projects). Same-milestone entries are ignored (resubmits). */
  priorEvidence?: PriorEvidence[];
  timeline?: MilestoneTimeline;
  /** Raw bytes by evidence id. If absent, bytes are loaded from `evidence.uri` (data: URL or path). */
  files?: Record<string, Uint8Array>;
  /** Base dir for relative `evidence.uri` paths. Default: env DATA_DIR, else ".data". */
  dataDir?: string;
  /** Overrides env VERIFIER_MODE. */
  mode?: VerifierMode;
  /** Overrides env VERIFIER_MODEL (live mode only). */
  model?: string;
}

export type CheckSource = "deterministic" | "llm" | "mock-llm";

/** Internal check result: shared CheckResult + confidence + where it came from. */
export interface CheckOutcome extends CheckResult {
  check: MilestoneCheckName | string;
  confidence: number;
  source: CheckSource;
}

/** Evidence with its bytes loaded and metadata (re)computed. */
export interface LoadedEvidence {
  evidence: Evidence;
  bytes: Uint8Array | null;
  /** sha256 recomputed from bytes (null if bytes could not be loaded). */
  sha256: string | null;
  meta: Evidence["meta"];
  /** Text content for text/plain or JSON documents. */
  text: string | null;
  loadError?: string;
}

export interface MilestoneContext {
  project: Project;
  builder: Builder;
  milestone: Milestone;
  template: MilestoneTemplate | undefined;
  riskTier: RiskTier;
}
