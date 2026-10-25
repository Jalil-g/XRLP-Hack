// One check of the milestone suite: status, name, the verifier's reason, and the evidence it flagged.
import type { CheckResult, Evidence } from "@/lib/contract";
import { fileUrl } from "@/lib/api";
import { AI_CHECKS, checkName } from "@/lib/display";
import { cn } from "@/lib/utils";
import { ROW_GRID, StatusIcon, type RowState } from "./status-icon";

export function CheckRow({ check, state, evidence = [] }: { check: Pick<CheckResult, "check" | "reason" | "evidenceIds">; state: RowState; evidence?: Evidence[] }) {
  const flagged = state === "fail" || state === "warn" ? evidence.filter((e) => check.evidenceIds.includes(e.id) && e.kind === "photo").slice(0, 3) : [];
  const reason = state === "queued" ? "Waiting to run" : state === "running" ? "Running" : check.reason;
  return (
    <li className={cn(ROW_GRID, state === "fail" && "bg-fail-bg/50")}>
      <StatusIcon state={state} className="mt-0.5" />
      <span className="text-small font-medium text-ink">
        {checkName(check.check)}
        {AI_CHECKS.has(check.check) && <span className="ml-1.5 font-normal text-ink-2">· AI</span>}
      </span>
      <span className={cn("text-small", state === "fail" ? "font-medium text-fail" : "text-ink-2")}>{reason}</span>
      <span className="flex gap-1.5 justify-self-end">
        {flagged.map((e) => (
          // eslint-disable-next-line @next/next/no-img-element -- evidence served by core (/api/files) or fixture art
          <img key={e.id} src={fileUrl(e)} alt={`Flagged: ${e.filename}`} title={e.filename} className="size-10 rounded-control object-cover ring-2 ring-fail" />
        ))}
      </span>
    </li>
  );
}
