import Link from "next/link";
import { ChevronDown } from "lucide-react";
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

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur-md">
      <div className="mx-auto flex min-h-14 max-w-[1264px] flex-wrap items-center gap-x-8 gap-y-1 px-4 py-1.5 sm:px-8">
        <Link href="/" className="text-[19px] font-bold tracking-[-0.04em] text-ink">
          {BRAND.name}
        </Link>
        <NavLinks role={session.role} />
        <div className="ml-auto flex max-w-full flex-wrap items-center gap-2">
          {API_MODE === "mock" ? (
            <span className="rounded-tag border border-line px-1.5 text-[11px] leading-5 font-medium text-ink-3" title="NEXT_PUBLIC_API_MODE=mock: fixture data, no ledger. Tx hashes are not real.">
              Mock
            </span>
          ) : (
            <span className="text-[11px] leading-5 font-medium text-ink-3" title="NEXT_PUBLIC_API_MODE=http">
              Devnet
            </span>
          )}
          <details className="relative">
            <summary className="flex h-11 max-w-[200px] lg:max-w-[320px] cursor-pointer list-none items-center gap-2 rounded-control px-2 text-caption font-medium hover:bg-band [&::-webkit-details-marker]:hidden">
              <span className="capitalize">{session.role}</span><ChevronDown className="size-3.5 shrink-0 text-ink-2" aria-hidden />
              <span className="hidden truncate text-ink-2 lg:inline">{session.role === "investor" ? session.investor?.name : session.role === "builder" ? session.builder?.name : "Operator"}</span>
            </summary>
            <div className="absolute right-0 z-50 mt-2 w-[min(360px,calc(100vw-2rem))] space-y-4 rounded-panel border border-line bg-surface p-4 shadow-overlay">
              <p className="text-small font-medium">Demo account</p>
              <RoleSwitcher role={session.role} identities={identities} />
              <ProjectorToggle />
            </div>
          </details>
        </div>
      </div>
      {session.directoryUnavailable && (
        <p role="alert" className="border-t border-line bg-review-bg px-4 py-2 text-center text-small text-review">
          Account details unavailable. Refresh before transacting.
        </p>
      )}
    </header>
  );
}
