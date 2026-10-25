import { CheckResult, MILESTONE_CHECKS as REQUIRED_SUITE, ReleasePolicy, Verdict } from "@xrlp/shared";
import {
  checkGpsWithinSite,
  checkInvoiceMatchesBudget,
  checkLienWaiverPresent,
  checkLienWaivers,
  checkNoDuplicatePhoto,
  checkPhotoFresh,
  checkRequiredEvidence,
} from "./checks.ts";
import { resolveMode, resolveModel } from "./config.ts";
import { checkInspectorAudits } from "./auditChecks.ts";
import { withDeadline } from "./deadline.ts";
import { milestoneTemplate } from "./template.ts";
import { MockJudge } from "./llm/mock.ts";
import { unavailableJudgement, type MilestoneJudge, type MilestoneJudgement } from "./llm/types.ts";
import { loadEvidence } from "./meta.ts";
import { policyFor, releasePolicyFor, type Escalation, type VerificationPolicy } from "./policy.ts";
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
  timeoutMs?: number;
  cacheDir?: string | false;
}

/**
 * Live judge is loaded lazily so mock mode never imports @anthropic-ai/sdk
 * (no key, no network, no SDK needed for teammates running the demo).
 */
export async function createLiveJudge(model = resolveModel(), options: { timeoutMs?: number; cacheDir?: string | false } = {}): Promise<MilestoneJudge> {
  const { LiveJudge } = await import("./llm/live.ts");
  return new LiveJudge(model, undefined, options);
}

export async function verifyMilestone(input: VerifyMilestoneInput, opts: VerifyOptions = {}): Promise<Verdict> {
  return (await verifyMilestoneDetailed(input, opts)).verdict;
}

export async function verifyMilestoneDetailed(input: VerifyMilestoneInput, opts: VerifyOptions = {}): Promise<VerifyMilestoneResult> {
  const { project, builder, milestone } = input;
  const timeline = { ...(input.escrowCreatedAt ? { escrowCreatedAt: input.escrowCreatedAt } : {}), ...input.timeline };
  const template = milestoneTemplate(input);
  const prior: PriorEvidence[] = (input.priorEvidence ?? [])
    .map((p) => ("evidence" in p ? p : { evidence: p, projectId: "unknown", milestoneId: "unknown" }));
  const ctx: MilestoneContext = { project, builder, milestone, template, riskTier: builder.riskTier };
  const policy = policyFor(project, builder, milestone);
  const standard = releasePolicyFor(project, milestone, builder.riskTier);
  const requested = input.policy ? ReleasePolicy.parse(input.policy) : standard;
  // A caller policy may tighten the baseline but cannot remove required gates or lower thresholds.
  const release: ReleasePolicy = {
    riskTier: standard.riskTier,
    requiredChecks: [...new Set([...standard.requiredChecks, ...requested.requiredChecks, "evidence_readable"])],
    optionalChecks: [...new Set([...standard.optionalChecks, ...requested.optionalChecks])].filter((check) => !standard.requiredChecks.includes(check) && !requested.requiredChecks.includes(check)),
    minConfidence: Math.max(standard.minConfidence, requested.minConfidence),
    requiredAudits: Math.max(standard.requiredAudits, requested.requiredAudits) as 1 | 2,
  };
  policy.requiredInspectors = release.requiredAudits;
  policy.thresholds.minLlmConfidence = policy.minConfidence = Math.max(policy.minConfidence, release.minConfidence);

  const loaded = await Promise.all(input.evidence.map((ev) => loadEvidence(ev, { files: input.files, dataDir: input.dataDir })));
  const previousMilestone = project.milestones
    .filter((candidate) => candidate.index < milestone.index)
    .sort((a, b) => b.index - a.index)[0];
  const previousInvoiceRecords = previousMilestone
    ? prior.filter((record) => record.projectId === project.id
      && record.milestoneId === previousMilestone.id
      && record.evidence.kind === "invoice")
    : [];
  const previousInvoices = await Promise.all(previousInvoiceRecords.map((record) =>
    loadEvidence(record.evidence, { files: input.files, dataDir: input.dataDir })));
  const photos = loaded.filter((l) => l.evidence.kind === "photo" && l.bytes);
  const documents = loaded.filter((l) => (l.evidence.kind === "invoice" || l.evidence.kind === "document") && l.bytes);
  const inspectorPhotos = await Promise.all((input.audits ?? []).flatMap((audit) => audit.photos).map((ev) => loadEvidence(ev, { files: input.files, dataDir: input.dataDir })));
  const unreadable = [...loaded, ...inspectorPhotos].filter((ev) => ev.loadError || !ev.bytes);

  const mode = resolveMode(input.mode);
  const judgeInput = { ctx, photos, documents, timeline, audits: input.audits, inspectorPhotos };
  let judgement: MilestoneJudgement;
  try {
    if (unreadable.length) throw new Error("Unreadable evidence.");
    const judge = opts.judge ?? (mode === "live" ? await createLiveJudge(resolveModel(input.model), opts) : new MockJudge());
    judgement = await withDeadline(() => judge.judgeMilestone(judgeInput), opts.timeoutMs ?? 20_000);
    for (const [expected, check] of [["stage_visually_consistent", judgement.stage], ["document_consistency", judgement.documents], ["audit_matches_evidence", judgement.audit]] as const) {
      if (!check || check.check !== expected || !Number.isFinite(check.confidence) || check.confidence < 0 || check.confidence > 1) throw new Error("Malformed judgement.");
      CheckResult.parse(check);
    }
  } catch {
    judgement = unavailableJudgement("image, model or transport review did not complete", mode === "mock" ? "mock" : resolveModel(input.model), judgeInput);
  }

  const outcomes: CheckOutcome[] = [
    checkRequiredEvidence(template, loaded, milestone.templateKey),
    checkGpsWithinSite(ctx, loaded, policy),
    checkPhotoFresh(loaded, timeline, policy),
    checkNoDuplicatePhoto(ctx, loaded, prior, policy),
    checkInvoiceMatchesBudget(ctx, loaded, policy, judgement.invoiceTotals),
    checkLienWaiverPresent(loaded, previousInvoices, { previousRequired: !!previousMilestone }),
    checkLienWaivers(loaded, previousInvoices),
    ...checkInspectorAudits(input, loaded, policy.requiredInspectors),
    judgement.stage,
    judgement.documents,
    judgement.audit ?? { check: "audit_matches_evidence", result: "warn", confidence: 0, source: "llm", evidenceIds: [], reason: "Audit/evidence judgement unavailable; operator review required." },
    { check: "evidence_readable", result: unreadable.length ? "warn" : "pass", confidence: unreadable.length ? 0 : 0.99, source: "deterministic", evidenceIds: unreadable.map((ev) => ev.evidence.id), reason: unreadable.length ? "Evidence could not be decoded/read; operator review required." : "Builder and inspector evidence decoded successfully." },
  ];

  const decided = decide(outcomes, policy, release);
  if (unreadable.length) { decided.decision = "needs_human"; decided.confidence = 0; }
  const verdict = Verdict.parse({
    milestoneId: milestone.id,
    decision: decided.decision,
    confidence: decided.confidence,
    summary: summarize(decided, policy),
    checks: outcomes.map((o) => CheckResult.parse({ check: o.check, result: o.result, reason: o.reason, evidenceIds: o.evidenceIds })),
    policy: { projectType: project.type, riskTier: builder.riskTier, requiredInspectors: policy.requiredInspectors },
    model: judgement.model,
    createdAt: timeline.now ?? new Date().toISOString(),
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
export function decide(outcomes: CheckOutcome[], policy: VerificationPolicy, release: ReleasePolicy = {
  riskTier: policy.riskTier, requiredChecks: [...REQUIRED_SUITE, "evidence_readable"],
  optionalChecks: ["lien_waiver_present", "lien_waiver_matches_invoices"], minConfidence: policy.minConfidence,
  requiredAudits: policy.requiredInspectors,
}): Decided {
  const complete = [...outcomes];
  for (const required of release?.requiredChecks ?? []) {
    if (!complete.some((outcome) => outcome.check === required)) complete.push({ check: required, result: "warn", reason: "Required check result missing; operator review required.", evidenceIds: [], confidence: 0, source: "deterministic" });
  }
  const checks = complete.map((o) => {
    const rule = policy.checks[o.check as MilestoneCheckName];
    let escalation: Escalation | "none" = "none";
    if (release?.requiredChecks.includes(o.check)) {
      escalation = o.result === "fail" ? "fail" : o.result !== "pass" || !Number.isFinite(o.confidence) || o.confidence < release.minConfidence ? "needs_human" : "none";
    } else if (release?.optionalChecks.includes(o.check)) {
      escalation = "none";
    } else if (!rule || !rule.enabled || o.result === "skipped" || o.result === "pass") {
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
  const counted = checks.filter((c) => c.result !== "skipped" && (!release || release.requiredChecks.includes(c.check)));
  let decision: Verdict["decision"];
  let confidence: number;
  if (failing.length) {
    decision = "fail";
    confidence = Math.max(...failing.map((c) => c.confidence));
  } else if (human.length || !policy.allowAutoPass || !counted.length) {
    decision = "needs_human";
    confidence = human.length ? Math.min(...human.map((c) => c.confidence)) : 0.5;
  } else {
    decision = "pass";
    confidence = counted.length ? Math.min(...counted.map((c) => c.confidence)) : 0.5;
  }
  return { decision, confidence: round2(confidence), checks };
}

function summarize(d: Decided, policy: VerificationPolicy): string {
  const strip = (s: string) => s.replace(/\s*\[catches lazy fraud only[^\]]*\]/, "").replace(/^\[mock\]\s*/, "");
  if (d.decision === "fail") {
    const f = d.checks.filter((c) => c.escalation === "fail");
    return `FAIL — ${f.length} blocking issue${f.length > 1 ? "s" : ""}: ${f.map((c) => `${c.check}: ${strip(c.reason)}`).join(" | ")} Funds stay locked in escrow.`;
  }
  if (d.decision === "needs_human") {
    const h = d.checks.filter((c) => c.escalation === "needs_human");
    const why = h.length ? h.map((c) => `${c.check}: ${strip(c.reason)}`).join(" | ") : "policy does not allow an automatic pass for this builder.";
    return `NEEDS HUMAN — ${why} A platform operator must review and record a signed decision.`;
  }
  const n = d.checks.filter((c) => c.result === "pass").length;
  const total = d.checks.filter((c) => c.result !== "skipped").length;
  return `PASS — ${n}/${total} checks passed, including the required assigned inspector audits. Core must attest this verdict and run release safety checks before releasing funds.`;
}
