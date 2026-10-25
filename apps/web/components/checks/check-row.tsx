// One check of the milestone suite: status, name, the verifier's reason, and the evidence it flagged.
// Passing reasons stay quiet on one line; failures and warnings read in full.
import type { CheckResult, Evidence } from "@/lib/contract";
import { fileUrl } from "@/lib/api";
import { AI_CHECKS, checkName } from "@/lib/display";
import { cn } from "@/lib/utils";
import { ROW_GRID, StatusIcon, type RowState } from "./status-icon";

export function CheckRow({ check, state, evidence = [] }: { check: Pick<CheckResult, "check" | "reason" | "evidenceIds">; state: RowState; evidence?: Evidence[] }) {
  const flagged = state === "fail" || state === "warn" ? evidence.filter((e) => check.evidenceIds.includes(e.id) && e.kind === "photo").slice(0, 3) : [];
  const loud = state === "fail" || state === "warn";
  const reason = state === "queued" || state === "running" ? "" : check.reason;
  return (
    <li className={cn(ROW_GRID, state === "fail" && "bg-fail-bg/60", state === "warn" && "bg-review-bg/60")}>
      <StatusIcon state={state} />
      <span className={cn("flex items-center gap-2 text-body", state === "queued" ? "text-ink-2" : "font-medium text-ink")}>
        {checkName(check.check)}
        {AI_CHECKS.has(check.check) && <span className="rounded-[5px] border border-line px-1 text-[11px] leading-4 font-semibold tracking-wide text-ink-3">AI</span>}
      </span>
      <span title={loud ? undefined : reason} className={cn("text-small", loud ? (state === "fail" ? "font-medium text-fail" : "font-medium text-review") : "text-ink-3 lg:truncate")}>
        {reason}
      </span>
      <span className="flex gap-1.5 justify-self-end">
        {flagged.map((e) => (
          // eslint-disable-next-line @next/next/no-img-element -- evidence served by core (/api/files) or fixture art
          <img key={e.id} src={fileUrl(e)} alt={`Flagged: ${e.filename}`} title={e.filename} className={cn("size-10 rounded-control object-cover ring-2", state === "fail" ? "ring-fail" : "ring-review-icon")} />
        ))}
      </span>
    </li>
  );
}
