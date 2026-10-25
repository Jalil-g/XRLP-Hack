import Link from "next/link";

export default function NotFound() {
  return <section className="rounded-panel border border-line bg-surface p-6"><h1 className="text-title">Project not found</h1><p className="mt-3 text-body text-ink-2">This project may have been removed or replaced by a demo reset.</p><Link href="/builder" className="mt-4 inline-flex min-h-11 items-center text-small text-link underline underline-offset-4">Return to builder workspace</Link></section>;
}
