import * as React from "react";
import { cn } from "@/lib/utils";

/** Page title block: one heading, one optional line, one optional action. */
export function PageHeader({
  title,
  description,
  meta,
  action,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Small inline items next to the title (status tag). */
  meta?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-x-8 gap-y-4", className)}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-title">{title}</h1>
          {meta}
        </div>
        {description && <p className="mt-2 max-w-[62ch] text-body text-ink-2">{description}</p>}
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
      <div className="mb-4 flex items-baseline justify-between gap-4">
        <h2 className="text-heading">{title}</h2>
        {aside && <div className="text-caption text-ink-2">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** Notion-style property list: label column in secondary text, value in ink. */
export function Properties({ items, labelWidth = 160, className }: { items: { label: string; value: React.ReactNode }[]; labelWidth?: number; className?: string }) {
  return (
    <dl className={cn("grid gap-x-4 text-small", className)} style={{ gridTemplateColumns: `${labelWidth}px minmax(0,1fr)` }}>
      {items.map((it) => (
        <React.Fragment key={it.label}>
          <dt className="py-1.5 text-ink-2">{it.label}</dt>
          <dd className="min-w-0 py-1.5 text-ink">{it.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** Empty / not-yet state that says what happens next. */
export function Empty({ title, children, action, className }: { title: string; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-panel bg-band px-6 py-8 text-center", className)}>
      <p className="text-body font-medium text-ink">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-[52ch] text-small text-ink-2">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
