import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EvidenceGallery } from "@/components/audit/evidence-gallery";
import { bundleComparison, latestOwnAudit, reviewIssues } from "@/lib/re-audit";
import type { ChecksStatus, InspectorTask } from "@/lib/types";
import { explorerTxUrl, formatDateTime, shortHash } from "@/lib/utils";

export function ReAuditContext({ task, inspector, checks, bundle, onReload, busy }: {
  task: InspectorTask; inspector: string; checks?: ChecksStatus; bundle?: string; onReload(): void; busy: boolean;
}) {
  const prior = latestOwnAudit(task, inspector);
  const comparison = bundleComparison(bundle, prior?.evidenceBundleHash);
  const issues = reviewIssues(checks);
  return <Card className="border-warn-line">
    <CardHeader><CardTitle>Re-audit</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <section aria-label="Checks to address" className="space-y-2">
        <h3 className="text-small font-semibold">Checks to address</h3>
        <p className="flex flex-wrap gap-x-4 text-caption text-muted"><span>Latest suite: {checks?.outcome.replaceAll("_", " ") ?? "unavailable"}</span>{checks?.verdict && <span>{formatDateTime(checks.verdict.createdAt)}</span>}</p>
        {issues.length ? <ul className="space-y-3">{issues.map((check, i) => <li key={`${check.check}:${i}`} className="rounded-md bg-subtle p-3 text-small">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={check.result === "fail" ? "bad" : "warn"}>{check.result}</Badge>
            <span className="break-all font-mono text-caption">{check.check}</span>
            <span className="text-caption text-muted">{check.required ? "Required" : "Optional"}</span>
          </div>
          <p className="mt-2">{check.reason}</p>
          {check.evidenceIds.length > 0 && <p className="mt-1 break-words text-caption text-muted">Referenced files: {check.evidenceIds.map((id) => task.evidence.find((e) => e.id === id)?.filename ?? `${id} (not in current bundle)`).join(", ")}</p>}
        </li>)}</ul> : <p className="text-small text-muted">No failed checks</p>}
      </section>
      <section aria-label="Evidence comparison" className="space-y-2 border-t border-line pt-3">
        <h3 className="text-small font-semibold">Current builder evidence</h3>
        <p className="text-small text-muted">{comparison === "changed" ? "Evidence changed" : comparison === "same" ? "Evidence unchanged" : "Comparison unavailable"}</p>
        <p className="break-all font-mono text-caption text-muted">Current bundle: {bundle ?? "Computing…"}</p>
        <button type="button" onClick={onReload} disabled={busy} title="Discards your current checklist, notes and selected photos." className="block min-h-11 text-small font-medium text-brand hover:underline disabled:opacity-50">Reload evidence</button>
      </section>
      {prior ? <details className="border-t border-line pt-3">
        <summary className="cursor-pointer text-small font-semibold">Previous report <span className="ml-3 font-normal text-muted">{formatDateTime(prior.at)}</span></summary>
        <div className="mt-3 space-y-3">
          {prior.txHash && <a href={explorerTxUrl(prior.txHash)} target="_blank" rel="noreferrer" className="text-caption text-brand hover:underline">Previous attestation {shortHash(prior.txHash)}</a>}
          <ul className="space-y-2">{prior.checklist.map((line) => <li key={line.sovCode} className="text-small">
            <span className="font-mono text-caption">{line.sovCode}</span> <Badge tone={line.status === "done" ? "ok" : line.status === "partial" ? "warn" : "bad"}>{line.status.replaceAll("_", " ")}</Badge>
            {line.note && <p className="mt-1 whitespace-pre-wrap text-muted">{line.note}</p>}
          </li>)}</ul>
          {prior.notes && <p className="whitespace-pre-wrap text-small text-muted">{prior.notes}</p>}
          <p className="break-all font-mono text-caption text-muted">Previous bundle: {prior.evidenceBundleHash}</p>
          {prior.photos.length > 0 && <EvidenceGallery evidence={prior.photos} site={task.siteGeo} />}
        </div>
      </details> : <p className="text-small text-muted">No earlier report</p>}
    </CardContent>
  </Card>;
}
