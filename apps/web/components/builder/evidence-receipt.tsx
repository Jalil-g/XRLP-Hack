import type { ProjectDetail } from "@/lib/contract";

export function EvidenceReceipt({ detail }: { detail: Pick<ProjectDetail, "project" | "builder" | "evidence"> }) {
  const submissions = detail.project.milestones.filter((milestone) => detail.evidence?.[milestone.id]?.length);
  const fileCount = submissions.reduce((total, milestone) => total + (detail.evidence?.[milestone.id]?.length ?? 0), 0);
  if (!fileCount) return null;
  return <section aria-label="Evidence submission receipt" className="mb-6 rounded-panel border border-line bg-surface p-5">
    <details>
      <summary className="min-h-11 cursor-pointer text-body font-semibold">Evidence received · {fileCount} file{fileCount === 1 ? "" : "s"} on record</summary>
      <p className="mt-1 text-small text-ink-2">Saved to {detail.project.name} by {detail.builder.name}. Submission is not a release of funds.</p>
      <ul className="mt-3 divide-y divide-line">{submissions.map((milestone) => <li key={milestone.id} className="py-3 text-small">
        <p className="font-medium">{milestone.title}</p>
        <ul className="mt-2 space-y-1 text-ink-2">{detail.evidence?.[milestone.id]?.map((file) => <li key={file.id} className="break-words">{file.filename} · {file.kind}</li>)}</ul>
      </li>)}</ul>
    </details>
    <p className="text-caption text-ink-2">Saved evidence remains on record while audits and checks progress. Open the receipt to review files.</p>
  </section>;
}
