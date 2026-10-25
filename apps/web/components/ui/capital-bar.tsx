// Proportional money-location bar for the dark capital summary. Real amounts only; every segment is labeled in the legend.
import { cn, formatAmount } from "@/lib/utils";

export type CapitalSegment = { label: string; cents: number; tone: "accent" | "muted" | "track" };

const fill = { accent: "bg-accent", muted: "bg-capital-muted/55", track: "bg-white/12" } as const;

export function CapitalBar({ segments, label, className }: { segments: CapitalSegment[]; label: string; className?: string }) {
  const shown = segments.filter((s) => s.cents > 0);
  const total = shown.reduce((a, s) => a + s.cents, 0);
  if (!total) return null;
  return (
    <figure className={cn("min-w-0", className)}>
      <div role="img" aria-label={`${label}: ${shown.map((s) => `${s.label} ${formatAmount(s.cents / 100)} RLUSD`).join(", ")}`} className="flex h-2.5 gap-1 overflow-hidden rounded-full">
        {shown.map((s) => (
          <span key={s.label} className={cn("h-full rounded-full", fill[s.tone])} style={{ flexGrow: s.cents, flexBasis: 0, minWidth: 6 }} />
        ))}
      </div>
      <figcaption className="mt-3 flex flex-wrap gap-x-6 gap-y-1.5 text-small text-capital-muted">
        {shown.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-2">
            <span aria-hidden className={cn("size-2 rounded-full", fill[s.tone], s.tone === "track" && "ring-1 ring-capital-muted/50")} />
            {s.label}
            <strong className="font-medium text-capital-text tabular-nums">{formatAmount(s.cents / 100)}</strong>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
