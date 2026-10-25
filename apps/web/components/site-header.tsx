import Link from "next/link";
import { ChevronDown, ArrowUpRight } from "lucide-react";
import { API_MODE } from "@/lib/api";
import type { Session } from "@/lib/session";
import { BRAND } from "@/lib/utils";
import { NavLinks } from "./nav-links";
import { RoleSwitcher } from "./role-switcher";
import { ProjectorToggle } from "./projector-toggle";

export function SiteHeader({ session }: { session: Session }) {
  const identities =
    session.role === "investor"
      ? { cookie: "investor" as const, current: session.investor?.address ?? "", options: session.investors.map((p) => ({ value: p.address, label: p.name })) }
      : session.role === "builder"
        ? { cookie: "builder" as const, current: session.builder?.id ?? "", options: session.builders.map((b) => ({ value: b.id, label: b.name })) }
        : null;

  const name = session.role === "investor" ? session.investor?.name : session.role === "builder" ? session.builder?.name : "Platform operator";
  const initials = (name ?? "DP").split(" ").map((word) => word[0]).slice(0, 2).join("");
  return (
    <>
      <aside className="workspace-sidebar">
        <Link href="/" className="workspace-brand"><span className="brand-symbol" aria-hidden="true"><i /><i /><i /><i /></span>{BRAND.name}<span className="text-accent">.</span></Link>
        <p className="workspace-label">Your workspace</p>
        <NavLinks role={session.role} />
        <div className="sidebar-bottom">
          <div className="mb-6 border-t border-white/10 pt-5"><ArrowUpRight className="size-5 text-accent" aria-hidden="true" /><p>Built on proof.<br />Funded with confidence.</p></div>
          <span className="sidebar-network">XRPL Devnet</span>
        </div>
      </aside>
      <header className="workspace-topbar">
        <div className="workspace-context"><strong className="capitalize">{session.role} workspace</strong><span>/</span><span>Construction finance</span></div>
        <div className="flex shrink-0 items-center gap-3">
          <span className="rounded-tag border border-line bg-page px-2 py-1 text-[11px] text-ink-2">{API_MODE === "mock" ? "Mock data" : "Live API"}</span>
          <details className="relative">
            <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden" aria-label="Account and workspace">
              <span className="workspace-avatar">{initials}</span><span className="hidden max-w-[150px] truncate text-caption font-medium sm:block">{name}</span><ChevronDown className="size-3.5 text-ink-2" aria-hidden="true" />
            </summary>
            <div className="absolute right-0 z-50 mt-2 w-[min(360px,calc(100vw-2rem))] space-y-4 rounded-panel border border-line bg-page p-4 shadow-overlay">
              <p className="text-small font-medium">Switch workspace</p>
              <RoleSwitcher role={session.role} identities={identities} />
              <ProjectorToggle />
            </div>
          </details>
        </div>
      </header>
      {session.directoryUnavailable && <p role="alert" className="workspace-topbar bg-review-bg text-small text-review">Account details are unavailable. Refresh before transacting.</p>}
    </>
  );
}
