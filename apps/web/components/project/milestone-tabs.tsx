// Milestone rail: one stop per escrow; the selected stop takes the capital color with a chartreuse track.
// Links (?m=) so the selection survives refresh and the presenter's back button; `linked={false}` renders a read-only schedule.
import Link from "next/link";
import { Tag } from "@/components/ui/tag";
import type { Milestone } from "@/lib/contract";
import { MILESTONE_STATUS } from "@/lib/display";
import { cn, formatAmount } from "@/lib/utils";

export function MilestoneTabs({ milestones, selectedId, linked = true, label = "Milestones" }: { milestones: Milestone[]; selectedId?: string; linked?: boolean; label?: string }) {
  const list = (
    <ol aria-label={linked ? undefined : label} className="flex flex-col gap-2 sm:flex-row sm:overflow-x-auto sm:pb-1">
      {milestones.map((m, i) => {
        const active = m.id === selectedId;
        const st = MILESTONE_STATUS[m.status];
        const body = (
          <>
            {active && <span aria-hidden className="absolute inset-x-0 top-0 h-1 bg-accent" />}
            <span className={cn("truncate text-body font-semibold", active ? "text-capital-text" : "text-ink")}>
              <span className={cn("mr-1.5 font-normal tabular-nums", active ? "text-capital-muted" : "text-ink-2")}>{i + 1}</span>
              {m.title}
            </span>
            <span className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <span className={cn("tabular-nums text-small", active ? "text-capital-text" : "text-ink")}>
                {formatAmount(m.amount)} <span className={active ? "text-capital-muted" : "text-ink-2"}>RLUSD</span>
              </span>
              <Tag tone={st.tone}>{st.label}</Tag>
            </span>
          </>
        );
        const cls = cn(
          "relative flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden rounded-panel border px-4 pt-3.5 pb-3 transition-colors duration-150",
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
