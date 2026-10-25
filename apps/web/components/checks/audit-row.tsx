// The licensed inspector's signed site audit: a required check. Who signed it shows here; the signer address and
// attestation tx live in the suite's Proof disclosure.
import type { CheckResult, InspectorAudit } from "@/lib/contract";
import { cn } from "@/lib/utils";
import { ROW_GRID, StatusIcon, type RowState } from "./status-icon";

export function AuditRow({
  audit,
  result,
  state,
  inspectorName,
}: {
  /** Latest audit for the milestone, if one was filed. */
  audit?: InspectorAudit;
  /** The suite's `inspector_audit_present` result, once the suite has run. */
  result?: CheckResult;
  state: RowState;
  inspectorName?: string;
}) {
  const lines = audit?.checklist.length ?? 0;
  const partial = audit?.checklist.filter((l) => l.status === "partial").length ?? 0;
  const missing = audit?.checklist.filter((l) => l.status === "not_done").length ?? 0;
  const gaps = [partial && `${partial} partial`, missing && `${missing} not done`].filter(Boolean).join(", ");
  const detail =
    state === "running"
      ? ""
      : state === "fail" && result
        ? result.reason
        : audit
          ? `${inspectorName ?? "Assigned inspector"}${gaps ? `, ${gaps}` : `, ${lines} of ${lines} lines`}`
          : "Not filed";

  return (
    <li className={cn(ROW_GRID, state === "fail" && "bg-fail-bg/60")}>
      <StatusIcon state={state} />
      <span className={cn("text-body", state === "queued" && !audit ? "text-ink-2" : "font-medium text-ink")}>Inspector audit</span>
      <span className={cn("text-small", state === "fail" ? "font-medium text-fail" : gaps ? "font-medium text-review" : "truncate text-ink-3")}>{detail}</span>
      <span />
    </li>
  );
}
