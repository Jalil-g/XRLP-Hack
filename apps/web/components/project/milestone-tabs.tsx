// Milestone switcher: one tab per escrow. Links (?m=) so the selection survives refresh and the presenter's back button.
import Link from "next/link";
import { Tag } from "@/components/ui/tag";
import type { Milestone } from "@/lib/contract";
import { MILESTONE_STATUS } from "@/lib/display";
import { cn, formatAmount } from "@/lib/utils";

export function MilestoneTabs({ milestones, selectedId }: { milestones: Milestone[]; selectedId?: string }) {
  return (
    <nav aria-label="Milestones" className="grid border-b border-line" style={{ gridTemplateColumns: `repeat(${milestones.length}, minmax(0, 1fr))` }}>
      {milestones.map((m, i) => {
        const active = m.id === selectedId;
        const st = MILESTONE_STATUS[m.status];
        return (
          <Link
            key={m.id}
            href={`?m=${encodeURIComponent(m.id)}`}
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              "-mb-px flex min-w-0 flex-col gap-1.5 border-b-2 px-1 pt-1 pb-3 transition-colors duration-150",
              active ? "border-ink" : "border-transparent hover:border-line-2",
              i > 0 && "pl-5",
            )}
          >
            <span className={cn("truncate text-small font-semibold", active ? "text-ink" : "text-ink-2")}>
              {i + 1}. {m.title}
            </span>
            <span className="flex items-center gap-2">
              <span className="tabular text-caption text-ink-2">{formatAmount(m.amount)}</span>
              <Tag tone={st.tone}>{st.label}</Tag>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
