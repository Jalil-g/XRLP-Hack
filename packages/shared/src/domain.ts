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

export const MilestoneStatus = z.enum([
  "pending", // before escrow exists
  "escrowed", // escrow created on-chain, awaiting evidence
  "evidence_submitted",
  "ai_reviewed",
  "inspected",
  "released", // EscrowFinish succeeded
  "rejected", // AI or inspector rejected; builder may resubmit
  "expired", // CancelAfter passed
  "refunded", // EscrowCancel succeeded
]);
export type MilestoneStatus = z.infer<typeof MilestoneStatus>;

export const Milestone = z.object({
  id: z.string(),
  index: z.number().int().nonnegative(),
  templateKey: z.string(), // key into MILESTONE_TEMPLATES[projectType]
  title: z.string(),
  amount: Rlusd,
  requiredInspectors: z.number().int().min(1).max(2),
  status: MilestoneStatus,
  cancelAfter: z.string().datetime().optional(), // ISO
  escrow: z
    .object({
      owner: XrplAddress, // SPV
      offerSequence: z.number().int(), // sequence of EscrowCreate
      condition: z.string(), // hex PREIMAGE-SHA-256 condition
      createTx: z.string(),
      finishTx: z.string().optional(),
      cancelTx: z.string().optional(),
    })
    .optional(),
});
export type Milestone = z.infer<typeof Milestone>;

export const ProjectStatus = z.enum([
  "draft",
  "terms_locked",
  "funding",
  "funded",
  "escrowed", // loan closed + escrows created
  "repaying",
  "completed",
  "stalled",
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
    "approval_attested",
    "escrow_finished",
    "escrow_cancelled",
    "loan_payment",
    "vault_withdraw",
  ]),
  txHash: z.string(),
  explorerUrl: z.string().url(),
  actor: XrplAddress.optional(),
  amount: Rlusd.optional(),
  at: z.string().datetime(),
});
export type ChainEvent = z.infer<typeof ChainEvent>;

export const explorerTxUrl = (hash: string) => `https://devnet.xrpl.org/transactions/${hash}`;
