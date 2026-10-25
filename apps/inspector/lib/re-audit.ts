import type { ChecksStatus, InspectorAudit, InspectorTask } from "./types.ts";

export function latestOwnAudit(task: InspectorTask, inspector: string): InspectorAudit | undefined {
  return task.priorAudits
    .filter((a) => a.inspector === inspector && a.milestoneId === task.milestone?.id)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
}

/** Unknown/malformed hashes must not imply that the builder resubmitted evidence. */
export function bundleComparison(current?: string, prior?: string): "unknown" | "same" | "changed" {
  if (!current || !prior || !/^[a-f0-9]{64}$/i.test(current) || !/^[a-f0-9]{64}$/i.test(prior)) return "unknown";
  return current.toLowerCase() === prior.toLowerCase() ? "same" : "changed";
}

export function reviewIssues(checks?: ChecksStatus) {
  return [
    ...(checks?.required ?? []).map((check) => ({ ...check, required: true })),
    ...(checks?.optional ?? []).map((check) => ({ ...check, required: false })),
  ].filter((check) => check.result !== "pass")
    .sort((a, b) => Number(b.required) - Number(a.required) || Number(b.result === "fail") - Number(a.result === "fail"));
}
