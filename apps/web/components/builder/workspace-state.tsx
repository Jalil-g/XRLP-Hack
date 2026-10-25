"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";

export function WorkspaceLoading({ title }: { title: string }) {
  return <section aria-busy="true" aria-label={title} className="space-y-8">
    <h1 className="text-title">{title}</h1>
    <div className="h-40 rounded-[20px] bg-capital p-6"><p role="status" className="text-small text-capital-muted">Loading the latest project records…</p></div>
    <div aria-hidden="true" className="space-y-4 rounded-panel border border-line bg-surface p-6"><div className="h-6 w-2/5 rounded-control bg-band"/><div className="h-20 rounded-control bg-band"/><div className="h-12 rounded-control bg-band"/></div>
  </section>;
}

export function WorkspaceError({ title, retry }: { title: string; retry: () => void }) {
  return <section role="alert" className="mx-auto max-w-[760px] rounded-panel border border-line bg-surface p-6 sm:p-8">
    <h1 className="text-title">{title}</h1>
    <p className="mt-3 max-w-[65ch] text-body text-ink-2">The latest records could not be loaded. This is not an empty project or a confirmed transaction result. Check the service connection and try loading again.</p>
    <div className="mt-6 flex flex-wrap items-center gap-4"><Button onClick={retry}>Try loading again</Button><Link href="/builder" className="inline-flex min-h-11 items-center text-small text-link underline underline-offset-4">Builder workspace</Link></div>
  </section>;
}
