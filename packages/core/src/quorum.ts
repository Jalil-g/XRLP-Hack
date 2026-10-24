// Release quorum — mirrors the SPV SignerList (docs/03-architecture.md, docs/decisions.md):
// SignerQuorum 3; inspector weight 2, ai_agent weight 1, platform weight 1.
// => every release needs an inspector, plus one of: a second inspector / AI pass / platform.
// Policy may additionally require 2 distinct inspectors (big milestones).
import type { Attestation } from "@xrlp/shared";

export const SIGNER_WEIGHTS: Record<Attestation["role"], number> = { inspector: 2, ai_agent: 1, platform: 1, release_service: 0 /* v2 role; quorum model removed in CORE-02 */ };
export const SIGNER_QUORUM = 3;

export interface QuorumStatus {
  met: boolean;
  /** true if any counted attestation is a reject. */
  rejected: boolean;
  weight: number;
  quorum: number;
  inspectorApprovals: number;
  requiredInspectors: number;
  aiApproved: boolean;
  platformApproved: boolean;
  /** Human-readable list of what's still missing (empty when met). */
  missing: string[];
}

/** Evaluate approvals for ONE review round of ONE milestone. Duplicate signers count once (latest wins). */
export function evaluateQuorum(attestations: readonly Attestation[], requiredInspectors: number): QuorumStatus {
  const latestBySigner = new Map<string, Attestation>();
  for (const a of attestations) latestBySigner.set(`${a.role}:${a.signer}`, a);
  const counted = [...latestBySigner.values()];

  const rejected = counted.some((a) => a.decision === "reject");
  const approvals = counted.filter((a) => a.decision === "approve");
  const inspectorApprovals = approvals.filter((a) => a.role === "inspector").length;
  const aiApproved = approvals.some((a) => a.role === "ai_agent");
  const platformApproved = approvals.some((a) => a.role === "platform");
  const weight = approvals.reduce((w, a) => w + SIGNER_WEIGHTS[a.role], 0);
  const needInspectors = Math.max(1, requiredInspectors);

  const missing: string[] = [];
  if (rejected) missing.push("a signer rejected this milestone");
  if (inspectorApprovals < needInspectors) {
    const n = needInspectors - inspectorApprovals;
    missing.push(`${n} more inspector approval${n > 1 ? "s" : ""}`);
  }
  if (weight < SIGNER_QUORUM && inspectorApprovals >= needInspectors) {
    missing.push("one more approval: second inspector, AI pass, or platform");
  }
  const met = !rejected && inspectorApprovals >= needInspectors && weight >= SIGNER_QUORUM;
  return {
    met,
    rejected,
    weight,
    quorum: SIGNER_QUORUM,
    inspectorApprovals,
    requiredInspectors: needInspectors,
    aiApproved,
    platformApproved,
    missing: met ? [] : missing,
  };
}
