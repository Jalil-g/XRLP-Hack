"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { Role } from "@/lib/types";
import { cn } from "@/lib/utils";

const LINKS: { href: string; label: string; roles?: Role[] }[] = [
  { href: "/", label: "Marketplace" },
  { href: "/portfolio", label: "Portfolio", roles: ["investor"] },
  { href: "/builder", label: "Builder", roles: ["builder"] },
  { href: "/inspector", label: "Inspections", roles: ["inspector"] },
  { href: "/demo", label: "Demo control" },
];

export function NavLinks({ role }: { role: Role }) {
  const pathname = usePathname();
  return (
    <nav className="hidden items-center gap-1 md:flex">
      {LINKS.filter((l) => !l.roles || l.roles.includes(role)).map((l) => {
        const active = l.href === "/" ? pathname === "/" || pathname.startsWith("/projects") : pathname.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors",
              active ? "bg-subtle text-ink" : "text-muted hover:text-ink",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
