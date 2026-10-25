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
    <nav className="order-3 flex w-full items-center gap-7 overflow-x-auto border-t border-line md:order-none md:w-auto md:border-0" aria-label="Main">
      {LINKS.filter((l) => !l.roles || l.roles.includes(role)).map((l) => {
        const active = l.href === "/" ? pathname === "/" || pathname.startsWith("/projects") : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn("relative flex min-h-11 shrink-0 items-center text-body font-normal transition-colors duration-150 md:min-h-[72px]", active ? "text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-clay" : "text-ink-2 hover:text-ink")}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
