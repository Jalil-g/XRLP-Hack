import type { ProjectSummary, ProjectType } from "./contract";

export const MARKETPLACE_TYPES = ["residential_new", "residential_renovation", "commercial_small"] as const satisfies readonly ProjectType[];

export function parseProjectType(value: string | string[] | undefined): ProjectType | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  return MARKETPLACE_TYPES.find((type) => type === candidate);
}

/** A verified project stays listed through funding, construction, repayment, and completion. */
export function marketplaceProjects(projects: ProjectSummary[], type?: ProjectType): ProjectSummary[] {
  return projects.filter((project) => project.verified && (!type || project.type === type));
}

export function fundingCountdown(deadline: string, now = Date.now()): string {
  const remainingMs = Date.parse(deadline) - now;
  if (!Number.isFinite(remainingMs)) return "Funding deadline unavailable";
  if (remainingMs <= 0) return "Funding closed";
  const minutes = Math.ceil(remainingMs / 60_000);
  if (minutes < 60) return `Closes in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const leftoverMinutes = minutes % 60;
  if (hours < 24) return `Closes in ${hours}h${leftoverMinutes ? ` ${leftoverMinutes}m` : ""}`;
  const days = Math.floor(hours / 24);
  const leftoverHours = hours % 24;
  return `Closes in ${days}d${leftoverHours ? ` ${leftoverHours}h` : ""}`;
}
