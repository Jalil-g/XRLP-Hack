// What happened to the money, in one line, plus the one action. Failures add one short line on what fixes it.
import type { Attestation, Milestone } from "@/lib/contract";
import { cn, formatAmount } from "@/lib/utils";
import { StatusIcon, type RowState } from "./status-icon";

export type Outcome = "released" | "releasing" | "failed" | "needs_human" | "expired" | "returned" | "ready" | "waiting" | "running";

export function outcomeOf(m: Milestone, running: boolean): Outcome {
  if (running) return "running";
  if (m.status === "released") return "released";
  if (m.status === "failed" || m.status === "rejected") return "failed";
  if (m.status === "needs_human") return "needs_human";
  if (m.status === "refunded") return "returned";
  if (m.status === "expired") return "expired";
  if (m.status === "verified") return "releasing";
  if (m.status === "escrowed" || m.status === "pending") return "waiting";
  return "ready";
}

export function OutcomeBanner({
  outcome,
  milestone: m,
  builderName,
  total,
  failed,
  decision,
  failedChecks = [],
  action,
  paidCents,
}: {
  outcome: Outcome;
  /** Names of the checks that failed, to say what fixes it. */
  failedChecks?: string[];
  milestone: Milestone;
  builderName: string;
  total: number;
  failed: number;
  decision?: Attestation;
  action?: React.ReactNode;
  /** Displayed released amount in cents (counts up during the release motion). Defaults to the milestone amount. */
  paidCents?: number;
}) {
  const view: { tone: string; icon: RowState; title: React.ReactNode; sub?: string } = (() => {
    switch (outcome) {
      case "released":
        return {
          tone: "",
          icon: "pass",
          title: (
            <>
              <span className="paid-mark tabular-nums" data-paid="true">
                {formatAmount(paidCents !== undefined ? paidCents / 100 : m.amount)}
              </span>{" "}
              released to {builderName}
            </>
          ),
          sub: decision?.notes ? `Operator: ${decision.notes}` : undefined,
        };
      case "releasing":
        return { tone: "", icon: "running", title: `Releasing ${formatAmount(m.amount)}` };
      case "failed":
        return {
          tone: "bg-fail-bg",
          icon: "fail",
          title: decision ? "Rejected by operator" : `${failed} of ${total} checks failed`,
          sub: decision ? decision.notes : failedChecks.includes("inspector_audit_present") ? "Needs a signed inspector audit." : "Resubmit evidence or re-audit.",
        };
      case "needs_human":
        return { tone: "bg-review-bg", icon: "warn", title: "Needs operator review" };
      case "expired":
        return { tone: "bg-band", icon: "skipped", title: "Escrow expired" };
      case "returned":
        return { tone: "bg-band", icon: "skipped", title: "Returned to the vault" };
      case "running":
        return { tone: "", icon: "running", title: `Running ${total} checks` };
      case "waiting":
        return { tone: "", icon: "queued", title: "Waiting for evidence" };
      case "ready":
        return { tone: "", icon: "queued", title: `${total} checks` };
    }
  })();

  return (
    <div className={cn("flex min-h-[72px] flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-line px-5 py-3.5 transition-colors duration-200", view.tone)} aria-live="polite">
      <div className="flex min-w-0 items-center gap-3">
        <StatusIcon state={view.icon} className="size-6" />
        <div className="min-w-0">
          <p className="text-[19px] leading-7 font-semibold tracking-[-0.01em] text-ink">{view.title}</p>
          {view.sub && <p className={cn("text-small", outcome === "failed" ? "text-fail" : "text-ink-2")}>{view.sub}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}
