import Link from "next/link";
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
    <header className="sticky top-0 z-40 border-b border-line bg-page">
      <div className="mx-auto flex min-h-14 max-w-[1184px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2 sm:px-8">
        <Link href="/" className="text-body font-semibold tracking-[-0.01em] text-ink">
          {BRAND.name}
        </Link>
        <NavLinks role={session.role} />
        <div className="ml-auto flex max-w-full flex-wrap items-center gap-3">
          {API_MODE === "mock" ? (
            <span
              className="rounded-tag bg-review-bg px-2 py-0.5 text-caption font-medium text-review"
              title="NEXT_PUBLIC_API_MODE=mock: fixture data, no ledger. Tx hashes are not real."
            >
              Mock data
            </span>
          ) : (
            <span className="text-caption text-ink-2" title="NEXT_PUBLIC_API_MODE=http">
              Live API
            </span>
          )}
          <RoleSwitcher role={session.role} identities={identities} />
          <ProjectorToggle />
        </div>
      </div>
      {session.directoryUnavailable && (
        <p role="alert" className="border-t border-line bg-review-bg px-4 py-2 text-center text-small text-review">
          Account details are unavailable. Names and account actions may be missing; refresh before transacting.
        </p>
      )}
    </header>
  );
}
