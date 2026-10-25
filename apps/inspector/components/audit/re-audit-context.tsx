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
    <CardHeader><CardTitle>Review before re-auditing</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-ink-2">Review the latest builder evidence and record fresh observations. Your new report supersedes your previous report for the next suite; earlier attestations remain on the ledger.</p>
      <section aria-label="Checks to address" className="space-y-2">
        <h3 className="text-sm font-semibold">Checks to address</h3>
        <p className="text-xs text-muted">Latest recorded suite: {checks?.outcome.replaceAll("_", " ") ?? "unavailable"}{checks?.verdict && ` · ${formatDateTime(checks.verdict.createdAt)}`}. These results may predate the current evidence.</p>
        {issues.length ? <ul className="space-y-3">{issues.map((check, i) => <li key={`${check.check}:${i}`} className="rounded-md bg-subtle p-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={check.result === "fail" ? "bad" : "warn"}>{check.result}</Badge>
            <span className="break-all font-mono text-xs">{check.check}</span>
            <span className="text-xs text-muted">{check.required ? "Required" : "Optional"}</span>
          </div>
          <p className="mt-2">{check.reason}</p>
          {check.evidenceIds.length > 0 && <p className="mt-1 break-words text-xs text-muted">Referenced files: {check.evidenceIds.map((id) => task.evidence.find((e) => e.id === id)?.filename ?? `${id} (not in current bundle)`).join(", ")}</p>}
        </li>)}</ul> : <p className="text-sm text-muted">No failed or warning checks are available in the latest response. Review the current evidence; this does not mean the milestone passed.</p>}
      </section>
      <section aria-label="Evidence comparison" className="space-y-2 border-t border-line pt-3">
        <h3 className="text-sm font-semibold">Current builder evidence</h3>
        <p className="text-sm text-muted">{comparison === "changed"
          ? "The builder evidence differs from your previous audit. Review every current file before signing."
          : comparison === "same" ? "The builder evidence is unchanged from your previous audit. Re-check the observations the suite questioned."
          : "Evidence comparison is unavailable until both bundle hashes are known."}</p>
        <p className="break-all font-mono text-xs text-muted">Current bundle: {bundle ?? "Computing…"}</p>
        <button type="button" onClick={onReload} disabled={busy} className="text-sm font-medium text-brand hover:underline disabled:opacity-50">Reload evidence and clear draft</button>
        <p className="text-xs text-muted">The files stay fixed while you review. Reloading discards your current checklist, notes and selected photos.</p>
      </section>
      {prior ? <details className="border-t border-line pt-3">
        <summary className="cursor-pointer text-sm font-semibold">Your previous report · {formatDateTime(prior.at)}</summary>
        <div className="mt-3 space-y-3">
          {prior.txHash && <a href={explorerTxUrl(prior.txHash)} target="_blank" rel="noreferrer" className="text-xs text-brand hover:underline">Previous attestation {shortHash(prior.txHash)}</a>}
          <ul className="space-y-2">{prior.checklist.map((line) => <li key={line.sovCode} className="text-sm">
            <span className="font-mono text-xs">{line.sovCode}</span> <Badge tone={line.status === "done" ? "ok" : line.status === "partial" ? "warn" : "bad"}>{line.status.replaceAll("_", " ")}</Badge>
            {line.note && <p className="mt-1 whitespace-pre-wrap text-muted">{line.note}</p>}
          </li>)}</ul>
          {prior.notes && <p className="whitespace-pre-wrap text-sm text-muted">{prior.notes}</p>}
          <p className="break-all font-mono text-xs text-muted">Previous bundle: {prior.evidenceBundleHash}</p>
          {prior.photos.length > 0 && <EvidenceGallery evidence={prior.photos} site={task.siteGeo} />}
        </div>
      </details> : <p className="text-sm text-muted">No earlier report from you is available for this milestone.</p>}
    </CardContent>
  </Card>;
}
