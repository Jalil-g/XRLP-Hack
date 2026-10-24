// AI verifier contract. Producer: @xrlp/verifier. Consumers: @xrlp/core, @xrlp/web.
import { z } from "zod";
import { ProjectType, RiskTier, Rlusd } from "./domain.ts";

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
  role: z.enum(["inspector", "ai_agent", "platform"]),
  signer: z.string(), // XRPL address
  decision: z.enum(["approve", "reject"]),
  notes: z.string().default(""),
  txHash: z.string().optional(), // on-chain memo attestation
  at: z.string().datetime(),
});
export type Attestation = z.infer<typeof Attestation>;
