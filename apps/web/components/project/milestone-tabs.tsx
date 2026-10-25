// Milestone rail: one stop per escrow, a status-colored track on each, the selected stop in the capital color.
// Links (?m=) so the selection survives refresh and the presenter's back button; `linked={false}` renders a read-only schedule.
import Link from "next/link";
import { Tag, type Tone } from "@/components/ui/tag";
import type { Milestone } from "@/lib/contract";
import { MILESTONE_STATUS } from "@/lib/display";
import { cn, formatAmount } from "@/lib/utils";

const track: Record<Tone, string> = { pass: "bg-pass", fail: "bg-fail", review: "bg-review-icon", info: "bg-info", neutral: "bg-line-2/45" };

export function MilestoneTabs({ milestones, selectedId, linked = true, label = "Milestones" }: { milestones: Milestone[]; selectedId?: string; linked?: boolean; label?: string }) {
  const list = (
    <ol aria-label={linked ? undefined : label} className="flex flex-col gap-2 sm:flex-row sm:overflow-x-auto sm:pb-1">
      {milestones.map((m, i) => {
        const active = m.id === selectedId;
        const st = MILESTONE_STATUS[m.status];
        const body = (
          <>
            <span aria-hidden className={cn("absolute inset-x-0 top-0 h-1", active ? "bg-accent" : track[st.tone])} />
            <span className={cn("text-caption tabular-nums", active ? "text-capital-muted" : "text-ink-2")}>Milestone {i + 1}</span>
            <span className={cn("truncate text-body font-semibold", active ? "text-capital-text" : "text-ink")}>{m.title}</span>
            <span className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <span className={cn("tabular-nums text-small", active ? "text-capital-text" : "text-ink")}>
                {formatAmount(m.amount)} <span className={active ? "text-capital-muted" : "text-ink-2"}>RLUSD</span>
              </span>
              <Tag tone={st.tone}>{st.label}</Tag>
            </span>
          </>
        );
        const cls = cn(
          "relative flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden rounded-panel border px-4 pt-4 pb-3.5 transition-colors duration-150",
          active ? "border-capital bg-capital" : "border-line bg-surface",
          linked && !active && "hover:border-line-2",
        );
        return (
          <li key={m.id} className="flex min-w-0 flex-1 sm:min-w-[200px]">
            {linked ? (
              <Link href={`?m=${encodeURIComponent(m.id)}`} scroll={false} aria-current={active ? "page" : undefined} className={cls}>
                {body}
              </Link>
            ) : (
              <div aria-current={active ? "step" : undefined} className={cls}>
                {body}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
  return linked ? <nav aria-label={label}>{list}</nav> : list;
}
