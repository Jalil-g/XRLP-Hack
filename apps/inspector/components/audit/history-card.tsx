import { ExternalLink } from "lucide-react";
import { EvidenceGallery } from "@/components/audit/evidence-gallery";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { AUDIT_CHECKS, type AuditHistoryEntry } from "@/lib/history";
import type { CheckResult } from "@/lib/types";
import { explorerTxUrl, formatDateTime, formatRlusd, shortHash } from "@/lib/utils";

const tone: Record<string, Tone> = { pass: "ok", fail: "bad", warn: "warn", needs_human: "warn", pending: "neutral", skipped: "neutral" };
const label: Record<string, string> = { pass: "Passed", fail: "Failed", needs_human: "Needs human review", pending: "Pending", warn: "Warning", skipped: "Skipped" };
const auditCheckNames: Record<string, string> = {
  inspector_audit_present: "Signed audit present",
  audit_checklist_complete: "Audit checklist complete",
  audit_matches_evidence: "Audit agrees with evidence",
};

export function AuditHistoryCard({ entry }: { entry: AuditHistoryEntry }) {
  const { project, milestone, audit, checks, releaseTx, verdictPredatesAudit } = entry;
  const results = [...checks.required, ...checks.optional];
  const fed = AUDIT_CHECKS.map((id) => ({ id, result: results.find((c) => c.check === id) }));
  return (
    <Card>
      <CardHeader className="flex-wrap">
        <div>
          <p className="text-xs font-medium text-muted">{project.name} · M{milestone.index + 1}</p>
          <h2 className="mt-1 text-lg font-semibold">{milestone.title}</h2>
          <p className="mt-1 text-xs text-muted">Filed {formatDateTime(audit.at)} · {formatRlusd(milestone.amount)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={tone[checks.outcome]}>Latest suite: {label[checks.outcome]}</Badge>
          <Badge tone={releaseTx ? "ok" : "neutral"}>{releaseTx ? "Released" : milestone.status.replaceAll("_", " ")}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
          {audit.txHash ? <TxLink hash={audit.txHash} label="Audit attestation" /> : <span className="text-warn">No audit attestation recorded</span>}
          {releaseTx ? <TxLink hash={releaseTx} label="Release transaction" /> : <span className="text-muted">No release transaction recorded</span>}
        </div>

        {verdictPredatesAudit && <p className="rounded-md bg-warn-bg p-3 text-sm text-warn">The latest verdict predates this report. This audit is awaiting a new suite run.</p>}
        <section aria-label="Checks that use inspector audits" className="space-y-2">
          <h3 className="text-sm font-semibold">What your audit feeds</h3>
          <p className="text-xs text-muted">These checks use inspector reports. Results below are the latest for this milestone, shared across its audits.</p>
          <ul className="grid gap-3 md:grid-cols-3">
            {fed.map(({ id, result }) => (
              <li key={id} className="space-y-2 rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{auditCheckNames[id]}</span>
                  {result ? <Badge tone={tone[result.result]}>{label[result.result]}</Badge> : <Badge>No result</Badge>}
                </div>
                <p className="break-all font-mono text-[11px] text-faint">{id}</p>
                <p className="text-xs text-muted">{result?.reason ?? "No check result recorded yet."}</p>
              </li>
            ))}
          </ul>
        </section>

        {checks.verdict && <p className="text-sm text-ink-2">{checks.verdict.summary} <span className="text-xs text-muted">({Math.round(checks.verdict.confidence * 100)}% confidence · {formatDateTime(checks.verdict.createdAt)})</span></p>}
        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-sm font-medium">All milestone checks ({results.length})</summary>
          {results.length ? <div className="mt-3 space-y-4">
            <CheckList title="Required" checks={checks.required} />
            <CheckList title="Optional" checks={checks.optional} />
          </div> : <p className="mt-3 text-sm text-muted">The suite has not reported any checks yet.</p>}
        </details>
        <details className="rounded-lg border border-line p-3">
          <summary className="cursor-pointer text-sm font-medium">Submitted report · {audit.checklist.length} SoV lines · {audit.photos.length} {audit.photos.length === 1 ? "photo" : "photos"}</summary>
          <div className="mt-3 space-y-4">
            <ul className="divide-y divide-line">
              {audit.checklist.map((line) => <li key={line.sovCode} className="py-2 text-sm">
                <div className="flex flex-wrap justify-between gap-2">
                  <span>{line.sovCode} · {project.sov?.find((s) => s.code === line.sovCode)?.title ?? "SoV line"}</span>
                  <Badge tone={line.status === "done" ? "ok" : "warn"}>{line.status.replaceAll("_", " ")}</Badge>
                </div>
                {line.note && <p className="mt-1 whitespace-pre-wrap text-muted">{line.note}</p>}
              </li>)}
            </ul>
            {audit.notes && <p className="whitespace-pre-wrap text-sm text-ink-2">{audit.notes}</p>}
            <p className="break-all font-mono text-xs text-muted">Evidence bundle: {audit.evidenceBundleHash}</p>
            {audit.photos.length > 0 && <EvidenceGallery evidence={audit.photos} site={project.siteGeo} />}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function TxLink({ hash, label }: { hash: string; label: string }) {
  return <a href={explorerTxUrl(hash)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand hover:underline">
    {label} <span className="font-mono">{shortHash(hash)}</span><ExternalLink className="size-3.5" />
  </a>;
}

function CheckList({ title, checks }: { title: string; checks: CheckResult[] }) {
  if (!checks.length) return null;
  return <div>
    <h4 className="mb-2 text-xs font-semibold text-muted">{title}</h4>
    <ul className="divide-y divide-line">{checks.map((check, i) => <li key={`${check.check}:${i}`} className="py-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone[check.result]}>{label[check.result]}</Badge>
        <span className="break-all font-mono text-xs">{check.check}</span>
      </div>
      <p className="mt-1 text-xs text-muted">{check.reason}</p>
    </li>)}</ul>
  </div>;
}
