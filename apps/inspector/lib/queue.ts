// INS-02 queue logic, kept free of React so it is unit-tested (test/queue.test.ts).
// Route 18 returns one task per assigned milestone (plus pre-visits); the queue groups them by what the inspector must do.
import type { EvidenceRequirement, InspectorTask, TaskNeeds } from "./types.ts";

/** Order on screen: a failed suite waiting on you first, then audits that gate money, then pre-construction visits. */
export const ACTIONABLE: readonly Exclude<TaskNeeds, "none">[] = ["re_audit", "audit", "pre_visit"];

/** The audit form for an audit / re-audit task; null for pre-visits (see `taskHref`) and tasks with nothing due. */
export function auditHref(t: Pick<InspectorTask, "projectId" | "milestone" | "needs">): string | null {
  if (!t.milestone || (t.needs !== "audit" && t.needs !== "re_audit")) return null;
  return `/audit/${encodeURIComponent(t.projectId)}/${encodeURIComponent(t.milestone.id)}`;
}

/** Where a queue row leads: the audit form, the INS-06 site-visit form for a pre-visit, or nowhere. */
export function taskHref(t: Pick<InspectorTask, "projectId" | "milestone" | "needs">): string | null {
  if (t.needs === "pre_visit" && !t.milestone) return `/site-visit/${encodeURIComponent(t.projectId)}`;
  return auditHref(t);
}

export const taskKey = (t: Pick<InspectorTask, "projectId" | "milestone">) => `${t.projectId}:${t.milestone?.id ?? "pre_visit"}`;

export type EvidenceKindStatus = { kind: EvidenceRequirement["kind"]; have: number; need: number };
export type EvidenceStatus = {
  /** One row per evidence kind the SoV lines require, in first-seen order. */
  kinds: EvidenceKindStatus[];
  /** Files the builder uploaded (all kinds, incl. ones no line asks for). */
  uploaded: number;
  state: "none" | "partial" | "complete";
};

/**
 * Builder evidence vs what the milestone's SoV lines require: the inspector's at-a-glance view; the suite's
 * `required_evidence_present` is the authority. Same rule as the verifier (packages/verifier/src/checks.ts): evidence is not
 * tagged per requirement, so each requirement is met by all files of its kind and the bar per kind is the largest `minCount`.
 * (Summing would show red here while the suite passes.)
 */
export function evidenceStatus(task: Pick<InspectorTask, "sov" | "evidence">): EvidenceStatus {
  const need = new Map<EvidenceRequirement["kind"], number>();
  for (const line of task.sov) for (const r of line.evidence) need.set(r.kind, Math.max(need.get(r.kind) ?? 0, r.minCount));
  const kinds = [...need].map(([kind, n]) => ({ kind, need: n, have: task.evidence.filter((e) => e.kind === kind).length }));
  const uploaded = task.evidence.length;
  const complete = kinds.every((k) => k.have >= k.need);
  return { kinds, uploaded, state: uploaded === 0 ? "none" : complete ? "complete" : "partial" };
}

/** Sum of the SoV lines' amounts (pre-visits have no milestone, so this is the project's scheduled value). Decimal strings, 6 dp max. */
export function sovTotal(task: Pick<InspectorTask, "sov">): string {
  const micro = task.sov.reduce((sum, l) => {
    const [whole = "0", frac = ""] = l.amount.split(".");
    return sum + BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, "0"));
  }, 0n);
  const frac = (micro % 1_000_000n).toString().padStart(6, "0").slice(0, 2);
  return `${micro / 1_000_000n}.${frac}`;
}

/** The milestone's amount, or the SoV total for a pre-visit. */
export const taskAmount = (task: Pick<InspectorTask, "milestone" | "sov">) => task.milestone?.amount ?? sovTotal(task);

const deadline = (t: InspectorTask) => (t.milestone?.cancelAfter ? Date.parse(t.milestone.cancelAfter) : Number.POSITIVE_INFINITY);

/** Soonest escrow expiry first (that money is at risk of refund), then project, then milestone order. */
export function compareTasks(a: InspectorTask, b: InspectorTask): number {
  return (
    deadline(a) - deadline(b) ||
    a.projectName.localeCompare(b.projectName) ||
    (a.milestone?.index ?? -1) - (b.milestone?.index ?? -1)
  );
}

export type QueueGroups = Record<TaskNeeds, InspectorTask[]>;

export function groupTasks(tasks: readonly InspectorTask[]): QueueGroups {
  const groups: QueueGroups = { re_audit: [], audit: [], pre_visit: [], none: [] };
  for (const t of tasks) groups[t.needs].push(t);
  for (const list of Object.values(groups)) list.sort(compareTasks);
  return groups;
}

/** Keys present in `next` but not in `prev`: tasks that arrived since the last poll (highlighted on screen). */
export function arrivedKeys(prev: readonly InspectorTask[] | null, next: readonly InspectorTask[]): Set<string> {
  if (!prev) return new Set();
  const seen = new Set(prev.filter((t) => t.needs !== "none").map(taskKey));
  return new Set(next.filter((t) => t.needs !== "none" && !seen.has(taskKey(t))).map(taskKey));
}
