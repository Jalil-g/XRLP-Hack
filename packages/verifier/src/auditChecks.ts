import { InspectorAudit } from "@xrlp/shared";
import { evidenceBundleHash } from "./audit.ts";
import type { CheckOutcome, LoadedEvidence, VerifyMilestoneInput } from "./types.ts";

const result = (check: string, state: CheckOutcome["result"], reason: string): CheckOutcome =>
  ({ check, result: state, reason, evidenceIds: [], confidence: state === "warn" ? 0.5 : 0.99, source: "deterministic" });

/** Transaction authenticity is core/ledger's responsibility; this validates its trusted audit context. */
export function checkInspectorAudits(input: VerifyMilestoneInput, loaded: LoadedEvidence[], count: 1 | 2): CheckOutcome[] {
  const fail = (reason: string) => [result("inspector_audit_present", "fail", reason), result("audit_checklist_complete", "fail", "No complete trusted audit set available.")];
  if (!input.audits?.length) return fail("No inspector audit submitted; funds stay locked.");
  if (!input.assignedInspectors?.length) return fail("Trusted assigned inspector addresses were not supplied by core.");
  if (loaded.some((l) => !l.sha256 || l.loadError)) return fail("Cannot bind the inspector audit to unreadable builder evidence.");
  const expectedHash = evidenceBundleHash(loaded.map((l) => ({ sha256: l.sha256! })));
  const seen = new Set<string>();
  const txs = new Set<string>();
  const audits: InspectorAudit[] = [];
  for (const raw of input.audits) {
    const parsed = InspectorAudit.safeParse(raw);
    if (!parsed.success) return fail("Malformed inspector audit.");
    const a = parsed.data;
    if (a.milestoneId !== input.milestone.id) return fail("Inspector audit references another milestone.");
    if (!input.assignedInspectors.includes(a.inspector)) return fail(`Audit signer ${a.inspector} is not an assigned inspector.`);
    if (a.evidenceBundleHash !== expectedHash) return fail("Inspector audit covers a different evidence bundle; re-audit required.");
    if (!a.txHash || !/^[0-9a-f]{64}$/i.test(a.txHash)) return fail("Inspector audit has no valid attestation transaction hash.");
    if (seen.has(a.inspector) || txs.has(a.txHash.toUpperCase())) return fail("Duplicate inspector or attestation cannot satisfy independent audits.");
    seen.add(a.inspector); txs.add(a.txHash.toUpperCase()); audits.push(a);
  }
  if (seen.size < count) return fail(`${seen.size}/${count} required independent inspector audits; funds stay locked.`);
  const codes = input.milestone.sovCodes ?? [];
  const sov = input.sov ?? input.project.sov ?? [];
  const present = result("inspector_audit_present", "pass", `${seen.size}/${count} independent assigned inspector audits match this milestone and exact evidence bundle (attestation hashes present; authenticated by core).`);
  if (!codes.length || codes.some((code) => !sov.some((line) => line.code === code))) {
    return [present, result("audit_checklist_complete", "warn", "Trusted milestone SoV codes are missing or unknown; cannot establish checklist completeness.")];
  }
  for (const a of audits) {
    const actual = a.checklist.map((line) => line.sovCode);
    if (new Set(actual).size !== actual.length || actual.some((code) => !codes.includes(code)) || codes.some((code) => !actual.includes(code))) {
      return [present, result("audit_checklist_complete", "fail", "Checklist has missing, duplicate or unrelated SoV lines.")];
    }
    if (a.checklist.some((line) => line.status === "not_done")) return [present, result("audit_checklist_complete", "fail", "Inspector marks a required SoV line not_done; milestone incomplete.")];
  }
  if (audits.some((a) => a.checklist.some((line) => line.status === "partial"))) return [present, result("audit_checklist_complete", "warn", "Inspector marks a required SoV line partial; completion requires review.")];
  return [present, result("audit_checklist_complete", "pass", `All ${codes.length} required SoV lines marked done in every required audit.`)];
}
