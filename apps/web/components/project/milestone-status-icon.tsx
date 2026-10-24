import { CheckCircle2, Clock, FileUp, HardHat, Lock, RotateCcw, ScanSearch, XCircle } from "lucide-react";
import type { Milestone } from "@xrlp/shared";
import { cn } from "@/lib/utils";

const ICONS = {
  pending: Clock,
  escrowed: Lock,
  evidence_submitted: FileUp,
  ai_reviewed: ScanSearch,
  inspected: HardHat,
  released: CheckCircle2,
  rejected: XCircle,
  expired: RotateCcw,
  refunded: RotateCcw,
} as const;

const TINT: Record<Milestone["status"], string> = {
  pending: "bg-subtle text-faint ring-line",
  escrowed: "bg-lock-bg text-lock ring-lock-line",
  evidence_submitted: "bg-info-bg text-info ring-info-line",
  ai_reviewed: "bg-info-bg text-info ring-info-line",
  inspected: "bg-info-bg text-info ring-info-line",
  released: "bg-ok-bg text-ok ring-ok-line",
  rejected: "bg-bad-bg text-bad ring-bad-line",
  expired: "bg-warn-bg text-warn ring-warn-line",
  refunded: "bg-warn-bg text-warn ring-warn-line",
};

export function MilestoneStatusIcon({ status, className }: { status: Milestone["status"]; className?: string }) {
  const Icon = ICONS[status];
  return (
    <span className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset", TINT[status], className)}>
      <Icon className="size-4" />
    </span>
  );
}
