"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/session";
import { cn } from "@/lib/utils";

const LINKS: { href: string; label: string; roles?: Role[] }[] = [
  { href: "/", label: "Projects" },
  { href: "/portfolio", label: "Portfolio", roles: ["investor"] },
  { href: "/builder", label: "Builder", roles: ["builder"] },
  { href: "/demo", label: "Demo" },
];

export function NavLinks({ role }: { role: Role }) {
  const pathname = usePathname();
  return (
    <nav className="order-3 flex w-full items-center gap-6 overflow-x-auto border-t border-line sm:order-none sm:w-auto sm:border-0" aria-label="Main">
      {LINKS.filter((l) => !l.roles || l.roles.includes(role)).map((l) => {
        const active = l.href === "/" ? pathname === "/" || pathname.startsWith("/projects") : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn("flex min-h-11 shrink-0 items-center text-small font-medium transition-colors duration-150", active ? "text-ink" : "text-ink-3 hover:text-ink")}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
