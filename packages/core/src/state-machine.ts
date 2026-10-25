// Project + milestone state machines: the v2 tables live in @xrlp/shared (docs/03-architecture.md §State machines).
// Core enforces them here and turns violations into DomainError ILLEGAL_TRANSITION.
import {
  LOCKED_MILESTONE_V2,
  MILESTONE_STATUSES_V2,
  MILESTONE_TRANSITIONS_V2,
  PROJECT_TRANSITIONS_V2,
  type MilestoneStatus,
  type MilestoneStatusV2,
  type ProjectStatus,
} from "@xrlp/shared";
import { DomainError } from "./errors.ts";

export const isV2Status = (s: MilestoneStatus): s is MilestoneStatusV2 => (MILESTONE_STATUSES_V2 as readonly string[]).includes(s);

export const canProjectTransition = (from: ProjectStatus, to: ProjectStatus) => PROJECT_TRANSITIONS_V2[from].includes(to);
export const canMilestoneTransition = (from: MilestoneStatus, to: MilestoneStatusV2) =>
  isV2Status(from) && MILESTONE_TRANSITIONS_V2[from].includes(to);

export function assertProjectTransition(id: string, from: ProjectStatus, to: ProjectStatus): void {
  if (!canProjectTransition(from, to)) throw new DomainError("ILLEGAL_TRANSITION", `Project ${id}: ${from} -> ${to} is not allowed`);
}
export function assertMilestoneTransition(id: string, from: MilestoneStatus, to: MilestoneStatusV2): void {
  if (!canMilestoneTransition(from, to)) throw new DomainError("ILLEGAL_TRANSITION", `Milestone ${id}: ${from} -> ${to} is not allowed`);
}
export function assertProjectStatus(id: string, actual: ProjectStatus, allowed: readonly ProjectStatus[], action: string): void {
  if (!allowed.includes(actual)) throw new DomainError("ILLEGAL_TRANSITION", `Cannot ${action}: project ${id} is ${actual} (needs ${allowed.join(" | ")})`);
}
export function assertMilestoneStatus(id: string, actual: MilestoneStatus, allowed: readonly MilestoneStatus[], action: string): void {
  if (!allowed.includes(actual)) throw new DomainError("ILLEGAL_TRANSITION", `Cannot ${action}: milestone ${id} is ${actual} (needs ${allowed.join(" | ")})`);
}

/** Escrow still holds money on-chain. */
export const isLocked = (s: MilestoneStatus) => (LOCKED_MILESTONE_V2 as readonly string[]).includes(s);
export const TERMINAL_MILESTONE: readonly MilestoneStatus[] = ["released", "refunded"];
export const isTerminal = (s: MilestoneStatus) => TERMINAL_MILESTONE.includes(s);
