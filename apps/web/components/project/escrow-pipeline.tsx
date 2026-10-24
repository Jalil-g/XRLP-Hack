import { Check, RotateCcw, X } from "lucide-react";
import type { MilestoneView } from "@/lib/types";
import { cn } from "@/lib/utils";

const STAGES = ["Locked in escrow", "Evidence submitted", "AI reviewed", "Inspector signed", "Released"] as const;

const STAGE_INDEX: Record<string, number> = {
  pending: -1,
  escrowed: 0,
  evidence_submitted: 1,
  ai_reviewed: 2,
  inspected: 3,
  released: 4,
};

/** Five-stage escrow lifecycle for one milestone, with failure / refund terminals. */
export function EscrowPipeline({ view }: { view: MilestoneView }) {
  const { status } = view.milestone;

  if (status === "expired" || status === "refunded") {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warn-line bg-warn-bg px-3 py-2.5 text-[13px] text-warn">
        <RotateCcw className="size-4" />
        <span className="font-medium">Escrow expired</span>
        <span className="text-warn/80">→ funds back to the project account → repaid to the vault. Never touched the builder.</span>
      </div>
    );
  }

  // Where did a rejection happen? AI fail rejects at stage 2; inspector reject at stage 3.
  const rejectedAt = status === "rejected" ? (view.verdict?.decision === "fail" ? 2 : 3) : null;
  const current = rejectedAt ?? STAGE_INDEX[status] ?? -1;

  return (
    <ol className="grid grid-cols-5 gap-1.5">
      {STAGES.map((label, i) => {
        const done = rejectedAt === null ? i <= current : i < rejectedAt;
        const failed = rejectedAt === i;
        const active = rejectedAt === null && i === current + 1 && status !== "released" && status !== "pending";
        return (
          <li key={label} className="min-w-0">
            <div
              className={cn(
                "h-1.5 rounded-full",
                failed ? "bg-bad" : done ? (i === 4 ? "bg-ok" : "bg-brand") : active ? "bg-brand/30" : "bg-subtle",
              )}
            />
            <div
              className={cn(
                "mt-2 flex items-center gap-1 text-[12px] leading-tight",
                failed ? "font-medium text-bad" : done ? "font-medium text-ink-2" : active ? "text-ink-2" : "text-faint",
              )}
            >
              {failed ? <X className="size-3.5 shrink-0" /> : done ? <Check className="size-3.5 shrink-0" /> : null}
              <span className="truncate">{failed ? (i === 2 ? "AI rejected" : "Inspector rejected") : label}</span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
