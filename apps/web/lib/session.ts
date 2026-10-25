// Demo "session": which role and identity the presenter is acting as. Cookies set by the header role switcher. No auth.
import { cookies } from "next/headers";
import { api } from "./api";
import { loadDirectory } from "./directory";

export type Role = "investor" | "builder" | "platform";
export const ROLES: Role[] = ["investor", "builder", "platform"];
export const SESSION_COOKIES = { role: "dp_role", investor: "dp_investor", builder: "dp_builder" } as const;

export async function getSession() {
  const jar = await cookies();
  // Keep the layout usable on failure; the header warns and pages distinguish unavailable from empty.
  const { parties, builders, directoryUnavailable } = await loadDirectory(api);
  const investors = parties.filter((p) => p.role === "investor");
  const roleCookie = jar.get(SESSION_COOKIES.role)?.value as Role | undefined;
  const investorId = jar.get(SESSION_COOKIES.investor)?.value;
  const builderId = jar.get(SESSION_COOKIES.builder)?.value;
  return {
    directoryUnavailable,
    role: roleCookie && ROLES.includes(roleCookie) ? roleCookie : ("investor" as Role),
    investor: investors.find((p) => p.address === investorId) ?? investors[0],
    builder: builders.find((b) => b.id === builderId) ?? builders[0],
    platform: parties.find((p) => p.role === "platform"),
    investors,
    builders,
    parties,
  };
}

export type Session = Awaited<ReturnType<typeof getSession>>;
