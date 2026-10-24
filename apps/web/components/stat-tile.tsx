import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  unit,
  hint,
  icon: Icon,
  className,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-line bg-surface px-5 py-4 shadow-card", className)}>
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium text-muted">{label}</span>
        {Icon && <Icon className="size-4 text-faint" />}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="tabular text-[26px] leading-none font-semibold tracking-tight">{value}</span>
        {unit && <span className="text-sm font-medium text-muted">{unit}</span>}
      </div>
      {hint && <div className="mt-2 text-xs text-faint">{hint}</div>}
    </div>
  );
}
