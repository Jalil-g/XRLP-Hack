// Release = the milestone test suite (docs/03-architecture.md §Release). Replaces the v1 signer-weight quorum.
//
//   1. every required check "pass" AND verdict decision "pass" AND confidence >= minConfidence AND audits ok -> pass
//   2. any required check "fail" (incl. a missing / wrong-inspector / unattested audit)                        -> fail
//   3. otherwise                                                                                               -> needs_human
//      A platform operator may resolve needs_human with a signed, attested reason. That is the only override:
//      it can never turn a failed check into a release.
//
// Pure: no I/O. Core recomputes `inspector_audit_present` from its own audit records (attested on-chain by the
// ASSIGNED inspector) instead of trusting the verifier's copy of that check.
import type { CheckResult, ChecksStatus, InspectorAudit, ReleasePolicy, Verdict, XrplAddress } from "@xrlp/shared";

export interface OperatorDecision {
  decision: "approve" | "reject";
  reason: string;
  /** decision_attested tx. Unattested decisions are ignored. */
  txHash?: string;
}

export interface ReleaseInput {
  milestoneId: string;
  verdict?: Verdict;
  policy: ReleasePolicy;
  /** Audits on record for this milestone (any inspector, any round). */
  audits: readonly InspectorAudit[];
  /** Inspectors assigned to this project at lock-terms. */
  assignedInspectors: readonly XrplAddress[];
  operatorDecision?: OperatorDecision;
}

export interface ReleaseEvaluation extends ChecksStatus {
  /** Why the outcome isn't "pass" (empty on pass). */
  reasons: string[];
  /** Outcome came from an operator decision on needs_human. */
  overridden: boolean;
}

export const AUDIT_CHECK = "inspector_audit_present";

/** Core's own inspector_audit_present: distinct ASSIGNED inspectors with an ATTESTED audit for THIS milestone. */
export function auditCheck(
  milestoneId: string,
  audits: readonly InspectorAudit[],
  assigned: readonly XrplAddress[],
  requiredAudits: number,
): CheckResult {
  const forMilestone = audits.filter((a) => a.milestoneId === milestoneId);
  const attested = forMilestone.filter((a) => !!a.txHash);
  const valid = new Set(attested.filter((a) => assigned.includes(a.inspector)).map((a) => a.inspector));
  const strangers = attested.filter((a) => !assigned.includes(a.inspector)).map((a) => a.inspector);

  if (valid.size >= requiredAudits) {
    return {
      check: AUDIT_CHECK,
      result: "pass",
      reason: `${valid.size} signed audit${valid.size > 1 ? "s" : ""} from assigned inspector${valid.size > 1 ? "s" : ""}, attested on-chain`,
      evidenceIds: [],
    };
  }
  let reason: string;
  if (forMilestone.length === 0) reason = "no inspector audit on record";
  else if (attested.length === 0) reason = "audit not attested on-chain";
  else if (valid.size === 0 && strangers.length) reason = `audit signed by an unassigned inspector (${strangers.join(", ")})`;
  else reason = `${valid.size}/${requiredAudits} required audits from assigned inspectors`;
  return { check: AUDIT_CHECK, result: "fail", reason, evidenceIds: [] };
}

export function evaluateRelease(input: ReleaseInput): ReleaseEvaluation {
  const { milestoneId, verdict, policy, audits, assignedInspectors, operatorDecision } = input;
  const audit = auditCheck(milestoneId, audits, assignedInspectors, policy.requiredAudits);

  if (!verdict) {
    return { required: [audit], optional: [], outcome: "pending", reasons: ["checks have not run"], overridden: false };
  }
  if (verdict.milestoneId !== milestoneId) {
    throw new Error(`verdict is for milestone ${verdict.milestoneId}, not ${milestoneId}`);
  }

  // Latest result per check id; core's audit check replaces the verifier's.
  const byId = new Map<string, CheckResult>();
  for (const c of verdict.checks) byId.set(c.check, c);
  byId.set(AUDIT_CHECK, audit);

  const requiredIds = [...new Set([...policy.requiredChecks, AUDIT_CHECK])];
  const required: CheckResult[] = requiredIds.map(
    (id) => byId.get(id) ?? { check: id, result: "skipped", reason: "required check did not run", evidenceIds: [] },
  );
  const optional = [...byId.values()].filter((c) => !requiredIds.includes(c.check));

  const failed = required.filter((c) => c.result === "fail");
  const notPassed = required.filter((c) => c.result !== "pass" && c.result !== "fail");
  const lowConfidence = verdict.confidence < policy.minConfidence;

  const base = { required, optional, verdict };
  if (failed.length) {
    return { ...base, outcome: "fail", reasons: failed.map((c) => `${c.check}: ${c.reason}`), overridden: false };
  }

  const reasons: string[] = [
    ...notPassed.map((c) => `${c.check}: ${c.result} — ${c.reason}`),
    ...(lowConfidence ? [`confidence ${verdict.confidence} below ${policy.minConfidence}`] : []),
    ...(verdict.decision !== "pass" ? [`verifier decision: ${verdict.decision}`] : []),
  ];
  if (reasons.length === 0) return { ...base, outcome: "pass", reasons: [], overridden: false };

  if (operatorDecision?.txHash) {
    const why = `operator ${operatorDecision.decision}: ${operatorDecision.reason}`;
    return operatorDecision.decision === "approve"
      ? { ...base, outcome: "pass", reasons: [], overridden: true }
      : { ...base, outcome: "fail", reasons: [why], overridden: true };
  }
  return { ...base, outcome: "needs_human", reasons, overridden: false };
}
