import type { Milestone, Verdict } from "./contract";

export type ActionFeedback = { message: string; tone: "success" | "error" | "info" };

export function checksFeedback(result: { verdict: Pick<Verdict, "decision" | "checks">; release?: unknown }): ActionFeedback {
  if (result.verdict.decision === "pass") {
    return result.release
      ? { message: "All checks passed; escrow released", tone: "success" }
      : { message: "All checks passed; release is not confirmed yet. Check the milestone timeline.", tone: "info" };
  }
  if (result.verdict.decision === "needs_human") return { message: "Needs review by the platform operator", tone: "info" };
  const failed = result.verdict.checks.filter((check) => check.result === "fail").length;
  return { message: failed ? `${failed} check${failed === 1 ? "" : "s"} failed; money stays locked` : "The suite did not pass; open the milestone checks", tone: "error" };
}

export function decisionFeedback(decision: "approve" | "reject", milestone: Pick<Milestone, "status">): ActionFeedback {
  if (decision === "reject") return { message: "Rejected; money stays locked", tone: "info" };
  return milestone.status === "released"
    ? { message: "Approved; escrow released", tone: "success" }
    : { message: "Approval recorded; release is not confirmed yet. Check the milestone timeline.", tone: "info" };
}

export function cancelFeedback(milestone: Pick<Milestone, "status">): ActionFeedback {
  return milestone.status === "refunded"
    ? { message: "Escrow cancelled and repaid to the vault", tone: "success" }
    : { message: "Cancellation processed; repayment to the vault is not confirmed yet. Check the milestone timeline.", tone: "info" };
}
