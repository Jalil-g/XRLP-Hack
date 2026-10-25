// One row per SoV line: done / partial / not_done. The note appears once the answer is not "done" (required then).
import { Check, ChevronRight, CircleDashed, X } from "lucide-react";
import { NoteField } from "@/components/audit/note-field";
import { Segmented, type Segment } from "@/components/ui/segmented";
import type { ChecklistDraft } from "@/lib/audit";
import type { ChecklistStatus, SovLine } from "@/lib/types";
import { cn, formatAmount } from "@/lib/utils";

const OPTIONS: Segment<ChecklistStatus>[] = [
  { value: "done", label: "Done", Icon: Check, tone: "pass" },
  { value: "partial", label: "Partial", Icon: CircleDashed, tone: "review" },
  { value: "not_done", label: "Not done", Icon: X, tone: "fail" },
];

export function Checklist({
  sov,
  value,
  onChange,
  showErrors,
}: {
  sov: SovLine[];
  value: ChecklistDraft;
  onChange(code: string, next: ChecklistDraft[string]): void;
  showErrors: boolean;
}) {
  return (
    <ol className="divide-y divide-line">
      {sov.map((line) => {
        const entry = value[line.code] ?? { note: "" };
        const needsNote = entry.status && entry.status !== "done";
        const missing = showErrors && (!entry.status || (needsNote && !entry.note.trim()));
        return (
          <li key={line.code} id={`checklist.${line.code}`} className={cn("space-y-3 px-5 py-4", missing && "bg-fail-bg/60")}>
            <div className="grid items-center gap-x-4 gap-y-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <p className="text-body font-medium">{line.title}</p>
                <p className="mt-0.5 flex flex-wrap gap-x-4 text-caption text-ink-2">
                  <span className="font-mono text-ink-3">{line.code}</span>
                  <span className="capitalize">{line.trade}</span>
                  <span className="tabular">{formatAmount(line.amount)}</span>
                </p>
              </div>
              <Segmented label={`${line.code} status`} options={OPTIONS} value={entry.status} onChange={(v) => onChange(line.code, { ...entry, status: v })} className="w-full sm:w-auto" />
            </div>
            {line.visualCriteria.length > 0 && (
              <details className="disclosure text-caption text-ink-2">
                <summary className="-my-2 inline-flex min-h-11 items-center gap-1 font-medium hover:text-ink">
                  <ChevronRight className="disclosure-chevron size-3.5 transition-transform duration-150" aria-hidden />
                  Done means
                </summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-9">
                  {line.visualCriteria.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </details>
            )}
            {entry.status !== undefined && (
              <NoteField
                label={`${line.code} note`}
                value={entry.note}
                onChange={(note) => onChange(line.code, { ...entry, note })}
                required={Boolean(needsNote)}
                invalid={Boolean(missing && needsNote)}
                placeholder={entry.status === "partial" ? "What is missing?" : entry.status === "not_done" ? "What is not done?" : "Note"}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
