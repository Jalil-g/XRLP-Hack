"use client";

// The milestone's test suite, like GitHub checks: outcome banner, the inspector's signed audit, one row per check
// (failures first), and the attested AI verdict. "Run checks" shows rows running, then resolves them top to bottom.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FundsTransfer } from "@/components/project/investment-transfer";
import { TxLink } from "@/components/chain";
import { VerificationJourney } from "./verification-journey";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import type { Attestation, CheckResult, ChecksStatus, Evidence, InspectorAudit, Milestone, RunChecksResult } from "@/lib/contract";
import { AuditRow } from "./audit-row";
import { CheckRow } from "./check-row";
import { OutcomeBanner, outcomeOf } from "./outcome-banner";
import type { RowState } from "./status-icon";
import { VerdictRow } from "./verdict-row";

const AUDIT_CHECK = "inspector_audit_present";
const ORDER: Record<CheckResult["result"], number> = { fail: 0, warn: 1, pass: 2, skipped: 3 };
const STEP_MS = 110;

export type ChecksPanelProps = {
  milestone: Milestone;
  status: ChecksStatus;
  audits: InspectorAudit[];
  attestations: Attestation[];
  evidence?: Evidence[];
  builderName: string;
  /** Builder's RLUSD balance, shown in the released banner so the payout is visible where it happens. */
  builderBalance?: string;
  /** Address → display name (inspector on the audit row). */
  names?: Record<string, string>;
  /** Enables the Run checks button (route 11). */
  run?: { projectId: string; /** Where to land after the run, e.g. "?m=<id>" so the selection doesn't move. */ pinHref?: string };
};

export function ChecksPanel({ milestone: m, status, audits, attestations, evidence, builderName, builderBalance, names = {}, run }: ChecksPanelProps) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const verdictAt = status.verdict?.createdAt;
  const submitting = useRef(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [receipt, setReceipt] = useState<RunChecksResult | null>(null);

  const results = [...status.required, ...status.optional];
  const ran = results.length > 0;
  const auditResult = results.find((c) => c.check === AUDIT_CHECK);
  const rows: { check: Pick<CheckResult, "check" | "reason" | "evidenceIds">; result?: CheckResult["result"] }[] = ran
    ? results
        .filter((c) => c.check !== AUDIT_CHECK)
        .map((c, i) => ({ c, i }))
        .sort((a, b) => ORDER[a.c.result] - ORDER[b.c.result] || a.i - b.i)
        .map(({ c }) => ({ check: c, result: c.result }))
    : (status.suite ?? []).filter((n) => n !== AUDIT_CHECK).map((n) => ({ check: { check: n, reason: "", evidenceIds: [] } }));

  const revealed = useReveal(verdictAt, rows.length + 1);
  const stateAt = (index: number, result?: CheckResult["result"]): RowState => {
    if (running) return "running";
    if (!result) return "queued";
    if (index >= revealed) return "running";
    return result;
  };

  const latest = (kind: Attestation["kind"]) => [...attestations].reverse().find((a) => a.kind === kind);
  const audit = audits[audits.length - 1];
  const revealing = revealed < rows.length + 1;
  const failed = results.filter((c) => c.result === "fail").length;
  const total = ran ? results.length : (status.suite?.length ?? 0);
  const canRun = !!run && ["evidence_submitted", "audited", "failed"].includes(m.status);

  const finish = () => {
    if (submitting.current) return;
    setDialogOpen(false);
    if (receipt) {
      if (run?.pinHref) router.replace(run.pinHref, { scroll: false });
      router.refresh();
    }
  };
  const runChecks = async () => {
    if (!run || submitting.current) return;
    submitting.current = true;
    setReceipt(null);
    setDialogOpen(true);
    setRunning(true);
    try {
      setReceipt(await api.runChecks(run.projectId, m.id));
    } catch (err) {
      setDialogOpen(false);
      toast.error(err instanceof Error ? err.message : "Checks could not run", {
        description: err instanceof ApiError && err.txResult ? err.txResult : undefined,
      });
    } finally {
      submitting.current = false;
      setRunning(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-panel border border-line bg-page">
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) finish(); }}>
        <DialogContent className="max-w-[540px]" closeDisabled={running} data-pause-auto-refresh="true">
          <DialogHeader><DialogTitle>{receipt?.release ? "Milestone payment released" : running ? "Checking the milestone" : receipt?.verdict.decision === "pass" ? "Checks passed" : "Funds stay protected"}</DialogTitle><DialogDescription>{m.title} · {builderName}</DialogDescription></DialogHeader>
          <DialogBody>
            {receipt?.release ? <FundsTransfer amount={m.amount} source={{ label: "Milestone escrow", name: m.title, kind: "vault" }} destination={{ label: "Builder wallet", name: builderName, kind: "wallet" }} confirmed successLabel="Milestone payment released" note="The milestone checks passed and the release transaction was confirmed." /> : <VerificationJourney state={running ? "pending" : receipt?.verdict.decision === "pass" ? "pass" : "held"} title={running ? "Reviewing the evidence and signed audit" : receipt?.verdict.decision === "pass" ? "Checks passed · no release confirmed" : receipt?.verdict.decision === "needs_human" ? "A human review is needed" : "Checks failed · funds remain locked"} detail={running ? "The verification service is evaluating this milestone. Results will appear when it responds." : receipt?.verdict.decision === "pass" ? "The suite passed. No payment confirmation was returned; check the project status before trying again." : "Review the check results to see what needs attention before funds can move."} />}
            {receipt?.release && <p className="mt-4 text-caption text-ink-2">EscrowFinish <TxLink hash={receipt.release.txHash} /></p>}
          </DialogBody>
          <DialogFooter>{!running && <Button onClick={finish}>View milestone</Button>}</DialogFooter>
        </DialogContent>
      </Dialog>
      <OutcomeBanner
        outcome={revealing && ran ? "running" : outcomeOf(m, running)}
        milestone={m}
        builderName={builderName}
        builderBalance={builderBalance}
        total={total}
        failed={failed}
        decision={latest("decision")}
        failedChecks={results.filter((c) => c.result === "fail").map((c) => c.check)}
        action={
          canRun && (
            <Button variant={m.status === "failed" ? "secondary" : "primary"} onClick={runChecks} disabled={running}>
              {m.status === "failed" ? "Run again" : "Run checks"}
            </Button>
          )
        }
      />
      <ul className="divide-y divide-line">
        <AuditRow
          audit={audit}
          result={auditResult}
          state={stateAt(0, auditResult?.result)}
          inspectorName={audit ? names[audit.inspector] : undefined}
        />
        {rows.filter((r) => r.result === "fail" || r.result === "warn").map((r) => <CheckRow key={r.check.check} check={r.check} state={running ? "running" : r.result!} evidence={evidence} />)}
      </ul>
      <details className="check-details border-t border-line" open={running || revealing ? true : undefined}>
        <summary>{ran ? `View all ${total} check results` : `Explore the ${total} required checks`}</summary>
        <ul className="divide-y divide-line">{rows.filter((r) => r.result !== "fail" && r.result !== "warn").map((r, i) => <CheckRow key={r.check.check} check={r.check} state={stateAt(i + 1, r.result)} evidence={evidence} />)}</ul>

      {status.verdict && !running && !revealing && (
        <VerdictRow verdict={status.verdict} attestationTx={latest("verdict")?.txHash} hash={latest("verdict")?.hash} released={m.status === "released"} />
      )}
      </details>
    </div>
  );
}

/** Rows revealed so far. A verdict that arrives after mount resolves rows one by one; first render shows everything. */
function useReveal(verdictAt: string | undefined, count: number): number {
  const seen = useRef(verdictAt);
  const [revealed, setRevealed] = useState(Number.POSITIVE_INFINITY);
  useEffect(() => {
    if (!verdictAt || verdictAt === seen.current) return;
    seen.current = verdictAt;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setRevealed(0);
    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      setRevealed(n >= count ? Number.POSITIVE_INFINITY : n);
      if (n >= count) window.clearInterval(id);
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [verdictAt, count]);
  return revealed;
}
