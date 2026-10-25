// What the LLM layer (mock or live Claude) contributes to a milestone verdict.
import { z } from "zod/v4"; // the SDK's zod helpers use zod v4 (shipped inside zod@3.25 as "zod/v4")
import type { InspectorAudit } from "@xrlp/shared";
import type { CheckOutcome, LoadedEvidence, MilestoneContext, MilestoneTimeline } from "../types.ts";

export interface MilestoneJudgeInput {
  ctx: MilestoneContext;
  photos: LoadedEvidence[];
  documents: LoadedEvidence[]; // invoices + documents
  timeline: MilestoneTimeline;
  audits?: InspectorAudit[];
  inspectorPhotos?: LoadedEvidence[];
}

export interface MilestoneJudgement {
  stage: CheckOutcome; // stage_visually_consistent
  documents: CheckOutcome; // document_consistency
  /** Invoice totals the model read (by evidence id) — used when deterministic parsing can't (PDFs, photos of invoices). */
  invoiceTotals: Record<string, string | undefined>;
  model: string;
  audit?: CheckOutcome;
}

export interface MilestoneJudge {
  judgeMilestone(input: MilestoneJudgeInput): Promise<MilestoneJudgement>;
}

/** Structured output the live model must return. Validated with zod by the SDK's parse helper. */
export const LlmMilestoneOutput = z.object({
  stage_visually_consistent: z.object({
    result: z.enum(["pass", "fail", "warn"]),
    confidence: z.number().min(0).max(1).describe("0..1, your confidence in this result"),
    reason: z.string().min(1).describe("One or two sentences a lender can read. Cite photo ids."),
    criteria_observed: z.array(z.string()),
    criteria_missing: z.array(z.string()),
    photos: z.array(
      z.object({
        evidence_id: z.string(),
        assessment: z.enum(["matches_stage", "wrong_stage", "not_construction", "not_a_photo", "unclear"]),
        note: z.string(),
      }),
    ),
  }),
  document_consistency: z.object({
    result: z.enum(["pass", "fail", "warn"]),
    confidence: z.number().min(0).max(1),
    reason: z.string().min(1),
    documents: z.array(
      z.object({
        evidence_id: z.string(),
        doc_type: z.string().describe("e.g. invoice, inspection sign-off, lien waiver, permit"),
        parties: z.array(z.string()),
        site_address: z.string().nullable(),
        date: z.string().nullable().describe("YYYY-MM-DD if present"),
        total: z.string().nullable().describe("Grand total as a plain decimal like 24850.00, or null"),
        issues: z.array(z.string()),
      }),
    ),
  }),
  audit_matches_evidence: z.object({
    result: z.enum(["pass", "fail", "warn"]), confidence: z.number().min(0).max(1),
    reason: z.string().min(1), checklist_conflicts: z.array(z.string()),
  }),
});
export type LlmMilestoneOutput = z.infer<typeof LlmMilestoneOutput>;

/** Fallback when the model is unavailable/refuses: never auto-pass, route to a human. */
export function unavailableJudgement(reason: string, model: string, input: MilestoneJudgeInput): MilestoneJudgement {
  const mk = (check: string, items: LoadedEvidence[]): CheckOutcome =>
    items.length
      ? { check, result: "warn", reason: `AI review unavailable: ${reason}`, evidenceIds: [], confidence: 0, source: "llm" }
      : { check, result: "skipped", reason: "Nothing to review.", evidenceIds: [], confidence: 1, source: "llm" };
  return {
    stage: mk("stage_visually_consistent", input.photos),
    documents: mk("document_consistency", input.documents),
    audit: { check: "audit_matches_evidence", result: "warn", reason: `AI review unavailable: ${reason}`, evidenceIds: [], confidence: 0, source: "llm" },
    invoiceTotals: {},
    model,
  };
}
