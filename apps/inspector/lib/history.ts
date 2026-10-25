import type { ChecksStatus, InspectorAudit, Milestone, Project, ProjectDetail } from "./types.ts";

/** These checks explicitly consume the inspector report; other checks may also use its photos. */
export const AUDIT_CHECKS = ["inspector_audit_present", "audit_checklist_complete", "audit_matches_evidence"] as const;

export type AuditHistoryEntry = {
  project: Project;
  milestone: Milestone;
  audit: InspectorAudit;
  checks: ChecksStatus;
  /** Route 2 provides the latest milestone suite, not a suite per audit revision. */
  verdictPredatesAudit: boolean;
  releaseTx?: string;
};

export function auditHistory(details: ProjectDetail[], inspector: string): AuditHistoryEntry[] {
  return details.flatMap((detail) => detail.project.milestones.flatMap((milestone) => {
    const checks = detail.checks[milestone.id] ?? { required: [], optional: [], outcome: "pending" as const };
    const release = detail.events
      .filter((e) => e.milestoneId === milestone.id && e.kind === "escrow_finished" && (!e.result || e.result === "tesSUCCESS"))
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0];
    return (detail.audits[milestone.id] ?? [])
      .filter((audit) => audit.inspector === inspector)
      .map((audit) => ({
        project: detail.project,
        milestone,
        audit,
        checks,
        verdictPredatesAudit: !!checks.verdict && Date.parse(checks.verdict.createdAt) < Date.parse(audit.at),
        releaseTx: milestone.escrow?.finishTx ?? release?.txHash,
      }));
  })).sort((a, b) => Date.parse(b.audit.at) - Date.parse(a.audit.at));
}
