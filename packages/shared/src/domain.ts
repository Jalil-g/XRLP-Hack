// Core domain types. THE CONTRACT between packages — change via PR, announce in team chat.
import { z } from "zod";

export const XrplAddress = z.string().regex(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/);
export type XrplAddress = z.infer<typeof XrplAddress>;

/** Amount as a decimal string in RLUSD units, e.g. "25000.00". Never use floats for money. */
export const Rlusd = z.string().regex(/^\d+(\.\d{1,6})?$/);
export type Rlusd = z.infer<typeof Rlusd>;

export const ProjectType = z.enum(["residential_new", "residential_renovation", "commercial_small"]);
export type ProjectType = z.infer<typeof ProjectType>;

export const RiskTier = z.enum(["low", "medium", "high"]);
export type RiskTier = z.infer<typeof RiskTier>;

/** What a milestone / SoV line must be proven with. Mirrors MilestoneTemplate.requiredEvidence. */
export const EvidenceRequirement = z.object({
  kind: z.enum(["photo", "invoice", "document"]),
  description: z.string(),
  minCount: z.number().int().positive(),
});
export type EvidenceRequirement = z.infer<typeof EvidenceRequirement>;

/** One Schedule of Values line (AIA G702/G703). Milestones are built from SoV lines; templates are pre-filled SoVs. */
export const SovLine = z.object({
  code: z.string(), // e.g. "03-300" (CSI-style) or template key
  title: z.string(),
  amount: Rlusd,
  trade: z.string(), // e.g. "concrete", "framing"
  evidence: z.array(EvidenceRequirement),
  visualCriteria: z.array(z.string()),
});
export type SovLine = z.infer<typeof SovLine>;

export const Builder = z.object({
  id: z.string(),
  name: z.string(),
  address: XrplAddress,
  licenseNumber: z.string(),
  insurancePolicy: z.string(),
  completedProjects: z.number().int().nonnegative(),
  riskTier: RiskTier,
  verified: z.boolean(),
  credentialTx: z.string().optional(), // CredentialCreate tx hash (VERIFIED_BUILDER)
});
export type Builder = z.infer<typeof Builder>;

/** v2 milestone lifecycle (docs/03-architecture.md §State machines). */
export const MILESTONE_STATUSES_V2 = [
  "pending", // before escrow exists
  "escrowed", // escrow created on-chain, awaiting evidence
  "evidence_submitted",
  "audited", // assigned inspector's signed audit attested on-chain
  "verified", // test suite passed (or operator approved needs_human); release service finishing
  "failed", // a required check failed; resubmit evidence or re-audit
  "needs_human", // platform operator decides with a signed reason
  "released", // EscrowFinish succeeded
  "expired", // CancelAfter passed
  "refunded", // EscrowCancel succeeded
] as const;
/** @deprecated v1 only (old quorum model). Removed once core (CORE-03) and web stop emitting them. */
export const LEGACY_MILESTONE_STATUSES = ["ai_reviewed", "inspected", "rejected"] as const;

// Superset while lanes migrate, so v1 data still parses. New code should only use MILESTONE_STATUSES_V2.
export const MilestoneStatus = z.enum([...MILESTONE_STATUSES_V2, ...LEGACY_MILESTONE_STATUSES]);
export type MilestoneStatus = z.infer<typeof MilestoneStatus>;
export type MilestoneStatusV2 = (typeof MILESTONE_STATUSES_V2)[number];

export const Milestone = z.object({
  id: z.string(),
  index: z.number().int().nonnegative(),
  templateKey: z.string(), // key into MILESTONE_TEMPLATES[projectType]
  title: z.string(),
  amount: Rlusd,
  requiredInspectors: z.number().int().min(1).max(2),
  status: MilestoneStatus,
  /** SoV line codes this milestone pays for (v2). */
  sovCodes: z.array(z.string()).optional(),
  cancelAfter: z.string().datetime().optional(), // ISO
  escrow: z
    .object({
      owner: XrplAddress, // SPV
      offerSequence: z.number().int(), // sequence of EscrowCreate
      condition: z.string(), // hex PREIMAGE-SHA-256 condition
      createTx: z.string(),
      createdAt: z.string().datetime().optional(), // EscrowCreate validation time (photo freshness)
      finishTx: z.string().optional(),
      cancelTx: z.string().optional(),
    })
    .optional(),
});
export type Milestone = z.infer<typeof Milestone>;

/** v2 project lifecycle (docs/03-architecture.md §State machines). Purely additive over v1. */
export const ProjectStatus = z.enum([
  "draft",
  "verifying", // verification fee paid, AI project verification running
  "verified", // listed on the marketplace
  "rejected", // verification failed
  "terms_locked",
  "funding",
  "funded",
  "escrowed", // loan closed + escrows created (only after SubscriptionDate)
  "repaying",
  "completed",
  "stalled", // a milestone was refunded; other milestones continue
]);
export type ProjectStatus = z.infer<typeof ProjectStatus>;

export const LoanTerms = z.object({
  principal: Rlusd,
  interestRateBps: z.number().int().nonnegative(), // annual, basis points
  termDays: z.number().int().positive(),
  paymentIntervalDays: z.number().int().positive(),
  fundingDeadline: z.string().datetime(),
});
export type LoanTerms = z.infer<typeof LoanTerms>;

export const Project = z.object({
  id: z.string(),
  name: z.string(),
  type: ProjectType,
  builderId: z.string(),
  siteAddress: z.string(),
  siteGeo: z.object({ lat: z.number(), lng: z.number(), radiusM: z.number().positive() }),
  description: z.string(),
  terms: LoanTerms,
  status: ProjectStatus,
  milestones: z.array(Milestone),
  /** Schedule of Values (v2). Milestones reference lines by code. */
  sov: z.array(SovLine).optional(),
  chain: z
    .object({
      spv: XrplAddress.optional(),
      vaultId: z.string().optional(),
      loanBrokerId: z.string().optional(),
      loanId: z.string().optional(),
      shareMptIssuanceId: z.string().optional(),
      subscriptionDate: z.string().datetime().optional(), // Vault.SubscriptionDate = terms.fundingDeadline
      redemptionDate: z.string().datetime().optional(), // Vault.RedemptionDate = maturity + buffer
    })
    .default({}),
});
export type Project = z.infer<typeof Project>;

/** Licensed inspector on the verified panel (holds a VERIFIED_INSPECTOR credential). */
export const Inspector = z.object({
  address: XrplAddress,
  name: z.string(),
  licenseNumber: z.string(),
  trades: z.array(z.string()).default([]), // e.g. ["residential", "concrete"]
  homeGeo: z.object({ lat: z.number(), lng: z.number() }).optional(), // for assignment distance
  verified: z.boolean(),
  credentialTx: z.string().optional(), // CredentialCreate tx hash (VERIFIED_INSPECTOR)
});
export type Inspector = z.infer<typeof Inspector>;

export const Investment = z.object({
  projectId: z.string(),
  investor: XrplAddress,
  amount: Rlusd,
  tx: z.string(),
  at: z.string().datetime(),
});
export type Investment = z.infer<typeof Investment>;

/** Every on-chain action we surface in the UI / audit trail. */
export const ChainEvent = z.object({
  projectId: z.string(),
  milestoneId: z.string().optional(),
  kind: z.enum([
    "credential_issued",
    "vault_created",
    "vault_deposit",
    "loan_broker_created",
    "loan_set",
    "escrow_created",
    "approval_attested", // v1 (quorum model); v2 uses audit/verdict/decision_attested
    "escrow_finished",
    "escrow_cancelled",
    "loan_payment",
    "vault_withdraw",
    // v2
    "verification_fee_paid",
    "project_verified",
    "inspector_assigned",
    "audit_attested",
    "verdict_attested",
    "decision_attested",
    "cover_deposited",
    "credential_accepted",
    "loan_default",
    "release_refused", // e.g. try-steal EscrowFinish rejected with tecCRYPTOCONDITION_ERROR
    // v2.1 (#133)
    "release_attested", // release service's attestation before EscrowFinish (replaces approval_attested for releases)
    "loan_impaired", // LoanManage tfLoanImpair / tfLoanUnimpair (paper loss booked or reversed; not a default)
    "builder_payment", // builder -> SPV RLUSD Payment that funds a LoanPay
  ]),
  txHash: z.string(),
  explorerUrl: z.string().url(),
  /** Engine result when not tesSUCCESS (tec* results are recorded on-ledger). */
  result: z.string().optional(),
  actor: XrplAddress.optional(),
  amount: Rlusd.optional(),
  at: z.string().datetime(),
});
export type ChainEvent = z.infer<typeof ChainEvent>;

export type ChainEventKind = ChainEvent["kind"];

export const explorerTxUrl = (hash: string) => `https://devnet.xrpl.org/transactions/${hash}`;
