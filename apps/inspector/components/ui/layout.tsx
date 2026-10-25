import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** Page title block (apps/web PageHeader): optional back link above, one heading, an inline tag, one action. Nothing under the title. */
export function PageHeader({ back, title, meta, action, className }: {
  back?: { href: string; label: string };
  title: React.ReactNode;
  meta?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("min-w-0", className)}>
      {back && (
        <Link href={back.href} className="-my-2 inline-flex min-h-11 min-w-11 items-center text-small font-medium text-ink-2 hover:text-ink">
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1 className="text-title">{title}</h1>
          {meta}
        </div>
        {action}
      </div>
    </header>
  );
}

/** A titled region separated by space, not a box. */
export function Section({ title, aside, children, className, id }: {
  title: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={cn("min-w-0", className)}>
      <div className="mb-3 flex min-h-11 flex-wrap items-center justify-between gap-x-4">
        <h2 className="text-[28px] leading-9 font-normal">{title}</h2>
        {aside && <div className="flex items-center gap-2 text-caption text-ink-2">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** Facts beside a title: value in ink, label under it. */
export function Facts({ items, className }: { items: { key?: string; label: React.ReactNode; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("flex flex-wrap gap-x-10 gap-y-3", className)}>
      {items.map((f, i) => (
        <div key={f.key ?? (typeof f.label === "string" ? f.label : i)} className="flex min-w-0 flex-col-reverse">
          <dt className="mt-0.5 text-caption text-ink-2">{f.label}</dt>
          <dd className="text-body font-semibold tabular">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Property list as hairline rows: label in secondary text, value in ink. */
export function Properties({ items, className }: { items: { label: string; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] text-small", className)}>
      {items.map((it) => (
        <React.Fragment key={it.label}>
          <dt className="border-b border-line py-2.5 pr-6 text-ink-2">{it.label}</dt>
          <dd className="min-w-0 border-b border-line py-2.5 text-right break-words text-ink">{it.value}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/** Empty / not-yet state: one line plus an action. */
export function Empty({ title, action, className }: { title: string; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-panel bg-band px-6 py-10 text-center", className)}>
      <p className="text-body font-medium text-ink">{title}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
