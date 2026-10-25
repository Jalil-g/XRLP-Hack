"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ClipboardCheck, History, ArrowUpRight } from "lucide-react";
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
    <>
      <aside className="workspace-sidebar">
        <Link href="/" className="workspace-brand" aria-label="Drawproof inspector home"><span className="brand-symbol" aria-hidden="true"><i /><i /><i /><i /></span>{BRAND.name}<span className="text-accent">.</span></Link>
        <p className="workspace-label">Field workspace</p>
        <nav aria-label="Inspector navigation" className="workspace-nav">
          {[{ href: "/", label: "Assigned audits", Icon: ClipboardCheck }, { href: "/history", label: "Audit history", Icon: History }].map(({ href, label, Icon }) => <Link key={href} href={href} aria-current={(href === "/" ? pathname !== "/history" : pathname === href) ? "page" : undefined}><Icon aria-hidden="true" />{label}</Link>)}
        </nav>
        <div className="sidebar-bottom"><div className="mb-6 border-t border-white/10 pt-5"><ArrowUpRight className="size-5 text-accent" aria-hidden="true" /><p>Your signature.<br />Their next milestone.</p></div><span className="sidebar-network">XRPL Devnet</span></div>
      </aside>
      <header className="workspace-topbar">
        <div className="workspace-context"><strong>Inspector workspace</strong><span>/</span><span>Field verification</span></div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="rounded-tag border border-line bg-page px-2 py-1 text-[11px] text-ink-2">{API_MODE === "mock" ? "Mock data" : "Live API"}</span>
          <details className="relative">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden" aria-label="Inspector account">
              <span className="workspace-avatar">{(inspector?.name ?? "DP").split(" ").map((word) => word[0]).slice(0, 2).join("")}</span><span className="hidden max-w-[160px] truncate text-caption font-medium sm:block">{inspector?.name ?? "Inspector"}</span><ChevronDown className="size-3.5 text-muted" aria-hidden="true" />
            </summary>
            <div className="absolute right-0 z-50 mt-2 w-[min(360px,calc(100vw-2rem))] space-y-4 rounded-panel border border-line bg-page p-4 shadow-overlay"><p className="text-small font-medium">Inspector account</p><IdentityPicker /><ProjectorToggle /></div>
          </details>
        </div>
      </header>
    </>
  );
}
