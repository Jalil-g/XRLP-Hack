// What happened to the money, in one line: Released / Failed / Needs review / Pending / Expired.
import { TxLink } from "@/components/chain";
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
  builderBalance,
  total,
  failed,
  decision,
  failedChecks = [],
  action,
}: {
  outcome: Outcome;
  /** Names of the checks that failed, to say what fixes it. */
  failedChecks?: string[];
  milestone: Milestone;
  builderName: string;
  builderBalance?: string;
  total: number;
  failed: number;
  decision?: Attestation;
  action?: React.ReactNode;
}) {
  const view: { tone: string; icon: RowState; title: string; sub?: string; right?: React.ReactNode } = (() => {
    switch (outcome) {
      case "released":
        return {
          tone: "bg-pass-bg",
          icon: "pass",
          title: `Released ${formatAmount(m.amount)} RLUSD to ${builderName}`,
          sub: [decision ? `Approved by the platform operator: ${decision.notes}` : `All ${total} checks passed`, builderBalance && `builder balance now ${formatAmount(builderBalance)} RLUSD`]
            .filter(Boolean)
            .join(" · "),
          right: m.escrow?.finishTx && <TxLink hash={m.escrow.finishTx} label="EscrowFinish" />,
        };
      case "releasing":
        return { tone: "bg-pass-bg", icon: "pass", title: `All ${total} checks passed`, sub: "The release service is finishing the escrow." };
      case "failed":
        return {
          tone: "bg-fail-bg",
          icon: "fail",
          title: decision ? "Rejected by the platform operator. Money stays locked" : `${failed} of ${total} checks failed. Money stays locked`,
          sub: decision
            ? decision.notes
            : failedChecks.includes("inspector_audit_present")
              ? "The assigned inspector has to file a signed audit, then the checks run again."
              : "The builder can resubmit evidence, or the inspector can re-audit.",
          right: action,
        };
      case "needs_human":
        return {
          tone: "bg-review-bg",
          icon: "warn",
          title: "Needs review by the platform operator",
          sub: "Checks passed, but below the confidence this milestone requires. The decision and its reason are attested on-chain.",
        };
      case "expired":
        return { tone: "bg-band", icon: "skipped", title: "Escrow expired", sub: "The keeper cancels it and repays the vault." };
      case "returned":
        return {
          tone: "bg-band",
          icon: "skipped",
          title: "Escrow expired. Money returned to the vault",
          sub: "Cancelled back to the project account, then repaid to the vault.",
          right: m.escrow?.cancelTx && <TxLink hash={m.escrow.cancelTx} label="EscrowCancel" />,
        };
      case "running":
        return { tone: "bg-band", icon: "running", title: `Running ${total} checks`, sub: "The inspector's audit and the builder's evidence, checked by the suite." };
      case "waiting":
        return { tone: "bg-band", icon: "queued", title: "Waiting for the builder's evidence", sub: "Checks run once evidence and the inspector's audit are in." };
      case "ready":
        return { tone: "bg-band", icon: "queued", title: `${total} checks ready to run`, sub: `Pays ${formatAmount(m.amount)} RLUSD to ${builderName} only if every required check passes.`, right: action };
    }
  })();

  return (
    <div className={cn("flex items-center justify-between gap-4 border-b border-line px-5 py-3.5 transition-colors duration-200", view.tone)} aria-live="polite">
      <div className="flex min-w-0 items-start gap-3">
        <StatusIcon state={view.icon} className="mt-0.5 size-5" />
        <div className="min-w-0">
          <p className="text-body font-semibold text-ink">{view.title}</p>
          {view.sub && <p className="text-small text-ink-2">{view.sub}</p>}
        </div>
      </div>
      {view.right}
    </div>
  );
}
