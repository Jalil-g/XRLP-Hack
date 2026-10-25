"use client";

// The milestone's test suite, like GitHub checks: outcome banner, the inspector's signed audit, one row per check
// (failures first), the attested AI verdict, and one Proof disclosure for hashes and signers. "Run checks" shows rows
// running, then resolves them top to bottom; on a release the last row hands off to the page's release motion
// (ReleaseStage): the banner amount counts up while the hero's escrow counts down and the bar fills lime.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Address, TxLink } from "@/components/chain";
import { useStageHold, useTween } from "@/components/project/release-stage";
import { Button } from "@/components/ui/button";
import { ApiError, api } from "@/lib/api";
import type { Attestation, CheckResult, ChecksStatus, Evidence, InspectorAudit, Milestone } from "@/lib/contract";
import { formatDate, toCents } from "@/lib/utils";
import { AuditRow } from "./audit-row";
import { CheckRow } from "./check-row";
import { OutcomeBanner, outcomeOf } from "./outcome-banner";
import { Proof } from "./proof";
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
  /** Builder's RLUSD balance. Accepted for compatibility; the hero carries the payout now. */
  builderBalance?: string;
  /** Address → display name (inspector on the audit row). */
  names?: Record<string, string>;
  /** Enables the Run checks button (route 11). */
  run?: { projectId: string; /** Where to land after the run, e.g. "?m=<id>" so the selection doesn't move. */ pinHref?: string };
};

export function ChecksPanel({ milestone: m, status, audits, attestations, evidence, builderName, names = {}, run }: ChecksPanelProps) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const verdictAt = status.verdict?.createdAt;
  // Stay "running" until the refreshed props carry the new verdict, so the panel never flashes back to "ready".
  useEffect(() => setRunning(false), [verdictAt]);

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
  const verdictTx = latest("verdict")?.txHash;
  const verdictHash = latest("verdict")?.hash;
  const decisionTx = latest("decision")?.txHash;
  const revealing = revealed < rows.length + 1;
  const failed = results.filter((c) => c.result === "fail").length;
  const total = ran ? results.length : (status.suite?.length ?? 0);
  const canRun = !!run && ["evidence_submitted", "audited", "failed"].includes(m.status);
  const outcome = revealing && ran ? "running" : outcomeOf(m, running);

  // Hold the page's release motion until the last row has landed, then count the payout up from zero.
  useStageHold(`checks:${m.id}`, running || (revealing && ran));
  const { values: [paid = 0] } = useTween([outcome === "released" ? toCents(m.amount) : 0]);

  const runChecks = async () => {
    if (!run) return;
    setRunning(true);
    window.setTimeout(() => setRunning(false), 15_000); // never spin forever if the refresh brings nothing new
    try {
      await api.runChecks(run.projectId, m.id);
      if (run.pinHref) router.replace(run.pinHref, { scroll: false });
      router.refresh();
    } catch (err) {
      setRunning(false);
      toast.error(err instanceof Error ? err.message : "Checks could not run", {
        description: err instanceof ApiError && err.txResult ? err.txResult : undefined,
      });
    }
  };

  return (
    <div className="overflow-hidden rounded-panel border border-line bg-surface">
      <OutcomeBanner
        outcome={outcome}
        milestone={m}
        builderName={builderName}
        paidCents={paid}
        total={total}
        failed={failed}
        decision={latest("decision")}
        failedChecks={results.filter((c) => c.result === "fail").map((c) => c.check)}
        action={
          canRun && (
            <Button size="lg" variant={m.status === "failed" ? "secondary" : "primary"} className={m.status === "failed" ? "bg-surface hover:bg-band" : undefined} onClick={runChecks} disabled={running}>
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
        {rows.map((r, i) => (
          <CheckRow key={r.check.check} check={r.check} state={stateAt(i + 1, r.result)} evidence={evidence} />
        ))}
      </ul>
      {status.verdict && !running && !revealing && <VerdictRow verdict={status.verdict} />}
      <Proof
        className="border-t border-line px-5"
        items={[
          { label: "Escrow created", value: m.escrow?.createTx && <TxLink hash={m.escrow.createTx} /> },
          { label: "Released", value: m.escrow?.finishTx && <TxLink hash={m.escrow.finishTx} /> },
          { label: "Returned", value: m.escrow?.cancelTx && <TxLink hash={m.escrow.cancelTx} /> },
          { label: "Escrow expires", value: m.cancelAfter && formatDate(m.cancelAfter) },
          { label: "Audit", value: audit?.txHash && <TxLink hash={audit.txHash} /> },
          { label: "Audit signer", value: audit && <Address address={audit.inspector} /> },
          { label: "Audit note", value: audit?.notes && `“${audit.notes}”` },
          { label: "Verdict", value: verdictTx && <TxLink hash={verdictTx} /> },
          { label: "Verdict hash", value: verdictHash && <span className="font-mono text-[12px] break-all">{verdictHash}</span> },
          { label: "Model", value: status.verdict && (status.verdict.model === "mock" ? "Mock verifier" : status.verdict.model) },
          { label: "Decision", value: decisionTx && <TxLink hash={decisionTx} /> },
          { label: "SoV lines", value: (m.sovCodes ?? []).join(", ") },
        ]}
      />
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
