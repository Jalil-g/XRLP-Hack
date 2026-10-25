"use client";

import Link from "next/link";
import { Button, buttonClass } from "@/components/ui/button";

export function WorkspaceLoading({ title }: { title: string }) {
  return (
    <section aria-busy="true" aria-label={title} className="space-y-8">
      <p role="status" className="sr-only">
        {title}
      </p>
      <div aria-hidden="true" className="h-10 w-2/5 animate-pulse rounded-control bg-band" />
      <div aria-hidden="true" className="space-y-3">
        <div className="h-4 w-32 rounded-control bg-band" />
        <div className="h-16 w-1/2 animate-pulse rounded-control bg-band" />
      </div>
      <div aria-hidden="true" className="grid grid-cols-3 gap-4">
        <div className="h-16 rounded-[12px] bg-band" />
        <div className="h-16 rounded-[12px] bg-band" />
        <div className="h-16 rounded-[12px] bg-band" />
      </div>
      <div aria-hidden="true" className="h-48 rounded-panel border border-line" />
    </section>
  );
}

export function WorkspaceError({ title, retry }: { title: string; retry: () => void }) {
  return (
    <section role="alert" className="max-w-[640px] space-y-5 py-6">
      <h1 className="text-heading">{title}</h1>
      <p className="text-body text-ink-2">The records did not load. Nothing was changed.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" onClick={retry}>
          Try again
        </Button>
        <Link href="/builder" className={buttonClass("quiet", "lg")}>
          Builder workspace
        </Link>
      </div>
    </section>
  );
}
