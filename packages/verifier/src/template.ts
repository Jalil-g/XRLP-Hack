import { MILESTONE_TEMPLATES, SovLine, type MilestoneTemplate } from "@xrlp/shared";
import { canonicalJson } from "./hash.ts";
import type { VerifyMilestoneInput } from "./types.ts";

/** Resolve a locked SoV group; supplied lines may not replace a different stored definition. */
export function milestoneTemplate(input: VerifyMilestoneInput): MilestoneTemplate | undefined {
  const fallback = input.template ?? MILESTONE_TEMPLATES[input.project.type].find((t) => t.key === input.milestone.templateKey);
  const codes = input.milestone.sovCodes ?? [];
  const supplied = input.sov ?? input.project.sov;
  if (!codes.length || !supplied?.length) return fallback;
  if (new Set(codes).size !== codes.length) return;
  const lines: SovLine[] = [];
  for (const code of codes) {
    const matches = supplied.filter((line) => line.code === code);
    if (matches.length !== 1) return;
    const parsed = SovLine.safeParse(matches[0]);
    if (!parsed.success) return;
    const stored = input.project.sov?.find((line) => line.code === code);
    if (stored && canonicalJson(stored) !== canonicalJson(parsed.data)) return;
    lines.push(parsed.data);
  }
  const requirements = new Map<string, MilestoneTemplate["requiredEvidence"][number]>();
  for (const req of lines.flatMap((line) => line.evidence)) {
    const old = requirements.get(req.kind);
    // One invoice/photo may cover multiple SoV lines; the audit/AI checks every line's claim.
    requirements.set(req.kind, { ...req, minCount: Math.max(old?.minCount ?? 0, req.minCount) });
  }
  const visualCriteria = [...new Set(lines.flatMap((line) => line.visualCriteria))];
  return {
    key: input.milestone.templateKey, title: input.milestone.title, defaultShare: fallback?.defaultShare ?? 0,
    requiredEvidence: requirements.size ? [...requirements.values()] : fallback?.requiredEvidence ?? [],
    visualCriteria: visualCriteria.length ? visualCriteria : fallback?.visualCriteria ?? [],
  };
}
