import { AlertCircle, CheckCircle2, CircleDashed, MinusCircle, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type RowState = "pass" | "fail" | "warn" | "needs_human" | "skipped" | "pending";

const ICONS = {
  pass: { Icon: CheckCircle2, className: "text-pass", label: "Passed" },
  fail: { Icon: XCircle, className: "text-fail", label: "Failed" },
  warn: { Icon: AlertCircle, className: "text-review-icon", label: "Warning" },
  needs_human: { Icon: AlertCircle, className: "text-review-icon", label: "Needs review" },
  skipped: { Icon: MinusCircle, className: "text-ink-3", label: "Skipped" },
  pending: { Icon: CircleDashed, className: "text-line-2", label: "Pending" },
} as const;

/** Check state as form (apps/web StatusIcon): one coloured glyph with an accessible name. */
export function StatusIcon({ state, className }: { state: string; className?: string }) {
  const { Icon, className: tone, label } = ICONS[(state in ICONS ? state : "pending") as RowState];
  return <Icon className={cn("size-5 shrink-0", tone, className)} aria-label={label} role="img" />;
}
