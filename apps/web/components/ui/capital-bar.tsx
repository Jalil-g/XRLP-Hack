import { cn, formatAmount } from "@/lib/utils";

export type CapitalSegment = { label: string; cents: number; tone: "accent" | "muted" | "track"; /** List in the legend even at zero (e.g. "Released 0"). */ keep?: boolean };

const fill = { accent: "bg-pass", muted: "bg-ink", track: "bg-band-2" } as const;
const dot = { accent: "bg-pass", muted: "bg-ink", track: "bg-band-2 ring-1 ring-line-2" } as const;

export function CapitalBar({
  segments,
  label,
  className,
  legend = true,
  /** Fixed total so animated segments keep their scale (defaults to the segment sum). */
  total: fixedTotal,
}: {
  segments: CapitalSegment[];
  label: string;
  className?: string;
  legend?: boolean;
  total?: number;
}) {
  const shown = segments.filter((s) => s.cents > 0);
  const listed = segments.filter((s) => s.cents > 0 || s.keep);
  const total = fixedTotal ?? shown.reduce((a, s) => a + s.cents, 0);
  if (!total) return null;
  return (
    <figure className={cn("min-w-0", className)}>
      <div
        role="img"
        aria-label={`${label}: ${listed.map((s) => `${s.label} ${formatAmount(s.cents / 100)} RLUSD`).join(", ")}`}
        className="flex h-3 gap-[3px] overflow-hidden rounded-full bg-band-2"
      >
        {shown.map((s) => (
          <span key={s.label} className={cn("h-full rounded-full", fill[s.tone])} style={{ width: `${(s.cents / total) * 100}%`, minWidth: 6 }} />
        ))}
      </div>
      {legend && (
        <figcaption className="mt-3 flex flex-wrap gap-x-7 gap-y-1.5 text-small text-ink-2">
          {listed.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-2">
              <span aria-hidden className={cn("size-2.5 rounded-full", dot[s.tone])} />
              {s.label}
              <strong className="font-normal text-ink tabular-nums">{formatAmount(s.cents / 100)}</strong>
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}
