// Why this milestone is back: the suite's failing checks first, whether the builder's evidence changed since your last
// report, and that report on demand. Hashes and the previous attestation live in Proof.
import { ChevronRight } from "lucide-react";
import { EvidenceGallery } from "@/components/audit/evidence-gallery";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Proof } from "@/components/ui/proof";
import { StatusIcon } from "@/components/ui/status-icon";
import { bundleComparison, latestOwnAudit, reviewIssues } from "@/lib/re-audit";
import type { ChecksStatus, InspectorTask } from "@/lib/types";
import { cn, explorerTxUrl, formatDateTime, shortHash } from "@/lib/utils";
import { API_MODE } from "@/lib/api";

export const checkLabel = (id: string) => {
  const s = id.replaceAll("_", " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const LINE_STATE = { done: "pass", partial: "warn", not_done: "fail" } as const;
const LINE_LABEL = { done: "Done", partial: "Partial", not_done: "Not done" } as const;

export function ReAuditContext({ task, inspector, checks, bundle, onReload, busy }: {
  task: InspectorTask; inspector: string; checks?: ChecksStatus; bundle?: string; onReload(): void; busy: boolean;
}) {
  const prior = latestOwnAudit(task, inspector);
  const comparison = bundleComparison(bundle, prior?.evidenceBundleHash);
  const issues = reviewIssues(checks);
  return (
    <Card aria-label="Re-audit">
      <CardHeader>
        <CardTitle>Checks to address</CardTitle>
        {checks?.verdict && <span className="text-caption text-ink-2 tabular">{formatDateTime(checks.verdict.createdAt)}</span>}
      </CardHeader>
      {issues.length ? (
        <ul className="divide-y divide-line">
          {issues.map((check, i) => (
            <li key={`${check.check}:${i}`} className={cn("grid grid-cols-[20px_minmax(0,1fr)] gap-x-3 px-5 py-3", check.result === "fail" ? "bg-fail-bg/60" : "bg-review-bg/60")}>
              <StatusIcon state={check.result} className="mt-0.5" />
              <div className="min-w-0">
                <p className="flex flex-wrap items-baseline gap-x-3">
                  <span className="font-medium">{checkLabel(check.check)}</span>
                  {!check.required && <span className="text-caption text-ink-2">Optional</span>}
                </p>
                <p className={cn("mt-0.5 text-small", check.result === "fail" ? "text-fail" : "text-review")}>{check.reason}</p>
                {check.evidenceIds.length > 0 && (
                  <p className="mt-1 text-caption break-words text-ink-2">
                    {check.evidenceIds.map((id) => task.evidence.find((e) => e.id === id)?.filename ?? `${id} (not in current bundle)`).join(", ")}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-4 text-small text-ink-2">No failed checks</p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
        <p className="text-small font-medium">
          {comparison === "changed" ? "Evidence changed since your report" : comparison === "same" ? "Evidence unchanged since your report" : "Evidence comparison unavailable"}
        </p>
        <Button size="sm" variant="secondary" onClick={onReload} disabled={busy} title="Discards your current checklist, notes and selected photos.">
          Reload evidence
        </Button>
      </div>

      {prior ? (
        <details className="disclosure border-t border-line px-5">
          <summary className="flex min-h-12 items-center gap-1 text-small font-medium text-ink-2 hover:text-ink">
            <ChevronRight className="disclosure-chevron size-4 transition-transform duration-150" aria-hidden />
            Previous report
            <span className="ml-2 font-normal text-ink-3 tabular">{formatDateTime(prior.at)}</span>
          </summary>
          <div className="space-y-4 pb-4 pl-5">
            <ul className="divide-y divide-line border-y border-line">
              {prior.checklist.map((line) => (
                <li key={line.sovCode} className="py-2.5 text-small">
                  <div className="flex items-center gap-3">
                    <StatusIcon state={LINE_STATE[line.status]} className="size-4" />
                    <span className="min-w-0 flex-1">{task.sov.find((s) => s.code === line.sovCode)?.title ?? line.sovCode}</span>
                    <span className="text-ink-2">{LINE_LABEL[line.status]}</span>
                  </div>
                  {line.note && <p className="mt-1 pl-7 whitespace-pre-wrap text-ink-2">{line.note}</p>}
                </li>
              ))}
            </ul>
            {prior.notes && <p className="whitespace-pre-wrap text-small text-ink-2">{prior.notes}</p>}
            {prior.photos.length > 0 && <EvidenceGallery evidence={prior.photos} site={task.siteGeo} />}
          </div>
        </details>
      ) : (
        <p className="border-t border-line px-5 py-3 text-small text-ink-2">No earlier report</p>
      )}

      <Proof
        className="border-t border-line px-5"
        items={[
          { label: "Current bundle", value: <span className="font-mono text-caption break-all">{bundle ?? "Computing…"}</span> },
          { label: "Previous bundle", value: prior && <span className="font-mono text-caption break-all">{prior.evidenceBundleHash}</span> },
          {
            label: "Previous attestation",
            value: prior?.txHash && (API_MODE === "mock"
              ? <span className="font-mono">{shortHash(prior.txHash)}</span>
              : <a href={explorerTxUrl(prior.txHash)} target="_blank" rel="noreferrer" className="font-mono underline">{shortHash(prior.txHash)}</a>),
          },
          { label: "Suite", value: checks && checkLabel(checks.outcome) },
        ]}
      />
    </Card>
  );
}
