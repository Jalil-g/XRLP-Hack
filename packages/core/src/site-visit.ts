// Route 24: pre-construction site visit (INS-06). The inspector app's contract is apps/inspector/lib/site-visit.ts:
// multipart `report` (JSON InspectorSiteVisit), `photos` (repeated), optional `signedTxBlob`; response `{ visit }`.
// A site visit is evidence for the platform operator's project decision (route 25). It never changes the project status.
import { canonicalJson, sha256Hex } from "@xrlp/attest-signer";
import { XrplAddress, type Evidence } from "@xrlp/shared";
import { z } from "zod";

export const SITE_VISIT_QUESTIONS = ["siteExists", "siteAccessible", "plansMatchSite"] as const;
export type SiteVisitQuestion = (typeof SITE_VISIT_QUESTIONS)[number];

const AnswerEntry = z.object({ answer: z.enum(["yes", "no", "unable_to_confirm"]), note: z.string().optional() });
export type SiteVisitAnswer = z.infer<typeof AnswerEntry>;

/** What core reads from the `report` part. Client-side `photos`, `txHash` and `at` are ignored: core assigns them. */
export const SiteVisitReportInput = z.object({
  projectId: z.string().min(1),
  inspector: XrplAddress,
  answers: z.object({ siteExists: AnswerEntry, siteAccessible: AnswerEntry, plansMatchSite: AnswerEntry }),
  notes: z.string().default(""),
});
export type SiteVisitReportInput = z.input<typeof SiteVisitReportInput>;

/** Same shape as the inspector app's `InspectorSiteVisit`. */
export interface InspectorSiteVisit {
  projectId: string;
  inspector: XrplAddress;
  answers: Record<SiteVisitQuestion, SiteVisitAnswer>;
  photos: Evidence[];
  notes: string;
  txHash?: string;
  at: string;
}

/** Notes trimmed, empty notes dropped (the app's buildSiteVisit does the same). */
export function normalizeAnswers(answers: Record<SiteVisitQuestion, SiteVisitAnswer>): Record<SiteVisitQuestion, SiteVisitAnswer> {
  const out = {} as Record<SiteVisitQuestion, SiteVisitAnswer>;
  for (const k of SITE_VISIT_QUESTIONS) {
    const a = answers[k];
    out[k] = a.note?.trim() ? { answer: a.answer, note: a.note.trim() } : { answer: a.answer };
  }
  return out;
}

/** Byte-for-byte the app's `siteVisitHash`: canonical JSON of what core keeps, photos as sorted sha256s. */
export function siteVisitHash(v: {
  projectId: string;
  inspector: string;
  answers: Record<SiteVisitQuestion, SiteVisitAnswer>;
  notes: string;
  photos: readonly { sha256: string }[];
}): Promise<string> {
  return sha256Hex(
    canonicalJson({
      v: 1,
      projectId: v.projectId,
      inspector: v.inspector,
      answers: normalizeAnswers(v.answers),
      notes: v.notes.trim(),
      photos: v.photos.map((p) => p.sha256.toLowerCase()).sort(),
    }),
  );
}

export function siteVisitOutcome(answers: Record<SiteVisitQuestion, SiteVisitAnswer>): "confirmed" | "concern" | "unconfirmed" {
  const all = SITE_VISIT_QUESTIONS.map((k) => answers[k].answer);
  return all.includes("no") ? "concern" : all.includes("unable_to_confirm") ? "unconfirmed" : "confirmed";
}
