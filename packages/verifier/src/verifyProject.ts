import { ProjectVerification, type CheckResult, type RiskTier, type VerifyProjectInput as SharedInput } from "@xrlp/shared";
import { z } from "zod";
import { resolveMode } from "./config.ts";
import { normalizeName } from "./util.ts";
import { verifyBuilder, type BuilderRegistry } from "./verifyBuilder.ts";
import type { VerifierMode } from "./types.ts";
import { canonicalJson } from "./hash.ts";

export interface ProjectHistory { openProjects: number; priorMilestones: number; passedMilestones: number }
export interface VerifyProjectInput extends SharedInput {
  now?: string; mode?: VerifierMode; model?: string; dataDir?: string;
  registry?: BuilderRegistry;
  /** Trusted platform history; never inferred from builder-submitted prose. */
  history?: ProjectHistory;
}
export type ProjectVerificationResult = ProjectVerification & { inspectorPreVisitRequired: boolean; registryIsMock: boolean };
const ReviewSection = z.object({ result: z.enum(["pass", "fail", "warn"]), confidence: z.number().min(0).max(1), reason: z.string().min(1) });
export const ProjectReview = z.object({ identity: ReviewSection, feasibility: ReviewSection, capability: ReviewSection });
export interface ProjectVerifyOptions { judge?: (input: VerifyProjectInput) => Promise<z.infer<typeof ProjectReview>> }

const History = z.object({ openProjects: z.number().int().nonnegative(), priorMilestones: z.number().int().nonnegative(), passedMilestones: z.number().int().nonnegative() });
const shares: Record<string, number> = { concrete: 0.25, framing: 0.30, roofing: 0.20, finish: 0.25 };
const micro = (amount: string): bigint => {
  if (!/^\d+(?:\.\d{1,6})?$/.test(amount)) throw new Error("Invalid RLUSD amount.");
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
};

/** MOCK NYC residential cost proportions, not market quotes, professional advice or a registry lookup. */
export async function verifyProject(input: VerifyProjectInput, options: ProjectVerifyOptions = {}): Promise<ProjectVerificationResult> {
  const now = input.now ?? new Date().toISOString();
  const identity: CheckResult[] = [], feasibility: CheckResult[] = [], capability: CheckResult[] = [];
  const add = (section: CheckResult[], check: string, result: CheckResult["result"], reason: string) => section.push({ check, result, reason, evidenceIds: [] });
  let registryIsMock = true;
  try {
    const b = await verifyBuilder({ builder: input.builder, documents: input.documents, registry: input.registry, dataDir: input.dataDir, now });
    identity.push(...b.checks.filter((c) => c.check !== "track_record"));
    registryIsMock = b.registryIsMock;
  } catch {
    add(identity, "identity_registry_available", "warn", "Identity registry/document review unavailable; human review required.");
  }
  const entity = input.documents.find((d) => d.kind === "entity" || d.kind === "identity");
  const name = entity?.fields?.legalName ?? entity?.fields?.entityName ?? entity?.fields?.name;
  add(identity, "entity_consistent", !name ? "warn" : normalizeName(name) === normalizeName(input.builder.name) ? "pass" : "fail",
    "[MOCK entity record] Compare supplied legal entity with builder name; no government entity/sanctions lookup is performed.");
  if (input.project.builderId !== input.builder.id) add(identity, "builder_project_binding", "fail", "Project references a different builder.");
  if (input.project.sov && canonicalJson(input.project.sov) !== canonicalJson(input.sov)) add(feasibility, "project_sov_binding", "fail", "Submitted SoV differs from the project's stored SoV.");

  try {
    const principal = micro(input.project.terms.principal);
    const total = input.sov.reduce((sum, line) => sum + micro(line.amount), 0n);
    add(feasibility, "sov_matches_principal", input.sov.length && principal > 0n && total === principal ? "pass" : "fail", `Schedule of Values total ${total} micro-RLUSD vs principal ${principal} micro-RLUSD.`);
    const codes = input.sov.map((line) => line.code);
    add(feasibility, "sov_line_integrity", codes.length && new Set(codes).size === codes.length && input.sov.every((line) => line.code.trim() && micro(line.amount) > 0n) ? "pass" : "fail", "SoV codes must be unique, nonempty, and carry positive amounts.");
    const grouped = new Map<string, bigint>();
    for (const line of input.sov) grouped.set(line.trade.toLowerCase(), (grouped.get(line.trade.toLowerCase()) ?? 0n) + micro(line.amount));
    const inRegion = input.project.siteGeo.lat >= 40 && input.project.siteGeo.lat <= 42 && input.project.siteGeo.lng >= -75 && input.project.siteGeo.lng <= -72;
    const issues: string[] = [];
    for (const [trade, amount] of grouped) {
      const baseline = shares[trade];
      if (!baseline) issues.push(`no cost baseline for ${trade}`);
      else if (principal > 0n && Number(amount) / Number(principal) > baseline * 1.25) issues.push(`${trade} exceeds the MOCK regional proportion by >25%`);
    }
    add(feasibility, "regional_cost_plausibility", issues.length || !inRegion || input.project.type !== "residential_new" ? "warn" : "pass", `[MOCK NYC residential cost table] ${issues.join("; ") || "Trade proportions within the demo ranges."} Other regions/types require review; quantities and professional estimates are not available.`);
  } catch {
    add(feasibility, "sov_matches_principal", "fail", "Malformed monetary data; SoV cannot be reconciled.");
  }
  const geo = input.project.siteGeo;
  add(feasibility, "site_coordinates_plausible", Number.isFinite(geo.lat) && Number.isFinite(geo.lng) && Math.abs(geo.lat) <= 90 && Math.abs(geo.lng) <= 180 && geo.radiusM > 0 ? "pass" : "fail", "Coordinate bounds only; no geocoder or physical site-existence lookup was performed.");
  for (const kind of ["permit", "plans"] as const) {
    const doc = input.documents.find((d) => d.kind === kind);
    const status = doc?.fields?.status?.toLowerCase();
    const invalid = status && ["denied", "rejected", "expired", "revoked"].includes(status);
    const supplied = status && ["approved", "complete", "valid"].includes(status);
    add(feasibility, `${kind}_present`, invalid ? "fail" : supplied ? "pass" : "warn", `[MOCK document record] ${kind}: ${status ?? "missing/unread"}; authenticity not independently verified.`);
  }
  const terms = input.project.terms;
  const validClock = Number.isFinite(Date.parse(now));
  const timelineOk = validClock && Number.isFinite(Date.parse(terms.fundingDeadline)) && terms.termDays >= 30 && terms.termDays <= 1095 && terms.paymentIntervalDays > 0 && terms.paymentIntervalDays <= terms.termDays && Date.parse(terms.fundingDeadline) <= Date.parse(now) + 366 * 86_400_000;
  add(feasibility, "timeline_plausible", timelineOk ? "pass" : "warn", "Demo duration/deadline plausibility only; detailed construction scheduling requires professional review.");

  const history = History.safeParse(input.history);
  const h = history.success && history.data.passedMilestones <= history.data.priorMilestones ? history.data : undefined;
  add(capability, "completed_projects", input.builder.completedProjects >= 3 ? "pass" : "warn", `Trusted builder record: ${input.builder.completedProjects} completed projects.`);
  add(capability, "open_project_capacity", h && h.openProjects <= 3 ? "pass" : "warn", h ? `${h.openProjects} open projects; demo capacity limit 3.` : "Trusted open-project load missing or invalid.");
  add(capability, "prior_milestone_performance", h && h.priorMilestones > 0 && h.passedMilestones / h.priorMilestones >= 0.8 ? "pass" : "warn", h ? `${h.passedMilestones}/${h.priorMilestones} prior milestones passed; demo threshold 80%.` : "Trusted milestone history missing or invalid.");
  let riskTier: RiskTier = input.builder.completedProjects >= 10 ? "low" : input.builder.completedProjects >= 3 ? "medium" : "high";
  if (!h || h.openProjects > 3 || h.priorMilestones === 0 || h.passedMilestones / h.priorMilestones < 0.8) riskTier = "high";
  const rank = { low: 0, medium: 1, high: 2 };
  if (rank[input.builder.riskTier] > rank[riskTier]) riskTier = input.builder.riskTier;
  if (resolveMode(input.mode) === "live") {
    try {
      const judge = options.judge ?? (await import("./llm/project.ts")).reviewProjectLive;
      const sections = ProjectReview.parse(await judge(input));
      for (const section of ["identity", "feasibility", "capability"] as const) {
        const target = section === "identity" ? identity : section === "feasibility" ? feasibility : capability;
        const review = sections[section];
        add(target, `${section}_ai_review`, review.confidence < 0.8 ? "warn" : review.result, `[LLM judgement] ${review.reason}`);
      }
    } catch {
      add(feasibility, "project_ai_available", "warn", "Live project review unavailable/refused/timed out; human review required.");
    }
  }
  const checks = [...identity, ...feasibility, ...capability];
  const decision = checks.some((c) => c.result === "fail") ? "fail" : checks.some((c) => c.result !== "pass") ? "needs_human" : "pass";
  const summary = `${decision.toUpperCase()}: identity, feasibility and capability reviewed. ${checks.filter((c) => c.result !== "pass").map((c) => `${c.check}: ${c.reason}`).join(" | ")} Registries/cost tables are MOCK unless an explicit registry adapter was supplied.`;
  return { ...ProjectVerification.parse({ identity, feasibility, capability, decision, riskTier, summary, model: resolveMode(input.mode) === "mock" ? "mock" : "live+deterministic", createdAt: validClock ? now : new Date().toISOString() }), inspectorPreVisitRequired: decision === "needs_human", registryIsMock };
}
