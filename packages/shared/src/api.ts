// HTTP contract between apps (web :3000, inspector :3001) and core (:4000). Mirrors docs/05-api.md §1–2.
import { z } from "zod";
import {
  type Builder,
  type ChainEvent,
  type Inspector,
  type Investment,
  LoanTerms,
  type Milestone,
  type Project,
  ProjectType,
  type Rlusd,
  SovLine,
  type XrplAddress,
} from "./domain.ts";
import type { Attestation, ChecksStatus, Evidence, InspectorAudit, ProjectVerification } from "./verdict.ts";

export const ErrorCode = z.enum([
  "not_found",
  "invalid_state",
  "validation",
  "checks_failed",
  "needs_human",
  "too_soon",
  "ledger_error",
  "verifier_error",
  "unsafe_release", // pre-reveal safety refused to submit a finish (no trust line, escrow gone, past CancelAfter)
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export interface ApiError {
  error: { code: ErrorCode; message: string; txResult?: string; txHash?: string };
}

export const BuilderDocument = z.object({
  kind: z.enum(["license", "insurance", "entity", "permit", "plans", "track_record", "identity", "other"]),
  filename: z.string(),
  /** Path relative to DATA_DIR, or a data: URL. */
  uri: z.string().optional(),
  /** Structured fields the (mock) registries return, e.g. { licenseNumber, expires }. */
  fields: z.record(z.string(), z.string()).optional(),
});
export type BuilderDocument = z.infer<typeof BuilderDocument>;

/** Route 3 body. */
export const CreateProjectInput = z.object({
  name: z.string().min(1),
  type: ProjectType,
  builderId: z.string(),
  siteAddress: z.string(),
  siteGeo: z.object({ lat: z.number(), lng: z.number(), radiusM: z.number().positive() }),
  description: z.string(),
  terms: LoanTerms, // fundingDeadline -> Vault.SubscriptionDate
  sov: z.array(SovLine).min(1), // templates = pre-filled SoVs for residential
  documents: z.array(BuilderDocument), // licence, insurance, entity, permits/plans (mock)
});
export type CreateProjectInput = z.infer<typeof CreateProjectInput>;

export interface VaultSnapshot {
  assetsTotal: Rlusd;
  assetsAvailable: Rlusd;
  sharesOutstanding: string;
  sharePrice: string;
  subscriptionDate: string;
  redemptionDate: string;
  phase: "subscription" | "investment" | "redemption";
}

export interface LoanSnapshot {
  principalOutstanding: Rlusd;
  totalValueOutstanding: Rlusd;
  periodicPayment: Rlusd;
  paymentRemaining: number;
  nextPaymentDueDate: string;
}

/** Route 1. */
export type ProjectSummary = Pick<Project, "id" | "name" | "type" | "status" | "siteAddress"> & {
  principal: Rlusd;
  raised: Rlusd;
  investorCount: number;
  builderName: string;
  fundingDeadline: string;
  verified: boolean;
  interestRateBps?: number;
  builderId?: string;
  /** Builder holds the platform's verified-builder credential. */
  builderVerified?: boolean;
};

/** Route 2. Record keys are milestone ids. */
export interface ProjectDetail {
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
  /** Builder evidence of each milestone's current round (check rows show thumbnails; CheckResult only carries ids). */
  evidence?: Record<string, Evidence[]>;
  /** Live RLUSD balances (money map, "builder balance ticks"). Absent before the SPV exists or if the ledger read fails. */
  balances?: { spv: Rlusd; builder: Rlusd };
}

/** Route 18. */
export interface InspectorTask {
  projectId: string;
  projectName: string;
  milestone?: Milestone;
  sov: SovLine[];
  evidence: Evidence[];
  needs: "pre_visit" | "audit" | "re_audit" | "none";
  siteGeo: Project["siteGeo"];
  priorAudits: InspectorAudit[];
}

/** Route 20. */
export interface PortfolioPosition {
  projectId: string;
  projectName: string;
  shares: string;
  value: Rlusd;
  phase: VaultSnapshot["phase"];
  redemptionDate: string;
}

/** Route 23 response. */
export interface TryStealResult {
  result: "tecCRYPTOCONDITION_ERROR";
  txHash: string;
  explorerUrl: string;
}

/** Request bodies where a role matters carry the acting address (demo: no auth). */
export interface ActorBody {
  actor: XrplAddress;
}
