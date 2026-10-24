import { CheckResult, MILESTONE_TEMPLATES, Verdict } from "@xrlp/shared";
import {
  checkGpsWithinSite,
  checkInvoiceMatchesBudget,
  checkLienWaivers,
  checkNoDuplicatePhoto,
  checkPhotoFresh,
  checkRequiredEvidence,
} from "./checks.ts";
import { resolveMode, resolveModel } from "./config.ts";
import { MockJudge } from "./llm/mock.ts";
import type { MilestoneJudge } from "./llm/types.ts";
import { loadEvidence } from "./meta.ts";
import { policyFor, type Escalation, type VerificationPolicy } from "./policy.ts";
import type { CheckOutcome, LoadedEvidence, MilestoneCheckName, MilestoneContext, PriorEvidence, VerifyMilestoneInput } from "./types.ts";
import { round2 } from "./util.ts";

export interface VerifyMilestoneResult {
  verdict: Verdict;
  policy: VerificationPolicy;
  /** Per-check results with confidence/source and the escalation the policy applied. */
  checks: (CheckOutcome & { escalation: Escalation | "none" })[];
  /** Evidence with recomputed sha256 + meta — persist this so future submissions can be deduped against it. */
  evidence: LoadedEvidence[];
}

export interface VerifyOptions {
  /** Inject a judge (tests, or a custom model wrapper). Defaults to mock/live per VERIFIER_MODE. */
  judge?: MilestoneJudge;
}

/**
 * Live judge is loaded lazily so mock mode never imports @anthropic-ai/sdk
 * (no key, no network, no SDK needed for teammates running the demo).
 */
export async function createLiveJudge(model = resolveModel()): Promise<MilestoneJudge> {
  const { LiveJudge } = await import("./llm/live.ts");
  return new LiveJudge(model);
}

export async function verifyMilestone(input: VerifyMilestoneInput, opts: VerifyOptions = {}): Promise<Verdict> {
  return (await verifyMilestoneDetailed(input, opts)).verdict;
}

export async function verifyMilestoneDetailed(input: VerifyMilestoneInput, opts: VerifyOptions = {}): Promise<VerifyMilestoneResult> {
  const { project, builder, milestone } = input;
  const timeline = { ...(input.escrowCreatedAt ? { escrowCreatedAt: input.escrowCreatedAt } : {}), ...input.timeline };
  const template = input.template ?? MILESTONE_TEMPLATES[project.type].find((t) => t.key === milestone.templateKey);
  const currentIds = new Set(input.evidence.map((e) => e.id));
  const prior: PriorEvidence[] = (input.priorEvidence ?? [])
    .map((p) => ("evidence" in p ? p : { evidence: p, projectId: "unknown", milestoneId: "unknown" }))
    .filter((p) => !currentIds.has(p.evidence.id)); // same evidence object re-sent: not a duplicate
  const ctx: MilestoneContext = { project, builder, milestone, template, riskTier: builder.riskTier };
  const policy = policyFor(project, builder, milestone);

  const loaded = await Promise.all(input.evidence.map((ev) => loadEvidence(ev, { files: input.files, dataDir: input.dataDir })));
  const photos = loaded.filter((l) => l.evidence.kind === "photo" && l.bytes);
  const documents = loaded.filter((l) => (l.evidence.kind === "invoice" || l.evidence.kind === "document") && l.bytes);

  const mode = resolveMode(input.mode);
  const judge = opts.judge ?? (mode === "live" ? await createLiveJudge(resolveModel(input.model)) : new MockJudge());
  const judgement = await judge.judgeMilestone({ ctx, photos, documents, timeline });

  const outcomes: CheckOutcome[] = [
    checkRequiredEvidence(template, loaded, milestone.templateKey),
    checkGpsWithinSite(ctx, loaded, policy),
    checkPhotoFresh(loaded, timeline, policy),
    checkNoDuplicatePhoto(ctx, loaded, prior, policy),
    checkInvoiceMatchesBudget(ctx, loaded, policy, judgement.invoiceTotals),
    checkLienWaivers(loaded),
    judgement.stage,
    judgement.documents,
  ];

  const decided = decide(outcomes, policy);
  const verdict = Verdict.parse({
    milestoneId: milestone.id,
    decision: decided.decision,
    confidence: decided.confidence,
    summary: summarize(decided, policy),
    checks: outcomes.map((o) => CheckResult.parse({ check: o.check, result: o.result, reason: o.reason, evidenceIds: o.evidenceIds })),
    policy: { projectType: project.type, riskTier: builder.riskTier, requiredInspectors: policy.requiredInspectors },
    model: judgement.model,
    createdAt: new Date().toISOString(),
  });
  return { verdict, policy, checks: decided.checks, evidence: loaded };
}

// ---------------------------------------------------------------------------------------------
interface Decided {
  decision: Verdict["decision"];
  confidence: number;
  checks: VerifyMilestoneResult["checks"];
}

/** Map check outcomes through the policy: deterministic fails decide; low LLM confidence -> human. */
export function decide(outcomes: CheckOutcome[], policy: VerificationPolicy): Decided {
  const checks = outcomes.map((o) => {
    const rule = policy.checks[o.check as MilestoneCheckName];
    let escalation: Escalation | "none" = "none";
    if (!rule || !rule.enabled || o.result === "skipped" || o.result === "pass") {
      // An LLM "pass" we don't trust is still a reason to ask a human.
      if (o.result === "pass" && o.source !== "deterministic" && o.confidence < policy.thresholds.minLlmConfidence) {
        escalation = "needs_human";
      }
    } else if (o.source !== "deterministic" && o.confidence < policy.thresholds.minLlmConfidence) {
      escalation = "needs_human"; // low-confidence model judgment never hard-fails or passes on its own
    } else {
      escalation = o.result === "fail" ? rule.onFail : rule.onWarn;
    }
    return { ...o, escalation };
  });

  const failing = checks.filter((c) => c.escalation === "fail");
  const human = checks.filter((c) => c.escalation === "needs_human");
  const counted = checks.filter((c) => c.result !== "skipped");
  let decision: Verdict["decision"];
  let confidence: number;
  if (failing.length) {
    decision = "fail";
    confidence = Math.max(...failing.map((c) => c.confidence));
  } else if (human.length || !policy.allowAutoPass) {
    decision = "needs_human";
    confidence = human.length ? Math.min(...human.map((c) => c.confidence)) : 0.5;
  } else {
    decision = "pass";
    confidence = counted.length ? Math.min(...counted.map((c) => c.confidence)) : 0.5;
  }
  return { decision, confidence: round2(confidence), checks };
}

function summarize(d: Decided, policy: VerificationPolicy): string {
  const insp = `${policy.requiredInspectors} inspector${policy.requiredInspectors > 1 ? "s" : ""}`;
  const strip = (s: string) => s.replace(/\s*\[catches lazy fraud only[^\]]*\]/, "").replace(/^\[mock\]\s*/, "");
  if (d.decision === "fail") {
    const f = d.checks.filter((c) => c.escalation === "fail");
    return `FAIL — ${f.length} blocking issue${f.length > 1 ? "s" : ""}: ${f.map((c) => `${c.check}: ${strip(c.reason)}`).join(" | ")} Funds stay locked in escrow.`;
  }
  if (d.decision === "needs_human") {
    const h = d.checks.filter((c) => c.escalation === "needs_human");
    const why = h.length ? h.map((c) => `${c.check}: ${strip(c.reason)}`).join(" | ") : "policy does not allow an automatic pass for this builder.";
    return `NEEDS HUMAN — ${why} Routed to ${insp} for review.`;
  }
  const n = d.checks.filter((c) => c.result === "pass").length;
  const total = d.checks.filter((c) => c.result !== "skipped").length;
  return `PASS — ${n}/${total} checks passed; evidence is consistent (place, time, originality, documents, budget). Still requires ${insp} to confirm quality before release.`;
}
