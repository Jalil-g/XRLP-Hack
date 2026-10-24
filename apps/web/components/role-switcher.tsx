"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Building2, ChevronDown, HardHat, Landmark, User } from "lucide-react";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";

const COOKIE = { role: "ks_role", investor: "ks_investor", inspector: "ks_inspector", builder: "ks_builder" } as const;

const ROLES: { role: Role; label: string; icon: typeof User; home: string }[] = [
  { role: "investor", label: "Investor", icon: User, home: "/portfolio" },
  { role: "builder", label: "Builder", icon: Building2, home: "/builder" },
  { role: "inspector", label: "Inspector", icon: HardHat, home: "/inspector" },
  { role: "platform", label: "Platform", icon: Landmark, home: "/demo" },
];

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}

interface Option {
  value: string;
  label: string;
}

export function RoleSwitcher({
  role,
  identities,
}: {
  role: Role;
  /** Selectable identities for the current role (empty for platform). */
  identities: { cookie: "investor" | "inspector" | "builder"; current: string; options: Option[] } | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const switchRole = (r: (typeof ROLES)[number]) => {
    setCookie(COOKIE.role, r.role);
    start(() => {
      router.push(r.home);
      router.refresh();
    });
  };

  return (
    <div className={cn("flex items-center gap-2", pending && "opacity-70")}>
      <div className="flex items-center rounded-lg border border-line bg-subtle p-0.5" role="tablist" aria-label="Demo role">
        {ROLES.map((r) => {
          const Icon = r.icon;
          const active = r.role === role;
          return (
            <button
              key={r.role}
              role="tab"
              aria-selected={active}
              onClick={() => switchRole(r)}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium transition-colors",
                active ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink",
              )}
            >
              <Icon className="size-3.5" />
              <span className="hidden md:inline">{r.label}</span>
            </button>
          );
        })}
      </div>
      {identities && (
        <label className="relative hidden items-center sm:flex">
          <span className="sr-only">Acting as</span>
          <select
            value={identities.current}
            onChange={(e) => {
              setCookie(COOKIE[identities.cookie], e.target.value);
              start(() => router.refresh());
            }}
            className="h-8 appearance-none rounded-lg border border-line bg-surface pr-7 pl-2.5 text-[13px] font-medium text-ink-2 shadow-xs hover:border-line-strong focus:ring-2 focus:ring-brand/20 focus:outline-none"
          >
            {identities.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-faint" />
        </label>
      )}
    </div>
  );
}
