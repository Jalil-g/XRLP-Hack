// One row per SoV line: done / partial / not_done + note. The line's visual criteria say what "done" looks like.
import { Check, CircleDashed, X } from "lucide-react";
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
          <li key={line.code} id={`checklist.${line.code}`} className={cn("space-y-2.5 px-5 py-4", missing && "bg-bad-bg/60")}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold">
                  <span className="font-mono text-faint">{line.code}</span> {line.title}
                </p>
                <p className="text-xs text-muted">
                  {line.trade} · <span className="tabular">{formatRlusd(line.amount)}</span>
                </p>
              </div>
              <div role="radiogroup" aria-label={`${line.code} status`} className="flex gap-1">
                {OPTIONS.map(({ value: v, label, Icon, on }) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={entry.status === v}
                    onClick={() => onChange(line.code, { ...entry, status: v })}
                    className={cn(
                      "flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium ring-1 ring-line transition-colors ring-inset",
                      entry.status === v ? on : "bg-surface text-ink-2 hover:bg-subtle",
                    )}
                  >
                    <Icon className="size-3.5" /> {label}
                  </button>
                ))}
              </div>
            </div>
            {line.visualCriteria.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted">
                {line.visualCriteria.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
            <input
              type="text"
              value={entry.note}
              onChange={(e) => onChange(line.code, { ...entry, note: e.target.value })}
              placeholder={needsNote ? `Required: what is ${entry.status === "partial" ? "missing" : "not done"}?` : "Note (optional)"}
              aria-label={`${line.code} note`}
              className={cn(
                "w-full rounded-md border bg-surface px-3 py-1.5 text-sm placeholder:text-faint focus:ring-2 focus:ring-brand-100 focus:outline-none",
                missing && needsNote ? "border-bad" : "border-line",
              )}
            />
          </li>
        );
      })}
    </ol>
  );
}
