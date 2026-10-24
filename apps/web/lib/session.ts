// Demo "session": role + identity per role, stored in cookies by the header role switcher. No auth.
import { cookies } from "next/headers";
import { listParties } from "./api";
import type { Role } from "./types";

export const SESSION_COOKIES = {
  role: "ks_role",
  investor: "ks_investor",
  inspector: "ks_inspector",
  builder: "ks_builder",
} as const;

const ROLES: Role[] = ["investor", "builder", "inspector", "platform"];

export async function getSession() {
  const jar = await cookies();
  const parties = await listParties();
  const pick = <T extends { address?: string; id?: string }>(list: T[], value: string | undefined, key: "address" | "id") =>
    list.find((x) => x[key] === value) ?? list[0]!;
  const roleCookie = jar.get(SESSION_COOKIES.role)?.value as Role | undefined;
  return {
    role: roleCookie && ROLES.includes(roleCookie) ? roleCookie : ("investor" as Role),
    investor: pick(parties.investors, jar.get(SESSION_COOKIES.investor)?.value, "address"),
    inspector: pick(parties.inspectors, jar.get(SESSION_COOKIES.inspector)?.value, "address"),
    builder: pick(parties.builders, jar.get(SESSION_COOKIES.builder)?.value, "id"),
    parties,
  };
}

export type Session = Awaited<ReturnType<typeof getSession>>;
