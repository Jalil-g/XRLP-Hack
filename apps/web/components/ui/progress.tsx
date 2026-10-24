import { cn } from "@/lib/utils";

export function Progress({ value, className, barClassName }: { value: number; className?: string; barClassName?: string }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={Math.round(v)}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-subtle", className)}
    >
      <div className={cn("h-full rounded-full bg-brand transition-[width] duration-700 ease-out", barClassName)} style={{ width: `${v}%` }} />
    </div>
  );
}

/** Stacked horizontal bar: segments as fractions of total. */
export function StackedBar({
  segments,
  total,
  className,
}: {
  segments: { value: number; className: string; label: string }[];
  total: number;
  className?: string;
}) {
  return (
    <div className={cn("flex h-2.5 w-full overflow-hidden rounded-full bg-subtle", className)}>
      {segments.map((s) =>
        s.value > 0 ? (
          <div
            key={s.label}
            title={s.label}
            className={cn("h-full transition-[width] duration-700 ease-out first:rounded-l-full last:rounded-r-full", s.className)}
            style={{ width: `${(s.value / Math.max(total, 1)) * 100}%` }}
          />
        ) : null,
      )}
    </div>
  );
}
