// PROVISIONAL v2 contract, transcribed from docs/05-api.md §1–2 and the CORE-01 issue (#53) because @xrlp/shared on main is
// still v1. When CORE-01 merges: replace each schema below with the @xrlp/shared export of the same name and delete it here.
// Shapes 05-api does not spell out (Inspector, SovLine.evidence, Milestone.sovCodes, Project.sov) are marked ASSUMED and were
// posted on #53. Keep this file Node-runnable (no "@/" imports) — test/*.test.ts load it directly.
import { z } from "zod";
import {
  Builder,
  CheckResult,
  ChainEvent as ChainEventV1,
  Attestation as AttestationV1,
  Evidence,
  Investment,
  LoanTerms,
  ProjectType,
  RiskTier,
  Rlusd,
  Verdict,
  XrplAddress,
} from "@xrlp/shared";

export { Builder, CheckResult, Evidence, Investment, Rlusd, Verdict, XrplAddress };

const IsoTime = z.string().datetime();

// ---------- v2 states (#53) ----------

export const MilestoneStatus = z.enum([
  "pending",
  "escrowed",
  "evidence_submitted",
  "audited",
  "verified",
  "failed",
  "needs_human",
  "released",
  "expired",
  "refunded",
]);
export type MilestoneStatus = z.infer<typeof MilestoneStatus>;

export const ProjectStatus = z.enum([
  "draft",
  "verifying",
  "verified",
  "rejected",
  "terms_locked",
  "funding",
  "funded",
  "escrowed",
  "repaying",
  "completed",
  "stalled",
]);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

export const ChainEvent = ChainEventV1.extend({
  kind: z.enum([
    ...ChainEventV1.shape.kind.options,
    "verification_fee_paid",
    "project_verified",
    "inspector_assigned",
    "audit_attested",
    "verdict_attested",
    "decision_attested",
    "cover_deposited",
    "credential_accepted",
    "loan_default",
    "release_refused",
  ]),
});
export type ChainEvent = z.infer<typeof ChainEvent>;

export const Attestation = AttestationV1.extend({ role: z.enum([...AttestationV1.shape.role.options, "release_service"]) });
export type Attestation = z.infer<typeof Attestation>;

// ---------- Schedule of Values ----------

/** ASSUMED: same shape as MilestoneTemplate.requiredEvidence in @xrlp/shared. */
export const EvidenceRequirement = z.object({
  kind: z.enum(["photo", "invoice", "document"]),
  description: z.string(),
  minCount: z.number().int().positive(),
});
export type EvidenceRequirement = z.infer<typeof EvidenceRequirement>;

export const SovLine = z.object({
  code: z.string(),
  title: z.string(),
  amount: Rlusd,
  trade: z.string(),
  evidence: z.array(EvidenceRequirement),
  visualCriteria: z.array(z.string()),
});
export type SovLine = z.infer<typeof SovLine>;

// ---------- project + milestone (v1 shapes with v2 status; ASSUMED: sovCodes / sov link milestones to SoV lines) ----------

export const Milestone = z.object({
  id: z.string(),
  index: z.number().int().nonnegative(),
  title: z.string(),
  amount: Rlusd,
  sovCodes: z.array(z.string()),
  requiredInspectors: z.number().int().min(1).max(2),
  status: MilestoneStatus,
  cancelAfter: IsoTime.optional(),
  escrow: z
    .object({
      owner: XrplAddress,
      offerSequence: z.number().int(),
      condition: z.string(),
      createTx: z.string(),
      finishTx: z.string().optional(),
      cancelTx: z.string().optional(),
    })
    .optional(),
});
export type Milestone = z.infer<typeof Milestone>;

export const SiteGeo = z.object({ lat: z.number(), lng: z.number(), radiusM: z.number().positive() });
export type SiteGeo = z.infer<typeof SiteGeo>;

export const Project = z.object({
  id: z.string(),
  name: z.string(),
  type: ProjectType,
  builderId: z.string(),
  siteAddress: z.string(),
  siteGeo: SiteGeo,
  description: z.string(),
  terms: LoanTerms,
  status: ProjectStatus,
  sov: z.array(SovLine),
  milestones: z.array(Milestone),
  chain: z
    .object({
      spv: XrplAddress.optional(),
      vaultId: z.string().optional(),
      loanBrokerId: z.string().optional(),
      loanId: z.string().optional(),
      shareMptIssuanceId: z.string().optional(),
    })
    .default({}),
});
export type Project = z.infer<typeof Project>;

/** ASSUMED (05-api names `Inspector` without a shape): mirrors `Builder` — `verified` + `credentialTx` = VERIFIED_INSPECTOR. */
export const Inspector = z.object({
  address: XrplAddress,
  name: z.string(),
  licenseNumber: z.string(),
  firm: z.string(),
  region: z.string(),
  trades: z.array(z.string()),
  verified: z.boolean(),
  credentialTx: z.string().optional(),
});
export type Inspector = z.infer<typeof Inspector>;

// ---------- the inspector's deliverable ----------

export const ChecklistStatus = z.enum(["done", "partial", "not_done"]);
export type ChecklistStatus = z.infer<typeof ChecklistStatus>;

export const InspectorAudit = z.object({
  milestoneId: z.string(),
  inspector: XrplAddress,
  evidenceBundleHash: z.string(),
  checklist: z.array(z.object({ sovCode: z.string(), status: ChecklistStatus, note: z.string().optional() })),
  photos: z.array(Evidence),
  notes: z.string(),
  txHash: z.string().optional(),
  at: IsoTime,
});
export type InspectorAudit = z.infer<typeof InspectorAudit>;

export const TaskNeeds = z.enum(["pre_visit", "audit", "re_audit", "none"]);
export type TaskNeeds = z.infer<typeof TaskNeeds>;

export const InspectorTask = z.object({
  projectId: z.string(),
  projectName: z.string(),
  milestone: Milestone.optional(),
  sov: z.array(SovLine),
  evidence: z.array(Evidence),
  needs: TaskNeeds,
  siteGeo: SiteGeo,
  priorAudits: z.array(InspectorAudit),
});
export type InspectorTask = z.infer<typeof InspectorTask>;

// ---------- route 2 read model ----------

const Section = z.array(CheckResult);

export const ProjectVerification = z.object({
  identity: Section,
  feasibility: Section,
  capability: Section,
  decision: z.enum(["pass", "fail", "needs_human"]),
  riskTier: RiskTier,
  summary: z.string(),
  model: z.string(),
  createdAt: IsoTime,
});
export type ProjectVerification = z.infer<typeof ProjectVerification>;

export const ChecksStatus = z.object({
  required: z.array(CheckResult),
  optional: z.array(CheckResult),
  verdict: Verdict.optional(),
  outcome: z.enum(["pending", "pass", "fail", "needs_human"]),
});
export type ChecksStatus = z.infer<typeof ChecksStatus>;

export const VaultSnapshot = z.object({
  assetsTotal: Rlusd,
  assetsAvailable: Rlusd,
  sharesOutstanding: z.string(),
  sharePrice: z.string(),
  subscriptionDate: IsoTime,
  redemptionDate: IsoTime,
  phase: z.enum(["subscription", "investment", "redemption"]),
});
export type VaultSnapshot = z.infer<typeof VaultSnapshot>;

export const LoanSnapshot = z.object({
  principalOutstanding: Rlusd,
  totalValueOutstanding: Rlusd,
  periodicPayment: Rlusd,
  paymentRemaining: z.number().int().nonnegative(),
  nextPaymentDueDate: IsoTime,
});
export type LoanSnapshot = z.infer<typeof LoanSnapshot>;

export const ProjectDetail = z.object({
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
export type ProjectDetail = z.infer<typeof ProjectDetail>;

// ---------- route 10 ----------

export const SubmitAuditResult = z.object({ milestone: Milestone, audit: InspectorAudit, events: z.array(ChainEvent) });
export type SubmitAuditResult = z.infer<typeof SubmitAuditResult>;

// ---------- errors (05-api §1) ----------

export const ErrorCode = z.enum([
  "not_found",
  "invalid_state",
  "validation",
  "checks_failed",
  "needs_human",
  "too_soon",
  "ledger_error",
  "verifier_error",
  "unsafe_release",
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

export const ErrorBody = z.object({
  error: z.object({ code: ErrorCode, message: z.string(), txResult: z.string().optional(), txHash: z.string().optional() }),
});
