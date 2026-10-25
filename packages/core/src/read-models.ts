// Read models: pure functions DbState -> shared DTOs (docs/05-api.md §2). No I/O; vault/loan snapshots are computed from
// core's own records so reads stay fast in devnet mode (the ledger remains the source of truth for money).
import type {
  Attestation,
  ChainEvent,
  ChecksStatus,
  Evidence,
  InspectorAudit,
  InspectorTask,
  LoanSnapshot,
  Milestone,
  PortfolioPosition,
  Project,
  ProjectDetail,
  ProjectSummary,
  SovLine,
  VaultSnapshot,
  XrplAddress,
} from "@xrlp/shared";
import { DomainError } from "./errors.ts";
import { fromMicro, sumMicro, toMicro, totalOwedMicro } from "./money.ts";
import { evaluateRelease } from "./release-policy.ts";
import { isTerminal } from "./state-machine.ts";
import type { DbState, EvidenceRecord, VerdictRecord } from "./store.ts";

// ---------- lookups ----------

export function getProjectOrThrow(db: DbState, id: string): Project {
  const p = db.projects.find((x) => x.id === id);
  if (!p) throw new DomainError("NOT_FOUND", `Project ${id} not found`);
  return p;
}
export function getMilestoneOrThrow(project: Project, mid: string): Milestone {
  const m = project.milestones.find((x) => x.id === mid);
  if (!m) throw new DomainError("NOT_FOUND", `Milestone ${mid} not found in project ${project.id}`);
  return m;
}
export const metaOf = (db: DbState, projectId: string) => db.projectMeta.find((m) => m.projectId === projectId);
export const assignedInspectors = (db: DbState, projectId: string): XrplAddress[] => metaOf(db, projectId)?.assignment?.inspectors ?? [];

/** SoV lines a milestone pays for. */
export function sovFor(project: Project, m: Milestone): SovLine[] {
  const codes = m.sovCodes ?? [m.templateKey];
  return (project.sov ?? []).filter((l) => codes.includes(l.code));
}

/** Current evidence round (0 = nothing submitted yet). */
export const currentRound = (db: DbState, mid: string): number =>
  db.evidence.filter((e) => e.milestoneId === mid).reduce((r, e) => Math.max(r, e.round), 0);
export const roundEvidence = (db: DbState, mid: string, round: number): EvidenceRecord[] =>
  db.evidence.filter((e) => e.milestoneId === mid && e.round === round);
export const roundAudits = (db: DbState, mid: string, round: number) => db.audits.filter((a) => a.milestoneId === mid && a.round === round);
export const latestVerdict = (db: DbState, mid: string): VerdictRecord | undefined => db.verdicts.filter((v) => v.milestoneId === mid).at(-1);
export const latestDecision = (db: DbState, mid: string, round: number) =>
  db.decisions.filter((d) => d.milestoneId === mid && d.round === round).at(-1);

const stripRecord = <T extends object>(r: T): T => {
  const { projectId: _p, round: _r, ...rest } = r as T & { projectId?: string; round?: number };
  return rest as T;
};

// ---------- money ----------

function burnedShares(db: DbState, projectId: string, investor?: string): bigint {
  return db.withdrawals.filter((w) => w.projectId === projectId && (!investor || w.investor === investor)).reduce((sum, w) => {
    if (w.sharesBurned === undefined || !/^\d+$/.test(w.sharesBurned))
      throw new DomainError("CONFLICT", "Legacy withdrawal has no share-burn record; reconcile ledger shares or reset the fake demo");
    return sum + BigInt(w.sharesBurned);
  }, 0n);
}

export const paymentTotalOf = (p: Project) => Math.max(2, Math.round(p.terms.termDays / p.terms.paymentIntervalDays));

export function vaultTotals(db: DbState, p: Project) {
  const deposits = sumMicro(db.investments.filter((i) => i.projectId === p.id).map((i) => i.amount));
  const withdrawn = sumMicro(db.withdrawals.filter((w) => w.projectId === p.id).map((w) => w.amount));
  const loaned = p.chain.loanId ? toMicro(p.terms.principal) : 0n;
  const repaid = sumMicro(db.repayments.filter((r) => r.projectId === p.id).map((r) => r.amount));
  const owed = loaned ? totalOwedMicro(p.terms.principal, p.terms.interestRateBps, p.terms.termDays) : 0n;
  const outstanding = owed > repaid ? owed - repaid : 0n;
  const available = deposits - loaned + repaid - withdrawn;
  const shares = deposits - burnedShares(db, p.id); // Subscription starts at one share unit per micro-RLUSD
  const total = available + outstanding;
  return { deposits, withdrawn, loaned, repaid, owed, outstanding, available, shares, total };
}

export function vaultPhase(p: Project, now: Date): VaultSnapshot["phase"] {
  const t = now.getTime();
  if (!p.chain.subscriptionDate || t <= new Date(p.chain.subscriptionDate).getTime()) return "subscription";
  if (!p.chain.redemptionDate || t < new Date(p.chain.redemptionDate).getTime()) return "investment";
  return "redemption";
}

export function vaultSnapshot(db: DbState, p: Project, now: Date): VaultSnapshot | undefined {
  if (!p.chain.vaultId) return undefined;
  const v = vaultTotals(db, p);
  return {
    assetsTotal: fromMicro(v.total > 0n ? v.total : 0n),
    assetsAvailable: fromMicro(v.available > 0n ? v.available : 0n),
    sharesOutstanding: v.shares.toString(),
    sharePrice: v.shares > 0n ? (Number(v.total) / Number(v.shares)).toFixed(6) : "1.000000",
    subscriptionDate: p.chain.subscriptionDate ?? p.terms.fundingDeadline,
    redemptionDate: p.chain.redemptionDate ?? p.terms.fundingDeadline,
    phase: vaultPhase(p, now),
  };
}

export function loanSnapshot(db: DbState, p: Project): LoanSnapshot | undefined {
  if (!p.chain.loanId) return undefined;
  const v = vaultTotals(db, p);
  const n = paymentTotalOf(p);
  const periodic = v.owed / BigInt(n);
  const principal = toMicro(p.terms.principal);
  const payments = db.repayments.filter((r) => r.projectId === p.id).length;
  const start = metaOf(db, p.id)?.escrowedAt ?? p.terms.fundingDeadline;
  return {
    principalOutstanding: fromMicro(principal > v.repaid ? principal - v.repaid : 0n),
    totalValueOutstanding: fromMicro(v.outstanding),
    periodicPayment: fromMicro(periodic),
    paymentRemaining: Math.max(0, n - payments),
    nextPaymentDueDate: new Date(new Date(start).getTime() + (payments + 1) * p.terms.paymentIntervalDays * 86_400_000).toISOString(),
  };
}

export function investorTotals(db: DbState, p: Project, investor: string) {
  const deposited = sumMicro(db.investments.filter((i) => i.projectId === p.id && i.investor === investor).map((i) => i.amount));
  const withdrawn = sumMicro(db.withdrawals.filter((w) => w.projectId === p.id && w.investor === investor).map((w) => w.amount));
  const v = vaultTotals(db, p);
  const shares = deposited - burnedShares(db, p.id, investor);
  const value = v.shares > 0n ? (shares * (v.total > 0n ? v.total : 0n)) / v.shares : 0n;
  // Liquid claim, pro rata by shares, capped by what the vault holds.
  const claim = v.shares > 0n ? (shares * (v.available > 0n ? v.available : 0n)) / v.shares : 0n;
  return { deposited, withdrawn, shares, value, withdrawable: claim, assetsTotal: v.total, sharesOutstanding: v.shares };
}

// ---------- checks ----------

export function checksFor(db: DbState, p: Project, m: Milestone): ChecksStatus {
  const round = currentRound(db, m.id);
  const verdict = latestVerdict(db, m.id);
  if (!verdict || verdict.round !== round) return { required: [], optional: [], outcome: "pending" };
  const decision = latestDecision(db, m.id, round);
  const ev = evaluateRelease({
    milestoneId: m.id,
    verdict: stripRecord(verdict),
    policy: verdict.policy2,
    audits: roundAudits(db, m.id, round),
    assignedInspectors: assignedInspectors(db, p.id),
    operatorDecision: decision ? { decision: decision.decision, reason: decision.reason, txHash: decision.txHash } : undefined,
  });
  return { required: ev.required, optional: ev.optional, verdict: ev.verdict, outcome: ev.outcome === "pending" ? "pending" : ev.outcome };
}

// ---------- DTOs ----------

export function projectSummary(db: DbState, p: Project): ProjectSummary {
  const inv = db.investments.filter((i) => i.projectId === p.id);
  const builder = db.builders.find((b) => b.id === p.builderId);
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    status: p.status,
    siteAddress: p.siteAddress,
    principal: p.terms.principal,
    raised: fromMicro(sumMicro(inv.map((i) => i.amount))),
    investorCount: new Set(inv.map((i) => i.investor)).size,
    builderName: builder?.name ?? p.builderId,
    fundingDeadline: p.terms.fundingDeadline,
    verified: !["draft", "verifying", "rejected"].includes(p.status),
    interestRateBps: p.terms.interestRateBps,
    builderId: p.builderId,
    builderVerified: builder?.verified ?? false,
  };
}

/** Newest first; events with the same timestamp keep reverse submission order (stable). */
export const projectEvents = (db: DbState, projectId: string): ChainEvent[] =>
  db.chainEvents
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.projectId === projectId)
    .sort((a, b) => (a.e.at < b.e.at ? 1 : a.e.at > b.e.at ? -1 : b.i - a.i))
    .map(({ e }) => e);

export function projectDetail(db: DbState, p: Project, now: Date): ProjectDetail {
  const builder = db.builders.find((b) => b.id === p.builderId);
  if (!builder) throw new DomainError("NOT_FOUND", `Builder ${p.builderId} not found`);
  const verification = db.verifications.filter((v) => v.projectId === p.id).at(-1);
  const assigned = assignedInspectors(db, p.id);
  const checks: Record<string, ChecksStatus> = {};
  const audits: Record<string, InspectorAudit[]> = {};
  const attestations: Record<string, Attestation[]> = {};
  const evidence: Record<string, Evidence[]> = {};
  for (const m of p.milestones) {
    evidence[m.id] = roundEvidence(db, m.id, currentRound(db, m.id)).map(({ projectId: _p, milestoneId: _m, round: _r, ...e }) => e);
    checks[m.id] = checksFor(db, p, m);
    audits[m.id] = db.audits.filter((a) => a.milestoneId === m.id).map(stripRecord);
    attestations[m.id] = db.attestations.filter((a) => a.milestoneId === m.id).map(stripRecord);
  }
  let verificationOut: ProjectDetail["verification"];
  if (verification) {
    const { projectId: _p, verificationHash: _h, txHash: _t, ...rest } = verification;
    verificationOut = rest;
  }
  return {
    project: p,
    builder,
    verification: verificationOut,
    inspectors: db.inspectors.filter((i) => assigned.includes(i.address)),
    investments: db.investments.filter((i) => i.projectId === p.id),
    events: projectEvents(db, p.id),
    checks,
    audits,
    attestations,
    vault: vaultSnapshot(db, p, now),
    loan: loanSnapshot(db, p),
    evidence,
  };
}

export function inspectorQueue(db: DbState, address: XrplAddress): InspectorTask[] {
  const me = db.inspectors.find((i) => i.address === address);
  if (!me) throw new DomainError("NOT_FOUND", `Inspector ${address} not on the panel`);
  const tasks: InspectorTask[] = [];
  for (const p of db.projects) {
    const meta = metaOf(db, p.id);
    if (p.status === "verifying" && meta?.preVisitRequested && me.verified) {
      tasks.push({ projectId: p.id, projectName: p.name, sov: p.sov ?? [], evidence: [], needs: "pre_visit", siteGeo: p.siteGeo, priorAudits: [] });
      continue;
    }
    if (!meta?.assignment?.inspectors.includes(address)) continue;
    for (const m of p.milestones) {
      if (!m.escrow || isTerminal(m.status) || m.status === "expired") continue;
      const round = currentRound(db, m.id);
      const mine = roundAudits(db, m.id, round).some((a) => a.inspector === address);
      let needs: InspectorTask["needs"] = "none";
      if (m.status === "evidence_submitted" && !mine) needs = "audit";
      else if (m.status === "audited" && !mine && m.requiredInspectors > roundAudits(db, m.id, round).length) needs = "audit";
      else if (m.status === "failed" && round > 0) needs = "re_audit";
      tasks.push({
        projectId: p.id,
        projectName: p.name,
        milestone: m,
        sov: sovFor(p, m),
        evidence: roundEvidence(db, m.id, round).map((e) => stripEvidence(e)),
        needs,
        siteGeo: p.siteGeo,
        priorAudits: db.audits.filter((a) => a.milestoneId === m.id).map(stripRecord),
      });
    }
  }
  return tasks;
}

const stripEvidence = (e: EvidenceRecord): Evidence => {
  const { projectId: _p, milestoneId: _m, round: _r, ...rest } = e;
  return rest;
};
export { stripEvidence };

export function portfolio(db: DbState, investor: XrplAddress, now: Date): PortfolioPosition[] {
  const ids = [...new Set(db.investments.filter((i) => i.investor === investor).map((i) => i.projectId))];
  return ids.map((id) => {
    const p = getProjectOrThrow(db, id);
    const t = investorTotals(db, p, investor);
    return {
      projectId: p.id,
      projectName: p.name,
      shares: t.shares.toString(),
      value: fromMicro(t.value),
      phase: vaultPhase(p, now),
      redemptionDate: p.chain.redemptionDate ?? p.terms.fundingDeadline,
    };
  });
}
