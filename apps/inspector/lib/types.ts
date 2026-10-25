// Contract types for the inspector app. Domain schemas come from @xrlp/shared (CORE-01). Shared only has TS interfaces for the
// read models (ProjectDetail, InspectorTask, snapshots), so their runtime schemas live here, each typed as
// z.ZodType<shared interface> — if shared changes, typecheck fails here instead of the app drifting silently.
// Keep this file Node-runnable (no "@/" imports) — test/*.test.ts load it directly.
import { z } from "zod";
import type * as shared from "@xrlp/shared";
import {
  Attestation,
  Builder,
  ChainEvent,
  CheckResult,
  ChecksStatus,
  ErrorCode,
  Evidence,
  Inspector,
  InspectorAudit,
  Investment,
  Milestone,
  Project,
  ProjectVerification,
  Rlusd,
  SovLine,
  Verdict,
  XrplAddress,
} from "@xrlp/shared";

export {
  Attestation,
  Builder,
  ChainEvent,
  CheckResult,
  ChecksStatus,
  ErrorCode,
  Evidence,
  Inspector,
  InspectorAudit,
  Investment,
  Milestone,
  Project,
  ProjectVerification,
  Rlusd,
  SovLine,
  Verdict,
  XrplAddress,
};
export type { EvidenceRequirement, MilestoneStatus, ProjectStatus } from "@xrlp/shared";

type Schema<T> = z.ZodType<T, z.ZodTypeDef, unknown>;

export type SiteGeo = Project["siteGeo"];
export type ChecklistStatus = InspectorAudit["checklist"][number]["status"];

export const TaskNeeds = z.enum(["pre_visit", "audit", "re_audit", "none"]);
export type TaskNeeds = z.infer<typeof TaskNeeds>;

// ---------- route 18 ----------

export type InspectorTask = shared.InspectorTask;
export const InspectorTask: Schema<InspectorTask> = z.object({
  projectId: z.string(),
  projectName: z.string(),
  milestone: Milestone.optional(),
  sov: z.array(SovLine),
  evidence: z.array(Evidence),
  needs: TaskNeeds,
  siteGeo: Project.shape.siteGeo,
  priorAudits: z.array(InspectorAudit),
});

// ---------- route 2 ----------

export type VaultSnapshot = shared.VaultSnapshot;
export const VaultSnapshot: Schema<VaultSnapshot> = z.object({
  assetsTotal: Rlusd,
  assetsAvailable: Rlusd,
  sharesOutstanding: z.string(),
  sharePrice: z.string(),
  subscriptionDate: z.string(),
  redemptionDate: z.string(),
  phase: z.enum(["subscription", "investment", "redemption"]),
});

export type LoanSnapshot = shared.LoanSnapshot;
export const LoanSnapshot: Schema<LoanSnapshot> = z.object({
  principalOutstanding: Rlusd,
  totalValueOutstanding: Rlusd,
  periodicPayment: Rlusd,
  paymentRemaining: z.number().int().nonnegative(),
  nextPaymentDueDate: z.string(),
});

export type ProjectDetail = shared.ProjectDetail;
export const ProjectDetail: Schema<ProjectDetail> = z.object({
  project: Project,
  builder: Builder,
  verification: ProjectVerification.optional(),
  inspectors: z.array(Inspector),
  investments: z.array(Investment),
  events: z.array(ChainEvent),
  checks: z.record(z.string(), ChecksStatus),
  audits: z.record(z.string(), z.array(InspectorAudit)),
  attestations: z.record(z.string(), z.array(Attestation)),
  vault: VaultSnapshot.optional(),
  loan: LoanSnapshot.optional(),
});

// ---------- route 10 ----------

export type SubmitAuditResult = { milestone: Milestone; audit: InspectorAudit; events: ChainEvent[] };
export const SubmitAuditResult: Schema<SubmitAuditResult> = z.object({
  milestone: Milestone,
  audit: InspectorAudit,
  events: z.array(ChainEvent),
});

// ---------- errors (05-api §1) ----------

export const ErrorBody = z.object({
  error: z.object({ code: ErrorCode, message: z.string(), txResult: z.string().optional(), txHash: z.string().optional() }),
});
