// v2 state machines (docs/03-architecture.md §State machines). Pure data: core enforces, apps render.
import type { MilestoneStatusV2, ProjectStatus } from "./domain.ts";

export const PROJECT_TRANSITIONS_V2: Record<ProjectStatus, readonly ProjectStatus[]> = {
  draft: ["verifying"],
  verifying: ["verified", "rejected"],
  verified: ["terms_locked"],
  rejected: [],
  terms_locked: ["funding"],
  funding: ["funded"],
  funded: ["escrowed"], // only after SubscriptionDate (tecTOO_SOON before)
  escrowed: ["repaying", "stalled"],
  repaying: ["completed", "stalled"],
  stalled: ["repaying", "completed"], // one milestone refunded; others continue
  completed: [],
};

export const MILESTONE_TRANSITIONS_V2: Record<MilestoneStatusV2, readonly MilestoneStatusV2[]> = {
  pending: ["escrowed"],
  escrowed: ["evidence_submitted", "expired"],
  evidence_submitted: ["audited", "failed", "expired"],
  audited: ["verified", "failed", "needs_human", "expired"],
  needs_human: ["verified", "failed", "audited"], // operator decision or a corrected inspector audit
  verified: ["released", "audited"], // correction invalidates checks before an escrow has released
  failed: ["evidence_submitted", "audited", "expired"], // resubmit evidence or re-audit
  released: [],
  expired: ["refunded"],
  refunded: [],
};

/** Escrow still holds money on-chain in these states. */
export const LOCKED_MILESTONE_V2: readonly MilestoneStatusV2[] = [
  "escrowed",
  "evidence_submitted",
  "audited",
  "needs_human",
  "verified",
  "failed",
  "expired",
];

export const canProjectTransitionV2 = (from: ProjectStatus, to: ProjectStatus) => PROJECT_TRANSITIONS_V2[from].includes(to);
export const canMilestoneTransitionV2 = (from: MilestoneStatusV2, to: MilestoneStatusV2) =>
  MILESTONE_TRANSITIONS_V2[from].includes(to);
