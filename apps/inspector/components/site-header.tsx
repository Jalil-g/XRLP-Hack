"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { useIdentity } from "@/components/identity";
import { API_MODE } from "@/lib/api";
import { ProjectorToggle } from "@/components/projector-toggle";
import { BRAND, cn } from "@/lib/utils";

function IdentityPicker() {
  const { status, inspectors, inspector, select } = useIdentity();
  if (status !== "ready" || !inspector) {
    return <span role="status" className="text-caption text-muted">{status === "error" ? "Panel unavailable" : "Loading inspectors…"}</span>;
  }
  return (
    <label className="relative min-w-0 max-w-full">
      <span className="sr-only">Inspector identity</span>
      <select value={inspector.address} onChange={(e) => select(e.target.value)}
        className="h-11 max-w-full appearance-none truncate rounded-control bg-band pr-8 pl-3 text-caption font-medium text-ink sm:max-w-[200px]">
        {inspectors.map((i) => <option key={i.address} value={i.address}>{i.name}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute top-3.5 right-2.5 size-4 text-muted" aria-hidden />
    </label>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const { inspector } = useIdentity();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface">
      <div className="mx-auto flex min-h-16 max-w-[1264px] flex-wrap items-center gap-x-6 gap-y-0 px-4 sm:px-8">
        <Link href="/" className="text-[21px] font-semibold tracking-[-0.035em] text-ink" aria-label="Drawproof inspector home">{BRAND.name}</Link>
        <nav aria-label="Inspector navigation" className="order-3 flex w-full items-center gap-5 overflow-x-auto border-t border-line md:order-none md:w-auto md:border-0">
          {[{ href: "/", label: "Assigned audits" }, { href: "/history", label: "Audit history" }].map(({ href, label }) => {
            const active = href === "/" ? pathname !== "/history" : pathname === href;
            return <Link key={href} href={href} aria-current={active ? "page" : undefined}
              className={cn("flex min-h-11 shrink-0 items-center border-b-2 text-small transition-colors duration-150 md:min-h-16", active ? "border-action text-ink font-medium" : "border-transparent text-muted hover:text-ink")}>{label}</Link>;
          })}
        </nav>
        <div className="ml-auto flex min-h-16 max-w-full items-center gap-2">
          <span className={cn("rounded-tag px-2 py-1 text-caption font-medium", API_MODE === "mock" ? "bg-review-bg text-review" : "text-ink-2")}
            title={API_MODE === "mock" ? "Fixture data. No ledger transactions." : "Connected to core; verify ledger and model modes before signing."}>
            {API_MODE === "mock" ? "Mock data" : "Live API"}
          </span>
          <details className="relative">
            <summary className="flex h-11 max-w-[200px] lg:max-w-[320px] cursor-pointer list-none items-center gap-2 rounded-control px-2 text-caption font-medium hover:bg-band [&::-webkit-details-marker]:hidden">
              Inspector <ChevronDown className="size-3.5 shrink-0 text-muted" aria-hidden />
              <span className="hidden truncate text-muted lg:inline">{inspector?.name}</span>
            </summary>
            <div className="absolute right-0 z-50 mt-2 w-[min(360px,calc(100vw-2rem))] space-y-4 rounded-panel border border-line bg-page p-4 shadow-overlay">
              <p className="text-small font-medium">Demo account</p>
              <IdentityPicker />
              <ProjectorToggle />
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}

export function InspectorMockNote() {
  if (API_MODE !== "mock") return null;
  return <p role="note" className="mb-6 text-caption text-muted">Standalone inspector sample. Amounts and evidence are independent of the investor/builder mock workspace.</p>;
}
