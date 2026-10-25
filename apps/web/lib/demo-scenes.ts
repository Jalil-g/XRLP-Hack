// Pure helpers for the /demo control room (app/demo/page.tsx), so the scene targeting is unit-tested (test/demo-scenes.test.ts).
// Targets are found from state, never from fixture ids: the fake seed and the devnet prestage (ps-…-a/b/c) name projects differently.
import type { CheckResult, ChecksStatus, Milestone, ProjectDetail } from "./contract";

/** The check the failed-milestone scene is about (docs/04-demo-script.md: M2's reused photo). */
export const DUPLICATE_PHOTO_CHECK = "no_duplicate_photo";

/** Failing required checks of a milestone, with the one to headline: the duplicate-photo check when it failed, else the first. */
export function failedChecks(checks: ChecksStatus | undefined): { failed: CheckResult[]; headline?: CheckResult } {
  const failed = (checks?.required ?? []).filter((c) => c.result === "fail");
  return { failed, headline: failed.find((c) => c.check === DUPLICATE_PHOTO_CHECK) ?? failed[0] };
}

/** Escrow still open on the ledger: created, neither finished nor cancelled, milestone not terminal. */
const openEscrow = (m: Milestone) => !!m.escrow && !m.escrow.finishTx && !m.escrow.cancelTx && m.status !== "released" && m.status !== "refunded";

/**
 * An escrow the keeper (route 22) would cancel now: open and either already marked `expired`, or past its CancelAfter.
 * Mirrors core's keeperTick cancel path (`status === "expired" || (now >= cancelAfter && isLocked(status))`).
 */
export function isOverdueEscrow(m: Milestone, now: number): boolean {
  if (!openEscrow(m)) return false;
  if (m.status === "expired") return true;
  return !!m.cancelAfter && Date.parse(m.cancelAfter) <= now;
}

export type StallScene = { d: ProjectDetail; overdue?: Milestone; refunded?: Milestone };

/**
 * The stall scene's project: one with an escrow the keeper can cancel now (prestage B sits `escrowed` with M2 past its
 * CancelAfter until a keeper tick), else one whose escrow already went back, else a `stalled` project. Project A is skipped.
 */
export function findStall(all: ProjectDetail[], a: ProjectDetail | undefined, now: number): StallScene | undefined {
  const others = all.filter((d) => d !== a);
  const scene = (d: ProjectDetail): StallScene => ({
    d,
    overdue: d.project.milestones.find((m) => isOverdueEscrow(m, now)),
    refunded: d.project.milestones.find((m) => m.status === "refunded"),
  });
  const withOverdue = others.find((d) => d.project.milestones.some((m) => isOverdueEscrow(m, now)));
  if (withOverdue) return scene(withOverdue);
  const refunded = others.find((d) => d.project.milestones.some((m) => m.status === "refunded"));
  if (refunded) return scene(refunded);
  const stalled = others.find((d) => d.project.status === "stalled");
  return stalled && scene(stalled);
}
