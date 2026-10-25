// VER-13: deterministic panel ranking. No key, model call, ledger operation or state mutation.
import { Inspector, InspectorAssignment, type Project, type XrplAddress } from "@xrlp/shared";
import { z } from "zod";
import { haversineM } from "./util.ts";

/** Scheduling data is local until the shared contract exposes it (coordination: #53). */
export interface InspectorAvailability {
  available?: boolean;
  openAudits?: number;
  priorAgreement?: number;
}

export interface AssignInspectorInput {
  project: Project;
  panel: (Inspector & InspectorAvailability)[];
  count: 1 | 2;
  /** Explicit state wins over fixture extensions; missing data is reported, never invented. */
  availability?: Record<XrplAddress, InspectorAvailability>;
}

const Geo = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) });
const Scheduling = z.object({
  available: z.boolean().optional(),
  openAudits: z.number().int().nonnegative().optional(),
  priorAgreement: z.number().min(0).max(1).optional(),
});

/**
 * Score out of 100: trade coverage 40, distance 25 (linear to 100 km), capacity 20
 * (20/(1+openAudits)), prior agreement 15. Unknown values receive zero points and
 * are disclosed. Unverified / explicitly unavailable / non-matching trades are
 * excluded. Ties use address order so panel ordering cannot change the result.
 */
export async function assignInspector(input: AssignInspectorInput): Promise<InspectorAssignment> {
  if (input.count !== 1 && input.count !== 2) throw new Error("Inspector count must be 1 or 2.");
  Geo.parse(input.project.siteGeo);
  const needed = [...new Set((input.project.sov ?? []).map((line) => line.trade.trim().toLowerCase()).filter(Boolean))].sort();
  const reasons = ["[deterministic panel ranking; MOCK scheduling/history when using fixtures]", "Roadmap: robot/sensor auditors use the same interface."];
  if (!needed.length) return { inspectors: [], scores: {}, reasons: [...reasons, "No Schedule-of-Values trades supplied; cannot safely match inspectors."] };

  const seen = new Set<string>();
  const ranked: { address: string; score: number; reason: string }[] = [];
  for (const raw of input.panel) {
    const inspector = Inspector.parse(raw);
    if (seen.has(inspector.address)) throw new Error(`Duplicate inspector address: ${inspector.address}`);
    seen.add(inspector.address);
    const schedule = Scheduling.parse(input.availability?.[inspector.address] ?? raw);
    const prefix = `${inspector.name} (${inspector.address})`;
    if (!inspector.verified || schedule.available === false) {
      reasons.push(`${prefix}: excluded (${!inspector.verified ? "not verified" : "unavailable"}).`);
      continue;
    }
    const trades = new Set(inspector.trades.map((trade) => trade.trim().toLowerCase()));
    const matches = needed.filter((trade) => trades.has(trade));
    if (!matches.length) {
      reasons.push(`${prefix}: excluded (no matching SoV trade).`);
      continue;
    }
    const distanceKm = inspector.homeGeo ? haversineM(Geo.parse(inspector.homeGeo), input.project.siteGeo) / 1000 : undefined;
    const tradePoints = 40 * matches.length / needed.length;
    const distancePoints = distanceKm === undefined ? 0 : 25 * Math.max(0, 1 - distanceKm / 100);
    const loadPoints = schedule.openAudits === undefined ? 0 : 20 / (1 + schedule.openAudits);
    const agreementPoints = schedule.priorAgreement === undefined ? 0 : 15 * schedule.priorAgreement;
    const score = Math.round((tradePoints + distancePoints + loadPoints + agreementPoints) * 100) / 100;
    ranked.push({ address: inspector.address, score, reason:
      `${prefix}: ${score}/100; trades ${matches.join(", ")} (${matches.length}/${needed.length}); ` +
      `distance ${distanceKm === undefined ? "unknown (0 points)" : `${distanceKm.toFixed(2)} km`}; ` +
      `open audits ${schedule.openAudits ?? "unknown (0 points)"}; agreement ${schedule.priorAgreement ?? "unknown (0 points)"}; ` +
      `availability ${schedule.available === true ? "confirmed" : "unknown; confirm before locking terms"}.` });
  }
  ranked.sort((a, b) => b.score - a.score || (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
  const scores = Object.fromEntries(ranked.map((candidate) => [candidate.address, candidate.score]));
  if (ranked.length < input.count) {
    return InspectorAssignment.parse({ inspectors: [], scores, reasons: [...reasons, ...ranked.map((r) => r.reason), `Need ${input.count} independent inspectors, only ${ranked.length} eligible; assignment incomplete, do not lock terms.`] });
  }
  const inspectors = ranked.slice(0, input.count).map((candidate) => candidate.address);
  return InspectorAssignment.parse({ inspectors, scores, reasons: [...reasons, ...ranked.map((r) => `${inspectors.includes(r.address) ? "Assigned" : "Reserve"}: ${r.reason}`)] });
}
