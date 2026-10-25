import { AlertCircle, CheckCircle2, CircleDashed, Loader2, MinusCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type RowState = "pass" | "fail" | "warn" | "skipped" | "queued" | "running";

const ICONS = {
  pass: { Icon: CheckCircle2, className: "text-pass", label: "Passed" },
  fail: { Icon: XCircle, className: "text-fail", label: "Failed" },
  warn: { Icon: AlertCircle, className: "text-review-icon", label: "Needs review" },
  skipped: { Icon: MinusCircle, className: "text-ink-3", label: "Skipped" },
  queued: { Icon: CircleDashed, className: "text-line-2", label: "Not run" },
  running: { Icon: Loader2, className: "animate-spin text-ink-3", label: "Running" },
} as const;

export function StatusIcon({ state, className }: { state: RowState; className?: string }) {
  const { Icon, className: tone, label } = ICONS[state];
  return <Icon className={cn("size-5 shrink-0 transition-colors duration-200", tone, className)} aria-label={label} role="img" />;
}

/** Shared row grid so check, audit and verdict rows align: icon, name, detail, flagged evidence. */
export const ROW_GRID = "check-row items-center gap-x-3 gap-y-0.5 px-5 py-2.5 min-h-11";
