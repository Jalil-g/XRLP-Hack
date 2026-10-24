// VERIFIER_MODE=mock: plausible, deterministic stand-ins for the Claude checks. No API key needed.
// - stage_visually_consistent: keyed off FILENAME tokens (e.g. "framing-02.jpg" shows framing).
// - document_consistency: a text heuristic (builder name, site street, dates) over text/JSON docs.
// Every reason is prefixed "[mock]" so nobody mistakes it for a real model judgment.
import type { CheckOutcome } from "../types.ts";
import { DAY_MS, fmtDate, listJoin, normalizeName } from "../util.ts";
import type { MilestoneJudge, MilestoneJudgeInput, MilestoneJudgement } from "./types.ts";

/** Filename keywords that "show" each template stage. */
export const STAGE_KEYWORDS: Record<string, string[]> = {
  foundation: ["foundation", "slab", "footing"],
  framing: ["framing", "frame", "stud", "truss"],
  dry_in: ["roof", "dryin", "dry-in", "dry_in", "window"],
  finish: ["finish", "interior", "drywall", "kitchen"],
  demo_rough: ["demo", "rough", "stripped"],
  site_foundation: ["site", "grading", "graded", "foundation"],
  structure: ["structure", "steel", "envelope"],
  fitout: ["fitout", "fit-out", "fit_out"],
};

function stageOf(filename: string, expected: string): "matches_stage" | "wrong_stage" | "unclear" {
  const f = filename.toLowerCase();
  if ((STAGE_KEYWORDS[expected] ?? [expected]).some((k) => f.includes(k))) return "matches_stage";
  for (const [stage, kws] of Object.entries(STAGE_KEYWORDS)) {
    if (stage !== expected && kws.some((k) => f.includes(k))) return "wrong_stage";
  }
  return "unclear";
}

export class MockJudge implements MilestoneJudge {
  async judgeMilestone(input: MilestoneJudgeInput): Promise<MilestoneJudgement> {
    return {
      stage: this.stage(input),
      documents: this.documents(input),
      invoiceTotals: {},
      model: "mock",
    };
  }

  private stage({ ctx, photos }: MilestoneJudgeInput): CheckOutcome {
    const check = "stage_visually_consistent";
    const tpl = ctx.template;
    if (!photos.length || !tpl) {
      return { check, result: "skipped", reason: "[mock] No photos to review.", evidenceIds: [], confidence: 1, source: "mock-llm" };
    }
    const graded = photos.map((p) => ({ p, a: stageOf(p.evidence.filename, tpl.key) }));
    const wrong = graded.filter((g) => g.a === "wrong_stage");
    const unclear = graded.filter((g) => g.a === "unclear");
    if (wrong.length) {
      return {
        check, result: "fail", confidence: 0.88, source: "mock-llm",
        reason: `[mock] ${listJoin(wrong.map((g) => g.p.evidence.filename))} do not show the "${tpl.title}" stage (expected: ${tpl.visualCriteria.join("; ")}).`,
        evidenceIds: wrong.map((g) => g.p.evidence.id),
      };
    }
    if (unclear.length) {
      return {
        check, result: "warn", confidence: 0.55, source: "mock-llm",
        reason: `[mock] Could not confirm the "${tpl.title}" stage in ${listJoin(unclear.map((g) => g.p.evidence.filename))}.`,
        evidenceIds: unclear.map((g) => g.p.evidence.id),
      };
    }
    return {
      check, result: "pass", confidence: 0.9, source: "mock-llm",
      reason: `[mock] All ${photos.length} photos are consistent with "${tpl.title}": ${tpl.visualCriteria.join("; ")}.`,
      evidenceIds: photos.map((p) => p.evidence.id),
    };
  }

  private documents({ ctx, documents, timeline }: MilestoneJudgeInput): CheckOutcome {
    const check = "document_consistency";
    if (!documents.length) {
      return { check, result: "skipped", reason: "[mock] No documents to review.", evidenceIds: [], confidence: 1, source: "mock-llm" };
    }
    const builder = normalizeName(ctx.builder.name);
    // "41 Maple St, Brooklyn, NY 11216" -> "41 maple st"
    const street = ctx.project.siteAddress.split(",")[0]!.toLowerCase().trim();
    const now = timeline.now ? Date.parse(timeline.now) : Date.now();
    const earliest = timeline.escrowCreatedAt ? Date.parse(timeline.escrowCreatedAt) - 60 * DAY_MS : -Infinity;

    const issues: string[] = [];
    const ids = new Set<string>();
    let unreadable = 0;
    for (const d of documents) {
      if (d.text === null) {
        unreadable++;
        continue;
      }
      const text = d.text.toLowerCase();
      const fn = d.evidence.filename;
      if (!normalizeName(d.text).includes(builder)) {
        issues.push(`${fn} does not name the builder "${ctx.builder.name}"`);
        ids.add(d.evidence.id);
      }
      if (!text.includes(street)) {
        issues.push(`${fn} does not reference the site address "${ctx.project.siteAddress}"`);
        ids.add(d.evidence.id);
      }
      for (const m of d.text.matchAll(/\b(20\d\d-\d\d-\d\d)\b/g)) {
        const t = Date.parse(`${m[1]}T12:00:00Z`);
        if (t > now + DAY_MS || t < earliest) {
          issues.push(`${fn} is dated ${m[1]}, outside the project window`);
          ids.add(d.evidence.id);
          break;
        }
      }
    }
    if (issues.length) {
      return { check, result: "fail", confidence: 0.8, source: "mock-llm", reason: `[mock] ${listJoin(issues)}.`, evidenceIds: [...ids] };
    }
    if (unreadable) {
      return {
        check, result: "warn", confidence: 0.5, source: "mock-llm",
        reason: `[mock] ${unreadable} binary document(s) (PDF/image) can't be read in mock mode; use VERIFIER_MODE=live.`,
        evidenceIds: [],
      };
    }
    const window = timeline.now ? ` (as of ${fmtDate(new Date(now).toISOString())})` : "";
    return {
      check, result: "pass", confidence: 0.85, source: "mock-llm",
      reason: `[mock] ${documents.length} document(s) name ${ctx.builder.name}, reference ${ctx.project.siteAddress}, and are dated within the project window${window}.`,
      evidenceIds: documents.map((d) => d.evidence.id),
    };
  }
}
