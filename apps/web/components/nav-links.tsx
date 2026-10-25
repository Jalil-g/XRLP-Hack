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
    <nav className="flex items-center gap-6" aria-label="Main">
      {LINKS.filter((l) => !l.roles || l.roles.includes(role)).map((l) => {
        const active = l.href === "/" ? pathname === "/" || pathname.startsWith("/projects") : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn("text-small transition-colors duration-150", active ? "text-ink" : "text-ink-2 hover:text-ink")}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
