// Policy engine: what we check, how strictly, and how failures map to a decision —
// varied by project type, builder risk tier and milestone amount.
import { TWO_INSPECTOR_THRESHOLD } from "@xrlp/shared";
import type { Builder, Milestone, Project, ProjectType, RiskTier } from "@xrlp/shared";
import { MILESTONE_CHECKS, type MilestoneCheckName } from "./types.ts";
import { toCents } from "./util.ts";

/** What a failing/warning check does to the overall verdict. */
export type Escalation = "fail" | "needs_human" | "ignore";

export interface CheckRule {
  enabled: boolean;
  onFail: Escalation;
  onWarn: Escalation;
}

export interface PolicyThresholds {
  /** Metres added to the site radius to absorb phone-GPS noise. */
  gpsSlackM: number;
  /** Minimum fraction of photos that must carry GPS; below => warn. */
  minGpsCoverage: number;
  /** Photos older than this (vs now) are stale even if after escrow creation. */
  maxPhotoAgeDays: number;
  /** Allowed clock skew for "taken in the future". */
  futureSkewMinutes: number;
  /** pHash Hamming distance (of 64 bits) at or below which two photos are the same image. */
  phashFailDistance: number;
  /** pHash distance at or below which two photos are suspiciously similar (warn). */
  phashWarnDistance: number;
  /** Invoices may cover as little as (100 - x)% of the requested draw. */
  invoiceUnderTolerancePct: number;
  /** Invoices above (100 + x)% of the draw => budget overrun warning. */
  invoiceOverTolerancePct: number;
  /** LLM judgments below this confidence are routed to a human, whatever they say. */
  minLlmConfidence: number;
}

export interface VerificationPolicy {
  projectType: ProjectType;
  riskTier: RiskTier;
  amount: string;
  highValue: boolean;
  requiredInspectors: 1 | 2;
  /** = thresholds.minLlmConfidence. Matches core's MilestonePolicy port shape. */
  minConfidence: number;
  /** False => the best the AI can say is needs_human (e.g. builder not yet verified). */
  allowAutoPass: boolean;
  checks: Record<MilestoneCheckName, CheckRule>;
  thresholds: PolicyThresholds;
  /** Plain-English explanation of why this policy looks the way it does (show in UI). */
  notes: string[];
}

const BASE_THRESHOLDS: Record<RiskTier, PolicyThresholds> = {
  low: {
    gpsSlackM: 75,
    minGpsCoverage: 0.5,
    maxPhotoAgeDays: 45,
    futureSkewMinutes: 10,
    phashFailDistance: 10,
    phashWarnDistance: 14,
    invoiceUnderTolerancePct: 10,
    invoiceOverTolerancePct: 30,
    minLlmConfidence: 0.6,
  },
  medium: {
    gpsSlackM: 50,
    minGpsCoverage: 0.67,
    maxPhotoAgeDays: 30,
    futureSkewMinutes: 10,
    phashFailDistance: 10,
    phashWarnDistance: 14,
    invoiceUnderTolerancePct: 5,
    invoiceOverTolerancePct: 25,
    minLlmConfidence: 0.7,
  },
  high: {
    gpsSlackM: 30,
    minGpsCoverage: 1,
    maxPhotoAgeDays: 14,
    futureSkewMinutes: 5,
    phashFailDistance: 12,
    phashWarnDistance: 16,
    invoiceUnderTolerancePct: 2,
    invoiceOverTolerancePct: 15,
    minLlmConfidence: 0.8,
  },
};

export function policyFor(project: Project, builder: Builder, milestone: Milestone): VerificationPolicy {
  const tier = builder.riskTier;
  const amountCents = toCents(milestone.amount);
  const highValue = amountCents >= BigInt(TWO_INSPECTOR_THRESHOLD) * 100n;
  const t: PolicyThresholds = { ...BASE_THRESHOLDS[tier] };
  const notes: string[] = [`Builder risk tier "${tier}" sets base thresholds.`];

  // Default escalations: deterministic hard evidence fails the milestone; soft signals go to a human.
  const checks = Object.fromEntries(
    MILESTONE_CHECKS.map((c) => [c, { enabled: true, onFail: "fail", onWarn: "needs_human" } as CheckRule]),
  ) as Record<MilestoneCheckName, CheckRule>;

  // GPS can be noisy or missing (indoor shots); only high-risk builders get a hard fail.
  checks.gps_within_site.onFail = tier === "high" ? "fail" : "needs_human";
  checks.gps_within_site.onWarn = tier === "low" ? "ignore" : "needs_human";
  // Missing EXIF timestamps are a soft signal for trusted builders.
  checks.photo_fresh.onWarn = tier === "low" ? "ignore" : "needs_human";
  // Under-documented draw is a hard fail unless the builder is low risk.
  checks.invoice_matches_budget.onFail = tier === "low" ? "needs_human" : "fail";
  checks.invoice_matches_budget.onWarn = "ignore"; // overrun on builder's own dime: informational
  // Lien waivers aren't in the shared templates yet (TODO), so a mismatch goes to a human for now.
  checks.lien_waiver_matches_invoices.onFail = "needs_human";
  checks.lien_waiver_matches_invoices.onWarn = "ignore";
  // Document mismatches (typos, DBA names) usually need a human, except for high-risk builders.
  checks.document_consistency.onFail = tier === "high" ? "fail" : "needs_human";
  checks.document_consistency.onWarn = tier === "high" ? "needs_human" : "ignore";

  switch (project.type) {
    case "residential_renovation":
      // Interior work: phones often lose GPS fix indoors; allow wider slack, don't block on missing GPS.
      t.gpsSlackM += 50;
      t.minGpsCoverage = Math.min(t.minGpsCoverage, 0.5);
      checks.gps_within_site.onWarn = "ignore";
      notes.push("Renovation: interior photos often lack GPS, so wider GPS slack and missing GPS is tolerated.");
      break;
    case "commercial_small":
      // Bigger tickets, more paperwork: fresher photos and documents must line up.
      t.maxPhotoAgeDays = Math.min(t.maxPhotoAgeDays, 21);
      checks.document_consistency.onWarn = "needs_human";
      notes.push("Commercial: photos must be ≤21 days old and document warnings go to a human.");
      break;
    case "residential_new":
      notes.push("New residential: standard checks.");
      break;
  }

  if (highValue) {
    t.invoiceUnderTolerancePct = Math.min(t.invoiceUnderTolerancePct, 3);
    t.minLlmConfidence = Math.round(Math.min(0.95, t.minLlmConfidence + 0.05) * 100) / 100;
    checks.invoice_matches_budget.onWarn = "needs_human";
    checks.document_consistency.onWarn = "needs_human";
    notes.push(
      `Milestone ≥ ${TWO_INSPECTOR_THRESHOLD.toLocaleString("en-US")} RLUSD: tighter invoice tolerance, higher AI confidence bar, two inspectors.`,
    );
  }

  const requiredInspectors: 1 | 2 = highValue || tier === "high" ? 2 : 1;
  if (tier === "high" && !highValue) notes.push("High-risk builder: two inspectors required.");

  const allowAutoPass = builder.verified;
  if (!allowAutoPass) notes.push("Builder is not verified: AI cannot return pass, best case is needs_human.");

  return {
    projectType: project.type,
    riskTier: tier,
    amount: milestone.amount,
    highValue,
    requiredInspectors,
    minConfidence: t.minLlmConfidence,
    allowAutoPass,
    checks,
    thresholds: t,
    notes,
  };
}
