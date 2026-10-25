// AI verifier contract. Producer: @xrlp/verifier. Consumers: @xrlp/core, @xrlp/web.
import { z } from "zod";
import { ProjectType, RiskTier, Rlusd, XrplAddress } from "./domain.ts";

export const EvidenceKind = z.enum(["photo", "invoice", "document", "inspector_report"]);
export type EvidenceKind = z.infer<typeof EvidenceKind>;

export const Evidence = z.object({
  id: z.string(),
  kind: EvidenceKind,
  filename: z.string(),
  mimeType: z.string(),
  /** Path relative to DATA_DIR, or a data: URL for small demo fixtures. */
  uri: z.string(),
  sha256: z.string(),
  /** Extracted metadata (EXIF etc.) — filled by the verifier's preprocessing. */
  meta: z
    .object({
      takenAt: z.string().datetime().optional(),
      gps: z.object({ lat: z.number(), lng: z.number() }).optional(),
      perceptualHash: z.string().optional(),
      invoiceTotal: Rlusd.optional(),
    })
    .partial()
    .default({}),
  uploadedAt: z.string().datetime(),
});
export type Evidence = z.infer<typeof Evidence>;

export const CheckResult = z.object({
  check: z.string(), // e.g. "gps_within_site", "photo_fresh", "no_duplicate_photo", "invoice_matches_budget", "stage_visually_consistent"
  result: z.enum(["pass", "fail", "warn", "skipped"]),
  reason: z.string(),
  evidenceIds: z.array(z.string()).default([]),
});
export type CheckResult = z.infer<typeof CheckResult>;

/** The milestone test suite (docs/00-overview.md). `CheckResult.check` uses these ids. */
export const DETERMINISTIC_CHECKS = [
  "required_evidence_present",
  "gps_within_site",
  "photo_fresh",
  "no_duplicate_photo", // pHash across ALL projects
  "invoice_matches_budget", // vs Schedule of Values line
  "inspector_audit_present", // signed by the assigned inspector, attested on-chain
  "audit_checklist_complete",
] as const;
export const JUDGEMENT_CHECKS = ["stage_visually_consistent", "audit_matches_evidence", "document_consistency"] as const;
export const MILESTONE_CHECKS = [...DETERMINISTIC_CHECKS, ...JUDGEMENT_CHECKS] as const;
export type MilestoneCheckId = (typeof MILESTONE_CHECKS)[number];

export const Verdict = z.object({
  milestoneId: z.string(),
  decision: z.enum(["pass", "fail", "needs_human"]),
  confidence: z.number().min(0).max(1),
  summary: z.string(),
  checks: z.array(CheckResult),
  policy: z.object({
    projectType: ProjectType,
    riskTier: RiskTier,
    requiredInspectors: z.number().int().min(1).max(2),
  }),
  model: z.string(), // model id or "mock"
  createdAt: z.string().datetime(),
});
export type Verdict = z.infer<typeof Verdict>;

/** Inspector's signed decision. Signature is over sha256(JSON of {milestoneId, decision, notes, verdictHash}). */
export const Attestation = z.object({
  milestoneId: z.string(),
  role: z.enum(["inspector", "ai_agent", "platform", "release_service"]),
  signer: z.string(), // XRPL address
  decision: z.enum(["approve", "reject"]),
  notes: z.string().default(""),
  txHash: z.string().optional(), // on-chain memo attestation
  at: z.string().datetime(),
  /** Memo kind of the attestation tx, so each check row can link its own proof (web PROPOSED on #53). */
  kind: z.enum(["audit", "verdict", "decision", "release"]).optional(),
  /** The attested hash (audit hash, verdictHash, decision reason hash). */
  hash: z.string().optional(),
});
export type Attestation = z.infer<typeof Attestation>;

/** What release requires for one milestone (VerifierPort.policyFor). */
export const ReleasePolicy = z.object({
  riskTier: RiskTier,
  requiredChecks: z.array(z.string()), // MilestoneCheckId values; every one must be "pass"
  optionalChecks: z.array(z.string()).default([]), // shown, never block
  minConfidence: z.number().min(0).max(1), // below -> needs_human
  requiredAudits: z.union([z.literal(1), z.literal(2)]), // two independent audits for large milestones
});
export type ReleasePolicy = z.infer<typeof ReleasePolicy>;

/** Assigned inspector's signed site audit for one milestone (route 10). */
export const InspectorAudit = z.object({
  milestoneId: z.string(),
  inspector: XrplAddress,
  evidenceBundleHash: z.string(), // sha256 over the builder evidence the inspector reviewed
  checklist: z.array(
    z.object({
      sovCode: z.string(),
      status: z.enum(["done", "partial", "not_done"]),
      note: z.string().optional(),
    }),
  ),
  photos: z.array(Evidence),
  notes: z.string(),
  txHash: z.string().optional(), // audit_attested tx
  at: z.string().datetime(),
});
export type InspectorAudit = z.infer<typeof InspectorAudit>;

/** AI-first project verification (route 5): identity, feasibility, capability. */
export const ProjectVerification = z.object({
  identity: z.array(CheckResult),
  feasibility: z.array(CheckResult),
  capability: z.array(CheckResult),
  decision: z.enum(["pass", "fail", "needs_human"]),
  riskTier: RiskTier,
  summary: z.string(),
  model: z.string(),
  createdAt: z.string().datetime(),
});
export type ProjectVerification = z.infer<typeof ProjectVerification>;

/** AI inspector assignment from the verified panel (route 6). */
export const InspectorAssignment = z.object({
  inspectors: z.array(XrplAddress),
  scores: z.record(z.string(), z.number()), // keyed by inspector address
  reasons: z.array(z.string()),
});
export type InspectorAssignment = z.infer<typeof InspectorAssignment>;

/** Checks panel state per milestone ("like CI"). */
export const ChecksStatus = z.object({
  required: z.array(CheckResult),
  optional: z.array(CheckResult),
  verdict: Verdict.optional(),
  outcome: z.enum(["pending", "pass", "fail", "needs_human"]),
  /** Required check ids from the milestone's release policy, so the panel lists queued checks before the first run. */
  suite: z.array(z.string()).optional(),
});
export type ChecksStatus = z.infer<typeof ChecksStatus>;
