"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTransition } from "react";
import { ChevronDown } from "lucide-react";
import type { Role } from "@/lib/session";
import { cn } from "@/lib/utils";

const COOKIE = { role: "dp_role", investor: "dp_investor", builder: "dp_builder" } as const;

const ROLES: { role: Role; label: string; home: string }[] = [
  { role: "investor", label: "Investor", home: "/portfolio" },
  { role: "builder", label: "Builder", home: "/builder" },
  { role: "platform", label: "Platform", home: "/demo" },
];

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}

/** Demo identity: a segmented control for the role, a select for who within it. */
export function RoleSwitcher({
  role,
  identities,
}: {
  role: Role;
  identities: { cookie: "investor" | "builder"; current: string; options: { value: string; label: string }[] } | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();

  return (
    <div className={cn("flex max-w-full flex-wrap items-center gap-2 transition-opacity", pending && "opacity-60")}>
      <div className="flex rounded-full bg-band p-0.5" role="group" aria-label="Acting as">
        {ROLES.map((r) => (
          <button
            key={r.role}
            disabled={pending}
            aria-pressed={r.role === role}
            onClick={() => {
              setCookie(COOKIE.role, r.role);
              start(() => {
                router.push(pathname.startsWith("/projects/") ? `${pathname}${window.location.search}` : r.home);
                router.refresh();
              });
            }}
            className={cn(
              "min-h-10 rounded-full px-3 text-caption font-medium transition-colors duration-150",
              r.role === role ? "bg-page text-ink" : "text-ink-2 hover:text-ink",
            )}
          >
            {r.label}
          </button>
        ))}
      </div>
      {identities && identities.options.length > 0 && (
        <label className="relative flex items-center">
          <span className="sr-only">Identity</span>
          <select
            value={identities.current}
            onChange={(e) => {
              setCookie(COOKIE[identities.cookie], e.target.value);
              start(() => router.refresh());
            }}
            className="h-11 max-w-[180px] appearance-none truncate rounded-control bg-transparent pr-6 pl-2 text-caption font-medium text-ink hover:bg-band"
          >
            {identities.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-1.5 size-3.5 text-ink-3" aria-hidden />
        </label>
      )}
    </div>
  );
}
