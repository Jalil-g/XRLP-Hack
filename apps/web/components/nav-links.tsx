"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Wallet, Hammer, SlidersHorizontal } from "lucide-react";
import type { Role } from "@/lib/session";

const LINKS = [
  { href: "/", label: "Projects", Icon: Building2, roles: ["investor", "builder", "platform"] },
  { href: "/portfolio", label: "My portfolio", Icon: Wallet, roles: ["investor"] },
  { href: "/builder", label: "My builds", Icon: Hammer, roles: ["builder"] },
  { href: "/demo", label: "Control room", Icon: SlidersHorizontal, roles: ["investor", "builder", "platform"] },
];
export function NavLinks({ role }: { role: Role }) {
  const pathname = usePathname();
  return <nav className="workspace-nav" aria-label="Main">{LINKS.filter((link) => link.roles.includes(role)).map(({ href, label, Icon }) => {
    const active = href === "/" ? pathname === "/" || pathname.startsWith("/projects") : pathname.startsWith(href);
    return <Link key={href} href={href} aria-current={active ? "page" : undefined}><Icon aria-hidden="true" />{label}</Link>;
  })}</nav>;
}
