// Labels / tones for domain enums. Client-safe (no node imports).
import type { ChainEvent, CheckResult, Milestone, Project, ProjectType, RiskTier, Verdict } from "@xrlp/shared";
import type { Tone } from "@/components/ui/badge";
import type { MilestoneView, Party } from "./types";
import { formatAmount, shortAddress } from "./utils";

export const MILESTONE_STATUS: Record<Milestone["status"], { label: string; tone: Tone; short: string }> = {
  pending: { label: "Awaiting loan close", short: "Pending", tone: "neutral" },
  escrowed: { label: "Locked in escrow", short: "Locked", tone: "lock" },
  evidence_submitted: { label: "Evidence submitted", short: "Evidence in", tone: "info" },
  ai_reviewed: { label: "AI reviewed · awaiting inspector", short: "AI reviewed", tone: "info" },
  inspected: { label: "Inspected · awaiting quorum", short: "Inspected", tone: "info" },
  released: { label: "Released to builder", short: "Released", tone: "ok" },
  rejected: { label: "Rejected · funds stay locked", short: "Rejected", tone: "bad" },
  expired: { label: "Escrow expired", short: "Expired", tone: "warn" },
  refunded: { label: "Expired · repaid to vault", short: "Refunded", tone: "warn" },
};

export function projectStatus(p: Project): { label: string; tone: Tone } {
  const open = p.milestones.some((m) => !["released", "refunded"].includes(m.status));
  switch (p.status) {
    case "draft":
      return { label: "Draft", tone: "neutral" };
    case "terms_locked":
      return { label: "Terms locked", tone: "neutral" };
    case "funding":
      return { label: "Open for funding", tone: "brand" };
    case "funded":
      return { label: "Funded · closing", tone: "info" };
    case "escrowed":
      return { label: "In construction", tone: "lock" };
    case "repaying":
      return open ? { label: "In construction", tone: "lock" } : { label: "Repaying", tone: "ok" };
    case "completed":
      return { label: "Repaid in full", tone: "ok" };
    case "stalled":
      return { label: "Stalled · refunding", tone: "warn" };
  }
}

export const PROJECT_TYPE: Record<ProjectType, string> = {
  residential_new: "New residential",
  residential_renovation: "Residential renovation",
  commercial_small: "Small commercial",
};

export const RISK_TIER: Record<RiskTier, { label: string; tone: Tone }> = {
  low: { label: "Low risk", tone: "ok" },
  medium: { label: "Medium risk", tone: "warn" },
  high: { label: "High risk", tone: "bad" },
};

export const VERDICT: Record<Verdict["decision"], { label: string; tone: Tone }> = {
  pass: { label: "Pass", tone: "ok" },
  fail: { label: "Fail", tone: "bad" },
  needs_human: { label: "Needs human review", tone: "warn" },
};

const CHECK_LABELS: Record<string, string> = {
  required_evidence_present: "Required evidence",
  gps_within_site: "Photo location",
  photo_fresh: "Photo timestamps",
  no_duplicate_photo: "Duplicate / reused photos",
  invoice_matches_budget: "Invoice vs budget line",
  stage_visually_consistent: "Visual stage match",
};

export const checkLabel = (c: CheckResult) =>
  CHECK_LABELS[c.check] ?? c.check.replace(/_/g, " ").replace(/^\w/, (x) => x.toUpperCase());

export const EVENT_LABEL: Record<ChainEvent["kind"], string> = {
  credential_issued: "Credential issued",
  vault_created: "Vault created",
  vault_deposit: "Vault deposit",
  loan_broker_created: "Loan broker created",
  loan_set: "Loan closed",
  escrow_created: "Escrow created",
  approval_attested: "Approval attested",
  escrow_finished: "Escrow released",
  escrow_cancelled: "Escrow cancelled",
  loan_payment: "Loan payment",
  vault_withdraw: "Vault withdrawal",
};

export const EVENT_TX: Record<ChainEvent["kind"], string> = {
  credential_issued: "CredentialCreate",
  vault_created: "VaultCreate",
  vault_deposit: "VaultDeposit",
  loan_broker_created: "LoanBrokerSet",
  loan_set: "LoanSet",
  escrow_created: "EscrowCreate",
  approval_attested: "Payment + memo",
  escrow_finished: "EscrowFinish",
  escrow_cancelled: "EscrowCancel",
  loan_payment: "LoanPay",
  vault_withdraw: "VaultWithdraw",
};

/** One-line human description of a chain event. */
export function describeEvent(e: ChainEvent, dir: Record<string, Party>, milestoneTitle?: (id: string) => string | undefined): string {
  const who = e.actor ? (dir[e.actor]?.name ?? shortAddress(e.actor)) : "Someone";
  const amt = e.amount ? `${formatAmount(e.amount)} RLUSD` : "";
  const ms = e.milestoneId ? (milestoneTitle?.(e.milestoneId) ?? "milestone") : "";
  switch (e.kind) {
    case "credential_issued":
      return "Platform issued VERIFIED_BUILDER credential to the builder";
    case "vault_created":
      return "Project vault opened for RLUSD deposits";
    case "vault_deposit":
      return `${who} deposited ${amt} and received vault shares`;
    case "loan_broker_created":
      return "Loan broker configured against the vault";
    case "loan_set":
      return `Vault lent ${amt} to the project account`;
    case "escrow_created":
      return `${amt} locked for ${ms} — payable only to the builder`;
    case "approval_attested":
      return `${who} signed ${ms}`;
    case "escrow_finished":
      return `${ms}: ${amt} released to ${who}`;
    case "escrow_cancelled":
      return `${ms} escrow expired — ${amt} back to project account`;
    case "loan_payment":
      return e.milestoneId ? `Unreleased ${amt} repaid to the vault` : `Instalment of ${amt} repaid to the vault`;
    case "vault_withdraw":
      return `${who} withdrew ${amt}`;
  }
}

/** The milestone most worth showing: the one in flight, else the latest released, else the first open escrow. */
export function focusMilestoneIndex(views: MilestoneView[]): number {
  const inFlight = views.findIndex((v) => ["evidence_submitted", "ai_reviewed", "inspected", "rejected"].includes(v.milestone.status));
  if (inFlight >= 0) return inFlight;
  const lastReleased = views.map((v) => v.milestone.status).lastIndexOf("released");
  if (lastReleased >= 0) return lastReleased;
  return Math.max(0, views.findIndex((v) => v.milestone.status === "escrowed"));
}
