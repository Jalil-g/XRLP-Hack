"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { useIdentity } from "@/components/identity";
import { API_MODE } from "@/lib/api";
import { ProjectorToggle } from "@/components/projector-toggle";
import { BRAND, cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Queue" },
  { href: "/history", label: "History" },
];

function IdentityPicker() {
  const { status, inspectors, inspector, select } = useIdentity();
  if (status !== "ready" || !inspector) {
    return <span role="status" className="text-caption text-ink-2">{status === "error" ? "Panel unavailable" : "Loading inspectors…"}</span>;
  }
  return (
    <label className="relative block min-w-0 max-w-full">
      <span className="sr-only">Inspector identity</span>
      <select value={inspector.address} onChange={(e) => select(e.target.value)}
        className="h-11 w-full appearance-none truncate rounded-control bg-band pr-8 pl-3 text-small font-medium text-ink">
        {inspectors.map((i) => <option key={i.address} value={i.address}>{i.name}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute top-3.5 right-2.5 size-4 text-ink-2" aria-hidden />
    </label>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const { inspector } = useIdentity();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur-md">
      <div className="mx-auto flex min-h-14 max-w-[1264px] flex-wrap items-center gap-x-8 gap-y-1 px-4 py-1.5 sm:px-8">
        <Link href="/" className="inline-flex min-h-11 items-center text-[19px] font-bold tracking-[-0.04em] text-ink" aria-label="Drawproof inspector home">{BRAND.name}</Link>
        <nav aria-label="Inspector navigation" className="order-3 flex w-full items-center gap-6 overflow-x-auto border-t border-line sm:order-none sm:w-auto sm:border-0">
          {LINKS.map(({ href, label }) => {
            const active = href === "/" ? pathname !== "/history" : pathname === href;
            return (
              <Link key={href} href={href} aria-current={active ? "page" : undefined}
                className={cn("flex min-h-11 min-w-11 shrink-0 items-center text-small font-medium transition-colors duration-150", active ? "text-ink" : "text-ink-3 hover:text-ink")}>
                {label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex max-w-full items-center gap-2">
          {API_MODE === "mock" ? (
            <span className="rounded-tag border border-line px-1.5 text-[11px] leading-5 font-medium text-ink-3" title="Fixture data. No ledger transactions; hashes are not real.">
              Mock
            </span>
          ) : (
            <span className="text-[11px] leading-5 font-medium text-ink-3" title="Connected to core; verify ledger and model modes before signing.">
              Devnet
            </span>
          )}
          <details className="relative">
            <summary className="flex h-11 max-w-[200px] cursor-pointer list-none items-center gap-2 rounded-control px-2 text-caption font-medium hover:bg-band lg:max-w-[320px] [&::-webkit-details-marker]:hidden">
              Inspector <ChevronDown className="size-3.5 shrink-0 text-ink-2" aria-hidden />
              <span className="hidden truncate text-ink-2 lg:inline">{inspector?.name}</span>
            </summary>
            <div className="absolute right-0 z-50 mt-2 w-[min(360px,calc(100vw-2rem))] space-y-4 rounded-panel border border-line bg-surface p-4 shadow-overlay">
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
