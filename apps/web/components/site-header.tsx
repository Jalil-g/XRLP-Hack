import Link from "next/link";
import { DATA_MODE } from "@/lib/api";
import type { Session } from "@/lib/session";
import { BRAND } from "@/lib/utils";
import { NavLinks } from "./nav-links";
import { RoleSwitcher } from "./role-switcher";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label={`${BRAND.name} home`}>
      <span className="flex size-7 items-center justify-center rounded-lg bg-ink text-white shadow-sm">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 20h16" />
          <path d="M6 20V11l6-5 6 5v9" />
          <path d="M10 20v-5h4v5" />
        </svg>
      </span>
      <span className="text-[15px] font-semibold tracking-tight">{BRAND.name}</span>
    </Link>
  );
}

export function SiteHeader({ session }: { session: Session }) {
  const { role, parties } = session;
  const identities =
    role === "investor"
      ? { cookie: "investor" as const, current: session.investor.address, options: parties.investors.map((p) => ({ value: p.address, label: p.name })) }
      : role === "inspector"
        ? { cookie: "inspector" as const, current: session.inspector.address, options: parties.inspectors.map((p) => ({ value: p.address, label: p.name })) }
        : role === "builder"
          ? { cookie: "builder" as const, current: session.builder.id, options: parties.builders.map((b) => ({ value: b.id, label: b.name })) }
          : null;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur supports-[backdrop-filter]:bg-surface/75">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
        <Logo />
        <NavLinks role={role} />
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs font-medium text-muted lg:inline-flex">
            <span className="relative flex size-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            {BRAND.network}
            {DATA_MODE === "mock" && <span className="text-faint">· mock data</span>}
          </span>
          <RoleSwitcher role={role} identities={identities} />
        </div>
      </div>
    </header>
  );
}
