"use client";

// The project's one number, on the canvas. Funding: raised toward the target. Construction: the principal, with the bar
// and two figures that move on release (paid to builder counts up, in escrow counts down, lime fills).
import { CapitalBar } from "@/components/ui/capital-bar";
import { cn, formatAmount } from "@/lib/utils";
import { useStaged, useTween } from "./release-stage";

type Fact = { label: string; value: string };

export type HeroMoney =
  | { mode: "funding"; raisedCents: number; targetCents: number }
  | { mode: "loan"; principalCents: number; releasedCents: number; escrowCents: number; returnedCents: number; pendingCents: number };

export function ProjectHero({ money, facts: liveFacts, action }: { money: HeroMoney; facts: Fact[]; action?: React.ReactNode }) {
  const staged = useStaged(money);
  const facts = useStaged(liveFacts);
  const target =
    staged.mode === "funding"
      ? [staged.raisedCents, staged.targetCents, 0, 0, 0]
      : [staged.releasedCents, staged.escrowCents, staged.returnedCents, staged.pendingCents, staged.principalCents];
  const { values, moving } = useTween(target);
  const [a = 0, b = 0, c = 0, d = 0, e = 0] = values;

  return (
    <section aria-label="Project capital" className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-5">
        <div className="min-w-0">
          <p className="text-small font-medium text-ink-2">{staged.mode === "funding" ? "Raised" : "Loan principal"}</p>
          <p className="hero-amount mt-2">
            {formatAmount((staged.mode === "funding" ? a : e) / 100)}
            <span>
              {" "}RLUSD
              {staged.mode === "funding" && <span className="ml-2 text-ink-3">of {formatAmount(b / 100)}</span>}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
          <dl className="flex flex-wrap gap-x-10 gap-y-3">
            {facts.map((f) => (
              <div key={f.label} className="flex flex-col-reverse">
                <dt className="mt-0.5 text-caption text-ink-2">{f.label}</dt>
                <dd className="text-body font-semibold tabular-nums">{f.value}</dd>
              </div>
            ))}
          </dl>
          {action}
        </div>
      </div>

      {staged.mode === "funding" ? (
        <div>
          <CapitalBar
            legend={false}
            total={b}
            label="Funding progress"
            segments={[{ label: "Raised", cents: a, tone: "accent" }, { label: "Open", cents: Math.max(0, b - a), tone: "track" }]}
          />
          <p className="mt-2.5 flex justify-between text-small text-ink-2 tabular-nums">
            <span>{b ? Math.floor((a / b) * 100) : 0}%</span>
            <span>
              <strong className="font-semibold text-ink">{formatAmount(Math.max(0, b - a) / 100)}</strong> open
            </span>
          </p>
        </div>
      ) : (
        <div>
          <CapitalBar
            legend={false}
            total={e}
            className={cn(moving && "capital-moving")}
            label="Principal by location"
            segments={[
              { label: "Paid to builder", cents: a, tone: "accent", keep: true },
              { label: "In escrow", cents: b, tone: "muted" },
              { label: "Returned", cents: c, tone: "track" },
              { label: "Not in escrow", cents: d, tone: "track" },
            ]}
          />
          <dl className="mt-4 flex flex-wrap gap-x-12 gap-y-3">
            <Figure label="Paid to builder" cents={a} tone="accent" paid={a > 0} />
            <Figure label="In escrow" cents={b} tone="ink" />
            {c > 0 && <Figure label="Returned" cents={c} tone="track" />}
            {d > 0 && <Figure label="Not in escrow" cents={d} tone="track" />}
          </dl>
        </div>
      )}
    </section>
  );
}

function Figure({ label, cents, tone, paid }: { label: string; cents: number; tone: "accent" | "ink" | "track"; paid?: boolean }) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="mt-0.5 flex items-center gap-2 text-caption text-ink-2">
        <span aria-hidden className={cn("size-2.5 rounded-full", tone === "accent" ? "bg-accent ring-1 ring-black/15" : tone === "ink" ? "bg-ink" : "bg-band-2 ring-1 ring-line-2")} />
        {label}
      </dt>
      <dd className="text-heading font-semibold tabular-nums">
        <span className={cn(tone === "accent" && "paid-mark")} data-paid={paid ? "true" : undefined}>
          {formatAmount(cents / 100)}
        </span>
      </dd>
    </div>
  );
}
