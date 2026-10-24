// Explicit project + milestone state machines (mirrors docs/03-architecture.md).
// NOTE: docs say the state machine lives in packages/shared; it isn't there yet, so it lives here for now.
import type { MilestoneStatus, ProjectStatus } from "@xrlp/shared";
import { DomainError } from "./errors.ts";

export const PROJECT_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  draft: ["terms_locked"],
  terms_locked: ["funding"],
  funding: ["funded", "stalled"], // stalled = funding deadline missed; investors withdraw
  funded: ["escrowed"],
  escrowed: ["repaying", "stalled"],
  repaying: ["completed", "stalled"],
  stalled: ["completed"],
  completed: [],
};

export const MILESTONE_TRANSITIONS: Record<MilestoneStatus, readonly MilestoneStatus[]> = {
  pending: ["escrowed"],
  escrowed: ["evidence_submitted", "expired"],
  evidence_submitted: ["ai_reviewed", "rejected", "expired"],
  ai_reviewed: ["inspected", "rejected", "expired"],
  inspected: ["released", "rejected", "expired"],
  rejected: ["evidence_submitted", "expired"], // builder may resubmit
  expired: ["refunded"],
  released: [],
  refunded: [],
};

export const TERMINAL_MILESTONE: readonly MilestoneStatus[] = ["released", "refunded"];
/** Milestones whose escrow still holds money on-chain. */
export const LOCKED_MILESTONE: readonly MilestoneStatus[] = [
  "escrowed",
  "evidence_submitted",
  "ai_reviewed",
  "inspected",
  "rejected",
  "expired",
];

export const canProjectTransition = (from: ProjectStatus, to: ProjectStatus) => PROJECT_TRANSITIONS[from].includes(to);
export const canMilestoneTransition = (from: MilestoneStatus, to: MilestoneStatus) =>
  MILESTONE_TRANSITIONS[from].includes(to);

export function assertProjectTransition(projectId: string, from: ProjectStatus, to: ProjectStatus): void {
  if (!canProjectTransition(from, to)) {
    throw new DomainError(
      "ILLEGAL_TRANSITION",
      `Project ${projectId}: cannot go ${from} -> ${to} (allowed from ${from}: ${PROJECT_TRANSITIONS[from].join(", ") || "none"})`,
      { entity: "project", id: projectId, from, to },
    );
  }
}

export function assertMilestoneTransition(milestoneId: string, from: MilestoneStatus, to: MilestoneStatus): void {
  if (!canMilestoneTransition(from, to)) {
    throw new DomainError(
      "ILLEGAL_TRANSITION",
      `Milestone ${milestoneId}: cannot go ${from} -> ${to} (allowed from ${from}: ${MILESTONE_TRANSITIONS[from].join(", ") || "none"})`,
      { entity: "milestone", id: milestoneId, from, to },
    );
  }
}

export function assertProjectStatus(projectId: string, actual: ProjectStatus, expected: readonly ProjectStatus[], action: string) {
  if (!expected.includes(actual)) {
    throw new DomainError(
      "ILLEGAL_TRANSITION",
      `Project ${projectId}: cannot ${action} while ${actual} (needs ${expected.join(" | ")})`,
      { entity: "project", id: projectId, actual, expected, action },
    );
  }
}

export function assertMilestoneStatus(
  milestoneId: string,
  actual: MilestoneStatus,
  expected: readonly MilestoneStatus[],
  action: string,
) {
  if (!expected.includes(actual)) {
    throw new DomainError(
      "ILLEGAL_TRANSITION",
      `Milestone ${milestoneId}: cannot ${action} while ${actual} (needs ${expected.join(" | ")})`,
      { entity: "milestone", id: milestoneId, actual, expected, action },
    );
  }
}
