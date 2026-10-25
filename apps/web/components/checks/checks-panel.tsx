// The milestone's test suite, styled like GitHub checks: outcome on top, one row per check, the attested verdict.
import { AlertCircle, CheckCircle2, CircleDashed, MinusCircle, XCircle } from "lucide-react";
import { TxLink } from "@/components/chain";
import type { Attestation, CheckResult, ChecksStatus, InspectorAudit, Milestone } from "@/lib/contract";
import { AI_CHECKS, checkName } from "@/lib/display";
import { cn, formatAmount } from "@/lib/utils";

const ICON = {
  pass: { Icon: CheckCircle2, className: "text-pass", label: "Passed" },
  fail: { Icon: XCircle, className: "text-fail", label: "Failed" },
  warn: { Icon: AlertCircle, className: "text-review-icon", label: "Needs review" },
  skipped: { Icon: MinusCircle, className: "text-ink-3", label: "Skipped" },
  queued: { Icon: CircleDashed, className: "text-ink-3", label: "Not run" },
} as const;

type Row = { name: string; result: keyof typeof ICON; reason: string; proof?: string };

export function ChecksPanel({
  milestone: m,
  status,
  audits,
  attestations,
  builderName,
  action,
}: {
  milestone: Milestone;
  status: ChecksStatus;
  audits: InspectorAudit[];
  attestations: Attestation[];
  builderName: string;
  /** e.g. the Run checks button; shown in the header while the milestone can run. */
  action?: React.ReactNode;
}) {
  const results: CheckResult[] = [...status.required, ...status.optional];
  const ran = results.length > 0;
  const rows: Row[] = ran
    ? results.map((c) => ({ name: c.check, result: c.result, reason: c.reason, proof: c.check === "inspector_audit_present" ? audits[audits.length - 1]?.txHash : undefined }))
    : (status.suite ?? []).map((name) => ({ name, result: "queued", reason: "Not run yet" }));
  const failed = results.filter((c) => c.result === "fail").length;
  const latest = (kind: Attestation["kind"]) => [...attestations].reverse().find((a) => a.kind === kind);
  const verdictTx = latest("verdict")?.txHash;
  const decision = latest("decision");
  const verdict = status.verdict;

  return (
    <div className="overflow-hidden rounded-panel border border-line">
      <Header m={m} ran={ran} total={results.length || rows.length} failed={failed} outcome={status.outcome} builderName={builderName} decision={decision} action={action} />

      {rows.length > 0 && (
        <ul className="divide-y divide-line">
          {rows.map((r) => {
            const { Icon, className, label } = ICON[r.result];
            return (
              <li key={r.name} className={cn("grid grid-cols-[18px_236px_minmax(0,1fr)_auto] items-baseline gap-x-3 px-5 py-2", r.result === "fail" && "bg-fail-bg/50")}>
                <Icon className={cn("size-[18px] translate-y-[3px]", className)} aria-label={label} />
                <span className="text-small font-medium text-ink">
                  {checkName(r.name)}
                  {AI_CHECKS.has(r.name) && <span className="ml-1.5 font-normal text-ink-2">· AI</span>}
                </span>
                <span className={cn("text-small", r.result === "fail" ? "font-medium text-fail" : "text-ink-2")}>{r.reason}</span>
                <span className="justify-self-end">{r.proof && <TxLink hash={r.proof} />}</span>
              </li>
            );
          })}
        </ul>
      )}

      {verdict && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-t border-line bg-band px-5 py-2.5 text-caption text-ink-2">
          <span>
            AI verdict <span className="font-medium text-ink">{verdict.decision === "needs_human" ? "needs review" : verdict.decision}</span> · confidence{" "}
            <span className="tabular font-medium text-ink">{verdict.confidence.toFixed(2)}</span> · {verdict.model === "mock" ? "mock verifier" : verdict.model}
          </span>
          {verdictTx && (
            <span>
              {m.status === "released" ? "Result attested before release" : "Result attested on-chain"} <TxLink hash={verdictTx} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function Header({
  m,
  ran,
  total,
  failed,
  outcome,
  builderName,
  decision,
  action,
}: {
  m: Milestone;
  ran: boolean;
  total: number;
  failed: number;
  outcome: ChecksStatus["outcome"];
  builderName: string;
  decision?: Attestation;
  action?: React.ReactNode;
}) {
  const bar = (tone: string, Icon: (typeof ICON)[keyof typeof ICON]["Icon"], iconClass: string, title: React.ReactNode, sub?: React.ReactNode, right?: React.ReactNode) => (
    <div className={cn("flex items-center justify-between gap-4 border-b border-line px-5 py-3.5", tone)}>
      <div className="flex min-w-0 items-start gap-3">
        <Icon className={cn("mt-0.5 size-5 shrink-0", iconClass)} aria-hidden />
        <div className="min-w-0">
          <p className="text-body font-semibold text-ink">{title}</p>
          {sub && <p className="text-small text-ink-2">{sub}</p>}
        </div>
      </div>
      {right}
    </div>
  );

  if (m.status === "released") {
    return bar(
      "bg-pass-bg",
      CheckCircle2,
      "text-pass",
      <>
        Released {formatAmount(m.amount)} RLUSD to {builderName}
      </>,
      decision ? `Approved by the platform operator: ${decision.notes}` : `All ${total} checks passed`,
      m.escrow?.finishTx && <TxLink hash={m.escrow.finishTx} label="EscrowFinish" />,
    );
  }
  if (m.status === "refunded" || m.status === "expired") {
    return bar(
      "bg-band",
      MinusCircle,
      "text-ink-3",
      m.status === "refunded" ? "Escrow expired. Money returned to the vault" : "Escrow expired",
      m.status === "refunded" ? "Cancelled back to the project account, then repaid to the vault." : "The keeper cancels it and repays the vault.",
      m.escrow?.cancelTx && <TxLink hash={m.escrow.cancelTx} label="EscrowCancel" />,
    );
  }
  if (m.status === "failed") {
    return bar(
      "bg-fail-bg",
      XCircle,
      "text-fail",
      decision ? "Rejected by the platform operator. Money stays locked" : `${failed} of ${total} checks failed. Money stays locked`,
      decision ? decision.notes : "The builder can resubmit evidence, or the inspector can re-audit.",
      action,
    );
  }
  if (m.status === "needs_human" || outcome === "needs_human") {
    return bar("bg-review-bg", AlertCircle, "text-review-icon", "Needs review by the platform operator", "Checks passed, but below the confidence this milestone requires. The decision and its reason are attested on-chain.");
  }
  if (!ran) {
    const waiting = m.status === "escrowed" || m.status === "pending";
    return bar("bg-band", CircleDashed, "text-ink-3", waiting ? "Waiting for the builder's evidence" : `${total} checks ready to run`, waiting ? "Checks run once evidence and the inspector's audit are in." : undefined, action);
  }
  return bar("bg-band", CircleDashed, "text-ink-3", `${total} checks`, undefined, action);
}
