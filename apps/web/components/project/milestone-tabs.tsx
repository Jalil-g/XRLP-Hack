"use client";

// Milestone rail: one stop per escrow. State is shown with form: a lime disc once paid, an ink ring while in progress,
// red/amber when held, a grey ring before. The selected stop sits on a soft band. Status words appear only when the
// stops disagree. Links (?m=) so the selection survives refresh and the presenter's back button; `linked={false}`
// renders a read-only schedule. Statuses are staged so the rail turns lime with the release, not before it.
import Link from "next/link";
import { Check, Minus, X } from "lucide-react";
import type { Milestone, MilestoneStatus } from "@/lib/contract";
import { MILESTONE_STATUS } from "@/lib/display";
import { cn, formatAmount } from "@/lib/utils";
import { useStaged } from "./release-stage";

const IN_PROGRESS: MilestoneStatus[] = ["evidence_submitted", "audited", "verified", "ai_reviewed", "inspected"];
const TONE_TEXT = { neutral: "text-ink-3", info: "text-ink-2", pass: "text-ink", fail: "text-fail", review: "text-review" } as const;

function Marker({ status }: { status: MilestoneStatus }) {
  const base = "flex size-[22px] shrink-0 items-center justify-center rounded-full [&_svg]:size-3.5 [&_svg]:stroke-[3]";
  if (status === "released") return <span className={cn(base, "bg-accent text-ink ring-1 ring-black/10")}><Check aria-hidden /></span>;
  if (status === "failed" || status === "rejected") return <span className={cn(base, "bg-fail text-white")}><X aria-hidden /></span>;
  if (status === "needs_human") return <span className={cn(base, "bg-review-icon text-white text-[13px] font-bold")}>!</span>;
  if (status === "refunded" || status === "expired") return <span className={cn(base, "bg-band-2 text-ink-2")}><Minus aria-hidden /></span>;
  if (IN_PROGRESS.includes(status)) return <span className={cn(base, "border-2 border-ink")}><span className="size-2 rounded-full bg-ink" /></span>;
  return <span className={cn(base, "border-2 border-line-2")} />;
}

export function MilestoneTabs({ milestones: live, selectedId, linked = true, label = "Milestones" }: { milestones: Milestone[]; selectedId?: string; linked?: boolean; label?: string }) {
  const milestones = useStaged(live, (ms) => ms.map((m) => `${m.id}:${m.status}:${m.amount}`).join("|"));
  const varied = new Set(milestones.map((m) => MILESTONE_STATUS[m.status].label)).size > 1;
  const list = (
    <ol aria-label={linked ? undefined : label} className="-mx-3 flex gap-1 overflow-x-auto pb-1 max-sm:-mx-2 max-sm:gap-0">
      {milestones.map((m, i) => {
        const active = m.id === selectedId;
        const st = MILESTONE_STATUS[m.status];
        const next = milestones[i + 1];
        const body = (
          <>
            <span className="flex items-center gap-2" aria-hidden>
              <Marker status={m.status} />
              {next && <span className={cn("h-0.5 flex-1 rounded-full", m.status === "released" ? "bg-accent" : "bg-band-2")} />}
            </span>
            <span className={cn("mt-2.5 block text-body break-words sm:truncate", active ? "font-semibold text-ink" : "font-medium text-ink-2")}>
              <span className="mr-1.5 tabular-nums text-ink-3">{i + 1}</span>
              {m.title}
            </span>
            <span className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-small tabular-nums">
              <span className={active ? "text-ink" : "text-ink-2"}>{formatAmount(m.amount)}</span>
              {varied ? <span className={cn("font-medium", TONE_TEXT[st.tone])}>{st.label}</span> : <span className="sr-only">{st.label}</span>}
            </span>
          </>
        );
        const cls = cn(
          "block min-w-0 rounded-[12px] px-3 pt-3 pb-2.5 transition-colors duration-150 max-sm:px-2",
          active ? "bg-band" : linked && "hover:bg-band/60",
        );
        return (
          <li key={m.id} className="min-w-0 flex-1 sm:min-w-[150px]">
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
