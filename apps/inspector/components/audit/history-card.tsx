// One submitted report: title and where its money stands, then the checks that consume the audit (like the web project's
// checks suite), the full suite and the report on demand, and hashes in Proof.
import { Check, ChevronRight } from "lucide-react";
import { EvidenceGallery } from "@/components/audit/evidence-gallery";
import { checkLabel } from "@/components/audit/re-audit-context";
import { Facts } from "@/components/ui/layout";
import { Proof } from "@/components/ui/proof";
import { StatusIcon } from "@/components/ui/status-icon";
import { API_MODE } from "@/lib/api";
import { AUDIT_CHECKS, type AuditHistoryEntry } from "@/lib/history";
import type { CheckResult } from "@/lib/types";
import { cn, explorerTxUrl, formatAmount, formatDateTime, shortHash } from "@/lib/utils";

const auditCheckNames: Record<string, string> = {
  inspector_audit_present: "Signed audit present",
  audit_checklist_complete: "Audit checklist complete",
  audit_matches_evidence: "Audit agrees with evidence",
};
const LINE_STATE = { done: "pass", partial: "warn", not_done: "fail" } as const;
const LINE_LABEL = { done: "Done", partial: "Partial", not_done: "Not done" } as const;

function Outcome({ entry }: { entry: AuditHistoryEntry }) {
  const { checks, releaseTx, milestone } = entry;
  if (releaseTx) {
    return (
      <span className="inline-flex items-center gap-2 font-semibold">
        <span className="flex size-[22px] items-center justify-center rounded-full bg-accent text-ink ring-1 ring-black/10"><Check className="size-3.5 stroke-[3]" aria-hidden /></span>
        Released
      </span>
    );
  }
  const st = milestone.status.replaceAll("_", " ");
  const label = checks.outcome === "fail" ? "Checks failed" : checks.outcome === "needs_human" ? "Needs review" : st.charAt(0).toUpperCase() + st.slice(1);
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold", checks.outcome === "fail" ? "text-fail" : checks.outcome === "needs_human" ? "text-review" : "text-ink")}>
      <StatusIcon state={checks.outcome} />
      {label}
    </span>
  );
}

export function AuditHistoryCard({ entry }: { entry: AuditHistoryEntry }) {
  const { project, milestone, audit, checks, releaseTx, verdictPredatesAudit } = entry;
  const results = [...checks.required, ...checks.optional];
  const fed = AUDIT_CHECKS.map((id) => ({ id, result: results.find((c) => c.check === id) }));
  const link = (hash: string) =>
    API_MODE === "mock" ? <span className="font-mono">{shortHash(hash)}</span> : (
      <a href={explorerTxUrl(hash)} target="_blank" rel="noreferrer" className="font-mono underline">{shortHash(hash)}</a>
    );
  return (
    <article className="min-w-0 space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
        <div className="min-w-0">
          <h2 className="text-heading">
            {project.name} <span className="text-ink-3">{milestone.title}</span>
          </h2>
        </div>
        <Facts
          items={[
            { label: "Filed", value: formatDateTime(audit.at) },
            { label: "Milestone", value: <>{formatAmount(milestone.amount)} <span className="text-caption font-medium text-ink-2">RLUSD</span></> },
            { label: "Status", value: <Outcome entry={entry} /> },
          ]}
        />
      </header>

      <div className="overflow-hidden rounded-panel border border-line bg-surface">
        {verdictPredatesAudit && <p className="border-b border-line bg-review-bg px-5 py-3 text-small font-medium text-review">Verdict predates this report</p>}
        <ul aria-label="Checks that use inspector audits" className="divide-y divide-line">
          {fed.map(({ id, result }) => (
            <CheckLine key={id} name={auditCheckNames[id] ?? checkLabel(id)} result={result} />
          ))}
        </ul>
        {checks.verdict && (
          <p className="flex flex-wrap items-baseline gap-x-4 border-t border-line px-5 py-3 text-small">
            <span className="min-w-0 flex-1 text-ink">{checks.verdict.summary}</span>
            <span className="text-caption text-ink-2 tabular">{Math.round(checks.verdict.confidence * 100)}% confidence</span>
          </p>
        )}
        <Disclosure label="All checks" count={results.length}>
          {results.length ? (
            <ul className="divide-y divide-line border-t border-line">
              {[...checks.required.map((c) => ({ c, req: true })), ...checks.optional.map((c) => ({ c, req: false }))].map(({ c, req }, i) => (
                <CheckLine key={`${c.check}:${i}`} name={checkLabel(c.check)} result={c} optional={!req} />
              ))}
            </ul>
          ) : (
            <p className="px-5 pb-4 text-small text-ink-2">No checks yet</p>
          )}
        </Disclosure>
        <Disclosure label="Submitted report" count={audit.checklist.length}>
          <div className="space-y-4 px-5 pb-5">
            <ul className="divide-y divide-line border-y border-line">
              {audit.checklist.map((line) => (
                <li key={line.sovCode} className="py-2.5 text-small">
                  <div className="flex items-center gap-3">
                    <StatusIcon state={LINE_STATE[line.status]} className="size-4" />
                    <span className="min-w-0 flex-1">{project.sov?.find((s) => s.code === line.sovCode)?.title ?? line.sovCode}</span>
                    <span className="text-ink-2">{LINE_LABEL[line.status]}</span>
                  </div>
                  {line.note && <p className="mt-1 pl-7 whitespace-pre-wrap text-ink-2">{line.note}</p>}
                </li>
              ))}
            </ul>
            {audit.notes && <p className="whitespace-pre-wrap text-small text-ink">{audit.notes}</p>}
            {audit.photos.length > 0 && <EvidenceGallery evidence={audit.photos} site={project.siteGeo} />}
          </div>
        </Disclosure>
        <Proof
          className="border-t border-line px-5"
          items={[
            { label: "Audit attestation", value: audit.txHash ? link(audit.txHash) : <span className="text-review">None</span> },
            { label: "Release", value: releaseTx && link(releaseTx) },
            { label: "Evidence bundle", value: <span className="font-mono text-caption break-all">{audit.evidenceBundleHash}</span> },
            { label: "Verdict", value: checks.verdict && formatDateTime(checks.verdict.createdAt) },
          ]}
        />
      </div>
    </article>
  );
}

function CheckLine({ name, result, optional }: { name: string; result?: CheckResult; optional?: boolean }) {
  const loud = result?.result === "fail" || result?.result === "warn";
  return (
    <li className={cn("grid grid-cols-[20px_minmax(0,1fr)] items-start gap-x-3 px-5 py-2.5 lg:grid-cols-[20px_minmax(0,280px)_minmax(0,1fr)]", result?.result === "fail" && "bg-fail-bg/60", result?.result === "warn" && "bg-review-bg/60")}>
      <StatusIcon state={result?.result ?? "pending"} className="mt-px" />
      <span className="font-medium">
        {name}
        {optional && <span className="ml-2 text-caption font-normal text-ink-2">Optional</span>}
      </span>
      <span className={cn("text-small max-lg:col-start-2", loud ? (result?.result === "fail" ? "font-medium text-fail" : "font-medium text-review") : "text-ink-3")}>
        {result?.reason ?? "No result"}
      </span>
    </li>
  );
}

function Disclosure({ label, count, children }: { label: string; count: number; children: React.ReactNode }) {
  return (
    <details className="disclosure border-t border-line">
      <summary className="flex min-h-12 items-center gap-1 px-5 text-small font-medium text-ink-2 hover:text-ink">
        <ChevronRight className="disclosure-chevron size-4 transition-transform duration-150" aria-hidden />
        {label}
        <span className="ml-1.5 font-normal text-ink-3 tabular">{count}</span>
      </summary>
      {children}
    </details>
  );
}
