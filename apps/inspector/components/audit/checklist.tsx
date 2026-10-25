// One row per SoV line: done / partial / not_done. The note appears once the answer is not "done" (required then).
import { Check, CircleDashed, X } from "lucide-react";
import { NoteField } from "@/components/audit/note-field";
import type { ChecklistDraft } from "@/lib/audit";
import type { ChecklistStatus, SovLine } from "@/lib/types";
import { cn, formatRlusd } from "@/lib/utils";

const OPTIONS: { value: ChecklistStatus; label: string; Icon: typeof Check; on: string }[] = [
  { value: "done", label: "Done", Icon: Check, on: "bg-ok text-white ring-ok" },
  { value: "partial", label: "Partial", Icon: CircleDashed, on: "bg-warn text-white ring-warn" },
  { value: "not_done", label: "Not done", Icon: X, on: "bg-bad text-white ring-bad" },
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
          <li key={line.code} id={`checklist.${line.code}`} className={cn("space-y-3 px-5 py-5 sm:px-6", missing && "bg-bad-bg/60")}>
            <div className="grid items-start gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <p className="text-small font-semibold">
                  <span className="font-mono text-faint">{line.code}</span> {line.title}
                </p>
                <p className="flex gap-x-4 text-caption text-muted">
                  <span>{line.trade}</span>
                  <span className="tabular">{formatRlusd(line.amount)}</span>
                </p>
              </div>
              <div role="group" aria-label={`${line.code} status`} className="flex gap-1">
                {OPTIONS.map(({ value: v, label, Icon, on }) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={entry.status === v}
                    onClick={() => onChange(line.code, { ...entry, status: v })}
                    className={cn(
                      "flex min-h-11 items-center gap-1 rounded-control px-2.5 py-1.5 text-caption font-medium ring-1 ring-line transition-colors ring-inset",
                      entry.status === v ? on : "bg-surface text-ink-2 hover:bg-subtle",
                    )}
                  >
                    <Icon className="size-3.5" /> {label}
                  </button>
                ))}
              </div>
            </div>
            {line.visualCriteria.length > 0 && (
              <details className="text-caption text-muted">
                <summary className="cursor-pointer font-medium">Done means</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
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
