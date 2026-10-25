// Words and tones for contract enums. Presentation only: what a state is called, never what it means for money.
import type { Tone } from "@/components/ui/tag";
import type { ChainEvent, ChainEventKind, CheckResult, Milestone, MilestoneStatus, Party, Project, ProjectStatus, ProjectType, RiskTier, SovLine } from "./contract";
import { formatAmount, shortAddress } from "./utils";

export const PROJECT_STATUS: Record<ProjectStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  verifying: { label: "Verifying", tone: "info" },
  verified: { label: "Verified", tone: "pass" },
  rejected: { label: "Rejected", tone: "fail" },
  terms_locked: { label: "Terms locked", tone: "neutral" },
  funding: { label: "Open for funding", tone: "info" },
  funded: { label: "Funded", tone: "neutral" },
  escrowed: { label: "In construction", tone: "neutral" },
  repaying: { label: "Repaying", tone: "neutral" },
  completed: { label: "Repaid", tone: "pass" },
  stalled: { label: "Stalled", tone: "review" },
};

export const MILESTONE_STATUS: Record<MilestoneStatus, { label: string; tone: Tone }> = {
  pending: { label: "Not funded yet", tone: "neutral" },
  escrowed: { label: "Locked in escrow", tone: "neutral" },
  evidence_submitted: { label: "Evidence in", tone: "info" },
  audited: { label: "Ready for checks", tone: "info" },
  verified: { label: "Checks passed", tone: "pass" },
  failed: { label: "Failed", tone: "fail" },
  needs_human: { label: "Needs review", tone: "review" },
  released: { label: "Released", tone: "pass" },
  expired: { label: "Expired", tone: "review" },
  refunded: { label: "Returned", tone: "neutral" },
  // v1 statuses still in the shared enum while lanes migrate
  ai_reviewed: { label: "In review", tone: "info" },
  inspected: { label: "Inspected", tone: "info" },
  rejected: { label: "Failed", tone: "fail" },
};

export const PROJECT_TYPE: Record<ProjectType, string> = {
  residential_new: "New residential",
  residential_renovation: "Renovation",
  commercial_small: "Small commercial",
};

export const RISK_TIER: Record<RiskTier, string> = { low: "Low risk", medium: "Medium risk", high: "High risk" };

export const VAULT_PHASE = {
  subscription: "Open for deposits",
  investment: "Lent out",
  redemption: "Withdrawals open",
} as const;

const CHECK_NAMES: Record<string, string> = {
  required_evidence_present: "Required evidence",
  gps_within_site: "Photos taken on site",
  photo_fresh: "Photos are new",
  no_duplicate_photo: "No reused photos",
  invoice_matches_budget: "Invoices match budget",
  inspector_audit_present: "Inspector audit signed",
  audit_checklist_complete: "Inspector checklist complete",
  stage_visually_consistent: "Work matches the stage",
  audit_matches_evidence: "Audit agrees with evidence",
  document_consistency: "Documents agree",
  lien_waiver_matches_invoices: "Lien waivers match",
  // project verification
  licence_active: "Licence active",
  insurance_in_force: "Insurance in force",
  entity_match: "Entity matches",
  sanctions_screen: "Sanctions screen",
  sov_sums_to_principal: "Schedule adds up",
  line_amounts_in_range: "Line amounts in range",
  permits_present: "Permits on file",
  site_resolves: "Site exists",
  timeline_realistic: "Timeline realistic",
  track_record: "Track record",
  open_load: "Current workload",
};

/** Judgement checks run by the AI (vs deterministic). Shown with an "AI" marker. */
export const AI_CHECKS = new Set(["stage_visually_consistent", "audit_matches_evidence", "document_consistency"]);

export const checkName = (name: string) => CHECK_NAMES[name] ?? name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
export const checkLabel = (c: Pick<CheckResult, "check">) => checkName(c.check);

export const EVENT_TX: Record<ChainEventKind, string> = {
  credential_issued: "CredentialCreate",
  credential_accepted: "CredentialAccept",
  vault_created: "VaultCreate",
  vault_deposit: "VaultDeposit",
  loan_broker_created: "LoanBrokerSet",
  cover_deposited: "LoanBrokerCoverDeposit",
  loan_set: "LoanSet",
  escrow_created: "EscrowCreate",
  approval_attested: "Attestation",
  audit_attested: "Attestation",
  verdict_attested: "Attestation",
  decision_attested: "Attestation",
  escrow_finished: "EscrowFinish",
  escrow_cancelled: "EscrowCancel",
  loan_payment: "LoanPay",
  vault_withdraw: "VaultWithdraw",
  verification_fee_paid: "Payment",
  project_verified: "Attestation",
  inspector_assigned: "Attestation",
  loan_default: "LoanManage",
  release_refused: "EscrowFinish (refused)",
};

/** One plain sentence per event. */
export function describeEvent(e: ChainEvent, who: (address?: string) => string, milestoneTitle: (id?: string) => string, builderName = "the builder"): string {
  const amt = e.amount ? `${formatAmount(e.amount)} RLUSD` : "";
  const ms = milestoneTitle(e.milestoneId);
  switch (e.kind) {
    case "verification_fee_paid":
      return `${who(e.actor)} paid the ${amt} verification fee`;
    case "project_verified":
      return "Project verification report recorded";
    case "credential_issued":
      return "Platform issued a credential";
    case "credential_accepted":
      return `${who(e.actor)} accepted the credential`;
    case "inspector_assigned":
      return "Inspector assigned to the project";
    case "vault_created":
      return "Project vault opened";
    case "loan_broker_created":
      return "Loan broker set up on the vault";
    case "cover_deposited":
      return `Platform posted ${amt} first-loss cover`;
    case "vault_deposit":
      return `${who(e.actor)} deposited ${amt}`;
    case "loan_set":
      return `Vault lent ${amt} to the project account`;
    case "escrow_created":
      return `${amt} locked for ${ms}`;
    case "approval_attested":
      return `${who(e.actor)} approved ${ms}`;
    case "audit_attested":
      return `${who(e.actor)} signed the ${ms} audit`;
    case "verdict_attested":
      return `Checks result for ${ms} recorded`;
    case "decision_attested":
      return `Operator decision on ${ms} recorded`;
    case "escrow_finished":
      return `${ms}: ${amt} released to ${builderName}`;
    case "escrow_cancelled":
      return `${ms} escrow expired; ${amt} back to the project account`;
    case "loan_payment":
      return e.milestoneId ? `${amt} from ${ms} repaid to the vault` : `${amt} repaid to the vault`;
    case "vault_withdraw":
      return `${who(e.actor)} withdrew ${amt}`;
    case "loan_default":
      return "Loan marked in default";
    case "release_refused":
      return `Platform tried to release ${ms}; the ledger refused`;
  }
}

/** Address → display name from the parties directory, else a short address. */
export function namer(parties: Party[]) {
  const byAddress = new Map(parties.map((p) => [p.address, p.name]));
  return (address?: string) => (address ? (byAddress.get(address) ?? shortAddress(address)) : "Someone");
}

/** The milestone worth showing first: the one in flight, else the next locked one, else the last released. */
export function focusMilestone(milestones: Milestone[]): Milestone | undefined {
  const inFlight = milestones.find((m) => ["evidence_submitted", "audited", "needs_human", "failed", "expired"].includes(m.status));
  return inFlight ?? milestones.find((m) => m.status === "escrowed") ?? [...milestones].reverse().find((m) => m.status === "released") ?? milestones[0];
}

/** The SoV lines a milestone pays for (both fields are optional in the v2 contract). */
export const sovLinesFor = (p: Pick<Project, "sov">, m: Pick<Milestone, "sovCodes">): SovLine[] => (p.sov ?? []).filter((l) => (m.sovCodes ?? []).includes(l.code));

export const ROLE_LABEL: Record<Party["role"], string> = {
  investor: "Investor",
  builder: "Builder",
  inspector: "Inspector",
  platform: "Platform",
  release_service: "Release service",
  ai_agent: "AI verifier",
  trustee: "Trustee",
  spv: "Project account",
};

/** Address → role label from the parties directory. */
export function roleNamer(parties: Party[]) {
  const byAddress = new Map(parties.map((p) => [p.address, ROLE_LABEL[p.role]]));
  return (address?: string) => (address ? byAddress.get(address) : undefined);
}
