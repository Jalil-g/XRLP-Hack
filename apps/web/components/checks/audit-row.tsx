// The licensed inspector's signed site audit: a required check, shown with who signed it and the attestation tx.
import { Address, TxLink } from "@/components/chain";
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
  const done = audit?.checklist.filter((l) => l.status === "done").length ?? 0;
  const partial = audit?.checklist.filter((l) => l.status === "partial").length ?? 0;
  const missing = audit?.checklist.filter((l) => l.status === "not_done").length ?? 0;
  const detail =
    state === "running"
      ? "Running"
      : state === "fail" && result
        ? result.reason
        : audit
          ? [
              `Signed by ${inspectorName ?? "the assigned inspector"}`,
              `${done} of ${audit.checklist.length} lines done`,
              partial ? `${partial} partial` : "",
              missing ? `${missing} not done` : "",
            ]
              .filter(Boolean)
              .join(" · ")
          : "Waiting for the assigned inspector's signed audit";

  return (
    <li className={cn(ROW_GRID, state === "fail" && "bg-fail-bg/50")}>
      <StatusIcon state={state} className="mt-0.5" />
      <span className="text-small font-medium text-ink">Inspector audit signed</span>
      <span className={cn("text-small", state === "fail" ? "font-medium text-fail" : "text-ink-2")}>
        {detail}
        {audit && state !== "fail" && state !== "running" && (
          <span className="block text-caption text-ink-2">
            {audit.notes && <>“{audit.notes}” · </>}signer <Address address={audit.inspector} />
          </span>
        )}
      </span>
      <span className="justify-self-end">{audit?.txHash && <TxLink hash={audit.txHash} />}</span>
    </li>
  );
}
