"use client";

// The builder's one number for a project, on the canvas (same treatment as ProjectHero). Staged with the page's release
// motion: while the checks suite resolves, the figures hold; on release "Paid to you" counts up and turns lime.
import { CapitalBar } from "@/components/ui/capital-bar";
import { useStaged, useTween } from "@/components/project/release-stage";
import { cn, formatAmount } from "@/lib/utils";

export type HeroFigure = { label: string; cents?: number; text?: string; paid?: boolean };

export function BuilderHero({
  label,
  cents,
  ofCents,
  figures,
  lead = true,
  action,
}: {
  label: string;
  cents: number;
  /** Funding: the target, shown as "of …" with a raised bar. */
  ofCents?: number;
  figures: HeroFigure[];
  /** The page's first project gets the 64px figure; later projects stay quieter. */
  lead?: boolean;
  action?: React.ReactNode;
}) {
  const staged = useStaged({ label, cents, ofCents, figures });
  const { values } = useTween([staged.cents, ...staged.figures.map((f) => f.cents ?? 0)]);
  const [main = 0, ...rest] = values;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-5">
        <div className="min-w-0">
          <p className="text-small font-medium text-ink-2">{staged.label}</p>
          <p className={cn(lead ? "hero-amount mt-2" : "mt-1 text-[40px] leading-[44px] font-semibold tracking-[-0.03em] tabular-nums")}>
            {formatAmount(main / 100)}
            <span className={cn(!lead && "ml-1 text-body font-medium tracking-normal text-ink-2")}>
              {" "}RLUSD
              {staged.ofCents !== undefined && <span className="ml-2 text-ink-3">of {formatAmount(staged.ofCents / 100)}</span>}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
          {staged.figures.length > 0 && (
            <dl className="flex flex-wrap gap-x-10 gap-y-3">
              {staged.figures.map((f, i) => (
                <div key={f.label} className="flex flex-col-reverse">
                  <dt className="mt-0.5 text-caption text-ink-2">{f.label}</dt>
                  <dd className="text-body font-semibold tabular-nums">
                    {f.cents !== undefined ? (
                      <span className={cn(f.paid !== undefined && "paid-mark")} data-paid={f.paid && (rest[i] ?? 0) > 0 ? "true" : undefined}>
                        {formatAmount((rest[i] ?? 0) / 100)}
                      </span>
                    ) : (
                      f.text
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {action}
        </div>
      </div>
      {staged.ofCents !== undefined && staged.ofCents > 0 && (
        <CapitalBar
          legend={false}
          total={staged.ofCents}
          label="Funding progress"
          segments={[
            { label: "Raised", cents: main, tone: "accent" },
            { label: "Open", cents: Math.max(0, staged.ofCents - main), tone: "track" },
          ]}
        />
      )}
    </div>
  );
}
