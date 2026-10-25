import * as React from "react";
import { cn } from "@/lib/utils";

/** Page title block: one heading and one optional action. Nothing goes under the title. */
export function PageHeader({
  title,
  meta,
  action,
  className,
}: {
  title: React.ReactNode;
  /** Small inline items next to the title (status tag). */
  meta?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-center justify-between gap-x-8 gap-y-4", className)}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-title">{title}</h1>
          {meta}
        </div>
      </div>
      {action}
    </header>
  );
}

/** A titled region separated by space, not a box. */
export function Section({
  title,
  aside,
  children,
  className,
}: {
  title: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("min-w-0", className)}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-4">
        <h2 className="t-card">{title}</h2>
        {aside && <div className="text-caption text-ink-2">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** Property list as hairline rows: label in secondary text, value in ink. */
export function Properties({ items, labelWidth = 160, className }: { items: { label: string; value: React.ReactNode }[]; labelWidth?: number; className?: string }) {
  return (
    <dl className={cn("grid text-small", className)} style={{ gridTemplateColumns: `minmax(0, min(40%, ${labelWidth}px)) minmax(0,1fr)` }}>
      {items.map((it) => (
        <React.Fragment key={it.label}>
          <dt className="border-b border-line py-2.5 pr-4 text-ink-2">{it.label}</dt>
          <dd className="min-w-0 border-b border-line py-2.5 text-ink">{it.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** Empty / not-yet state: one line plus an action. */
export function Empty({ title, children, action, className }: { title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("panel px-6 py-10 text-center", className)}>
      <p className="text-body font-medium text-ink">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-[52ch] text-small text-ink-2">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
