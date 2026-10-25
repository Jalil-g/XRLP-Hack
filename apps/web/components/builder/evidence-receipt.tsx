// The builder's saved evidence, on demand: one "17 files" row that opens the receipt, grouped by milestone.
// Built from the project record, so it survives fresh renders and milestone status changes.
import { ChevronRight } from "lucide-react";
import type { ProjectDetail } from "@/lib/contract";

export function EvidenceReceipt({ detail }: { detail: Pick<ProjectDetail, "project" | "builder" | "evidence"> }) {
  const submissions = detail.project.milestones.filter((milestone) => detail.evidence?.[milestone.id]?.length);
  const fileCount = submissions.reduce((total, milestone) => total + (detail.evidence?.[milestone.id]?.length ?? 0), 0);
  if (!fileCount) return null;
  return (
    <details aria-label="Evidence receipt" className="proof group">
      <summary className="inline-flex min-h-11 items-center gap-1 text-small font-medium text-ink-2 hover:text-ink">
        <ChevronRight className="proof-chevron size-4 transition-transform duration-150" aria-hidden />
        <span className="tabular-nums">
          {fileCount} file{fileCount === 1 ? "" : "s"}
        </span>
      </summary>
      <div className="grid gap-x-10 gap-y-4 pb-4 pl-5 sm:grid-cols-2 lg:grid-cols-3">
        {submissions.map((milestone) => (
          <section key={milestone.id} aria-label={milestone.title} className="min-w-0">
            <h4 className="text-small font-semibold text-ink">
              <span className="mr-1.5 tabular-nums text-ink-3">{milestone.index + 1}</span>
              {milestone.title}
            </h4>
            <ul className="mt-1.5 divide-y divide-line border-y border-line">
              {detail.evidence?.[milestone.id]?.map((file) => (
                <li key={file.id} className="flex items-baseline justify-between gap-4 py-1.5 text-small">
                  <span className="min-w-0 break-all text-ink">{file.filename}</span>
                  <span className="shrink-0 text-caption text-ink-3 capitalize">{file.kind}</span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </details>
  );
}
