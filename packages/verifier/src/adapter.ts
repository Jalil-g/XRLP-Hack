import { Verdict, type Builder, type InspectorAssignment, type Milestone, type Project, type ReleasePolicy, type RiskTier, type VerifierPort } from "@xrlp/shared";
import { assignInspector, type AssignInspectorInput } from "./assignInspector.ts";
import { resolveMode, resolveModel } from "./config.ts";
import { verdictHash } from "./hash.ts";
import type { MilestoneJudge } from "./llm/types.ts";
import { policyFor, releasePolicyFor, type VerificationPolicy } from "./policy.ts";
import { verifyBuilder, type VerifyBuilderInput } from "./verifyBuilder.ts";
import { verifyMilestone } from "./verifyMilestone.ts";
import { verifyProject, type ProjectHistory, type ProjectVerifyOptions, type VerifyProjectInput } from "./verifyProject.ts";
import type { VerifierMode, VerifyMilestoneInput } from "./types.ts";

export interface AdapterOptions {
  mode?: VerifierMode; model?: string; dataDir?: string; now?: () => string;
  /** Server-owned lock-terms assignments and history. Never populate from submitted audit notes. */
  assignedInspectors?: (project: Project) => readonly string[];
  history?: (project: Project) => ProjectHistory | undefined;
  riskTier?: (project: Project) => RiskTier;
  registry?: VerifyBuilderInput["registry"];
  judge?: MilestoneJudge;
  projectJudge?: ProjectVerifyOptions["judge"];
}

/** Shared v2 port. Legacy core-shaped calls are accepted but cannot bypass mandatory audit context. */
export class ClaudeVerifierAdapter implements VerifierPort {
  readonly mode: VerifierMode;
  private readonly risks = new Map<string, RiskTier>();
  constructor(private readonly options: AdapterOptions = {}) { this.mode = resolveMode(options.mode); }

  async verifyProject(input: VerifyProjectInput) {
    const result = await verifyProject({ ...input, mode: this.mode, model: this.options.model, dataDir: input.dataDir ?? this.options.dataDir,
      now: input.now ?? this.options.now?.(), registry: input.registry ?? this.options.registry,
      history: this.options.history?.(input.project) ?? input.history }, { judge: this.options.projectJudge });
    this.risks.set(input.project.id, result.decision === "pass" ? result.riskTier : "high");
    return result;
  }

  assignInspector(input: AssignInspectorInput): Promise<InspectorAssignment> { return assignInspector(input); }

  policyFor(project: Project, milestone: Milestone): ReleasePolicy;
  /** Compatibility overload for core's old local port; v2 consumers use two arguments. */
  policyFor(project: Project, builder: Builder, milestone: Milestone): VerificationPolicy;
  policyFor(project: Project, second: Milestone | Builder, third?: Milestone): ReleasePolicy | VerificationPolicy {
    if (third) return policyFor(project, second as Builder, third);
    return releasePolicyFor(project, second as Milestone, this.risks.get(project.id) ?? this.options.riskTier?.(project) ?? "high");
  }

  verdictHash(verdict: Verdict): string { return verdictHash(verdict); }

  async verifyBuilder(input: VerifyBuilderInput) {
    return verifyBuilder({ ...input, registry: input.registry ?? this.options.registry, dataDir: input.dataDir ?? this.options.dataDir, now: input.now ?? this.options.now?.() });
  }

  async verifyMilestone(input: VerifyMilestoneInput): Promise<Verdict> {
    const now = input.timeline?.now ?? this.options.now?.() ?? new Date().toISOString();
    try {
      return await verifyMilestone({ ...input, mode: this.mode, model: this.options.model,
        dataDir: input.dataDir ?? this.options.dataDir,
        assignedInspectors: this.options.assignedInspectors?.(input.project) ?? input.assignedInspectors,
        timeline: { ...input.timeline, now } }, { judge: this.options.judge });
    } catch {
      let requiredInspectors: 1 | 2 = 2;
      try { requiredInspectors = releasePolicyFor(input.project, input.milestone, input.builder.riskTier).requiredAudits; } catch { /* unknown risk/amount stays conservative */ }
      return Verdict.parse({ milestoneId: input.milestone.id, decision: "needs_human", confidence: 0,
        summary: "Verifier unavailable or evidence malformed; funds must remain locked pending operator review.",
        checks: [{ check: "verifier_available", result: "warn", reason: "Verification did not complete; never treat an exception as pass.", evidenceIds: [] }],
        policy: { projectType: input.project.type, riskTier: input.builder.riskTier, requiredInspectors },
        model: this.mode === "mock" ? "mock" : resolveModel(this.options.model), createdAt: Number.isFinite(Date.parse(now)) ? now : new Date().toISOString() });
    }
  }
}
