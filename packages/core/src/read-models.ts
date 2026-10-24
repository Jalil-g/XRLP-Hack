// UI-facing read models. Plain JSON (money as Rlusd strings, no bigint) so route handlers can return them as-is.
import type {
  Attestation,
  Builder,
  ChainEvent,
  Evidence,
  Milestone,
  MilestoneTemplate,
  Project,
  ProjectStatus,
  Rlusd,
  Verdict,
  XrplAddress,
} from "@xrlp/shared";
import { fromMicro, pct, sumMicro, toMicro } from "./money.ts";
import { PLATFORM_SCOPE } from "./ports.ts";
import type { QuorumStatus } from "./quorum.ts";
import {
  currentRound,
  getBuilderOrThrow,
  getMetaOrThrow,
  getProjectOrThrow,
  investorPosition,
  latestVerdict,
  quorumFor,
  roundAttestations,
  templateFor,
  vaultPosition,
} from "./service.ts";
import type { DbState, InspectorProfile, Store } from "./store.ts";

export interface BuilderSummary {
  id: string;
  name: string;
  verified: boolean;
  riskTier: Builder["riskTier"];
  completedProjects: number;
  credentialTx?: string;
}

export interface ProjectCard {
  id: string;
  name: string;
  type: Project["type"];
  status: ProjectStatus;
  siteAddress: string;
  description: string;
  builder: BuilderSummary;
  principal: Rlusd;
  raised: Rlusd;
  fundedPct: number;
  investorCount: number;
  interestRateBps: number;
  termDays: number;
  fundingDeadline: string;
  milestones: { total: number; released: number; refunded: number; inReview: number };
  releasedAmount: Rlusd;
  /** First milestone not yet released/refunded. */
  nextMilestone?: { id: string; title: string; status: Milestone["status"]; amount: Rlusd };
}

export interface MilestoneView extends Milestone {
  template: MilestoneTemplate;
  round: number;
  /** Evidence of the current round. */
  evidence: Evidence[];
  /** Latest verdict (any round) — check `verdict.round === round` for freshness. */
  verdict?: Verdict & { round: number };
  verdictHistory: (Verdict & { round: number })[];
  /** Attestations for the current round. */
  attestations: Attestation[];
  quorum: QuorumStatus;
  /** Inspector holding this escrow's condition (supplies the fulfillment at release). */
  conditionHolder?: XrplAddress;
  /** Quorum met but escrow not finished yet -> waiting for the condition holder's fulfillment. */
  awaitingFulfillment: boolean;
  events: ChainEvent[];
}

export interface ActivityItem {
  at: string;
  type: "chain" | "evidence" | "verdict" | "attestation";
  milestoneId?: string;
  title: string;
  detail?: string;
  txHash?: string;
  explorerUrl?: string;
}

export interface ProjectDetail {
  project: Project;
  card: ProjectCard;
  builder: Builder;
  inspectors: InspectorProfile[];
  milestones: MilestoneView[];
  funding: { principal: Rlusd; raised: Rlusd; remaining: Rlusd; fundedPct: number; investors: { investor: XrplAddress; name?: string; amount: Rlusd }[] };
  vault: { deposits: Rlusd; available: Rlusd; loaned: Rlusd; owed: Rlusd; repaid: Rlusd; outstanding: Rlusd; withdrawn: Rlusd; totalValue: Rlusd };
  /** On-chain events, oldest first. */
  timeline: ChainEvent[];
  /** Chain events + off-chain steps (evidence, verdicts, attestations), oldest first. */
  activity: ActivityItem[];
  stalledReason?: string;
}

export interface PortfolioPosition {
  project: ProjectCard;
  deposited: Rlusd;
  withdrawn: Rlusd;
  sharePct: number;
  currentValue: Rlusd;
  withdrawable: Rlusd;
  events: ChainEvent[];
}

export interface InvestorPortfolio {
  address: XrplAddress;
  name?: string;
  kycCredentialTx?: string;
  positions: PortfolioPosition[];
  totals: { deposited: Rlusd; currentValue: Rlusd; withdrawable: Rlusd; withdrawn: Rlusd };
}

export interface InspectorQueueItem {
  project: ProjectCard;
  milestone: MilestoneView;
  /** This inspector holds the escrow condition -> must supply fulfillment to release. */
  holdsCondition: boolean;
}

export interface InspectorQueue {
  inspector?: InspectorProfile;
  /** Needs this inspector's signature (ai_reviewed / inspected, not yet signed this round). */
  pending: InspectorQueueItem[];
  /** Quorum met, waiting on this inspector's fulfillment to release. */
  awaitingRelease: InspectorQueueItem[];
  /** Projects (pre-escrow) where this inspector still has to supply escrow conditions. */
  conditionsNeeded: { project: ProjectCard; milestoneIds: string[] }[];
  history: (Attestation & { projectId: string })[];
}

export interface BuilderDashboard {
  builder: Builder;
  verification?: { ok: boolean; reasons: string[]; at: string };
  credentialEvent?: ChainEvent;
  projects: (ProjectCard & { milestoneViews: MilestoneView[]; nextAction?: string })[];
  totals: { released: Rlusd; locked: Rlusd; repaid: Rlusd; outstanding: Rlusd };
}

const byAt = <T extends { at: string }>(a: T, b: T) => a.at.localeCompare(b.at);

function builderSummary(b: Builder): BuilderSummary {
  return { id: b.id, name: b.name, verified: b.verified, riskTier: b.riskTier, completedProjects: b.completedProjects, credentialTx: b.credentialTx };
}

export function projectCard(db: DbState, p: Project): ProjectCard {
  const inv = db.investments.filter((i) => i.projectId === p.id);
  const raised = sumMicro(inv.map((i) => i.amount));
  const principal = toMicro(p.terms.principal);
  const next = p.milestones.find((m) => m.status !== "released" && m.status !== "refunded");
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    status: p.status,
    siteAddress: p.siteAddress,
    description: p.description,
    builder: builderSummary(getBuilderOrThrow(db, p.builderId)),
    principal: p.terms.principal,
    raised: fromMicro(raised),
    fundedPct: pct(raised, principal),
    investorCount: new Set(inv.map((i) => i.investor)).size,
    interestRateBps: p.terms.interestRateBps,
    termDays: p.terms.termDays,
    fundingDeadline: p.terms.fundingDeadline,
    milestones: {
      total: p.milestones.length,
      released: p.milestones.filter((m) => m.status === "released").length,
      refunded: p.milestones.filter((m) => m.status === "refunded").length,
      inReview: p.milestones.filter((m) => ["evidence_submitted", "ai_reviewed", "inspected"].includes(m.status)).length,
    },
    releasedAmount: fromMicro(sumMicro(p.milestones.filter((m) => m.status === "released").map((m) => m.amount))),
    nextMilestone: next && { id: next.id, title: next.title, status: next.status, amount: next.amount },
  };
}

export function milestoneView(db: DbState, p: Project, m: Milestone): MilestoneView {
  const round = currentRound(db, m.id);
  const strip = <T extends { projectId: string }>({ projectId: _p, ...rest }: T) => rest;
  const quorum = quorumFor(db, m);
  return {
    ...m,
    template: templateFor(p, m),
    round,
    evidence: db.evidence.filter((e) => e.milestoneId === m.id && e.round === round).map(({ projectId: _p, milestoneId: _m, round: _r, ...e }) => e),
    verdict: (() => {
      const v = latestVerdict(db, m.id);
      return v && strip(v);
    })(),
    verdictHistory: db.verdicts.filter((v) => v.milestoneId === m.id).map(strip),
    attestations: roundAttestations(db, m.id, round).map(({ projectId: _p, round: _r, ...a }) => a),
    quorum,
    conditionHolder: db.projectMeta.find((x) => x.projectId === p.id)?.conditions.find((c) => c.milestoneId === m.id)?.holder,
    awaitingFulfillment: m.status === "inspected" && quorum.met,
    events: db.chainEvents.filter((e) => e.milestoneId === m.id).sort(byAt),
  };
}

function activityFor(db: DbState, p: Project): ActivityItem[] {
  const title = (mid?: string) => p.milestones.find((m) => m.id === mid)?.title ?? "";
  const items: ActivityItem[] = [];
  for (const e of db.chainEvents.filter((e) => e.projectId === p.id))
    items.push({
      at: e.at,
      type: "chain",
      milestoneId: e.milestoneId,
      title: `${e.kind}${e.milestoneId ? ` · ${title(e.milestoneId)}` : ""}${e.amount ? ` · ${e.amount} RLUSD` : ""}`,
      txHash: e.txHash,
      explorerUrl: e.explorerUrl,
    });
  const rounds = new Map<string, { at: string; milestoneId: string; n: number; round: number }>();
  for (const e of db.evidence.filter((e) => e.projectId === p.id)) {
    const k = `${e.milestoneId}:${e.round}`;
    const r = rounds.get(k) ?? { at: e.uploadedAt, milestoneId: e.milestoneId, n: 0, round: e.round };
    r.n++;
    rounds.set(k, r);
  }
  for (const r of rounds.values())
    items.push({ at: r.at, type: "evidence", milestoneId: r.milestoneId, title: `Evidence submitted · ${title(r.milestoneId)}`, detail: `${r.n} files (round ${r.round})` });
  for (const v of db.verdicts.filter((v) => v.projectId === p.id))
    items.push({ at: v.createdAt, type: "verdict", milestoneId: v.milestoneId, title: `AI verdict: ${v.decision.toUpperCase()} · ${title(v.milestoneId)}`, detail: v.summary });
  for (const a of db.attestations.filter((a) => a.projectId === p.id))
    items.push({
      at: a.at,
      type: "attestation",
      milestoneId: a.milestoneId,
      title: `${a.role} ${a.decision} · ${title(a.milestoneId)}`,
      detail: a.notes || undefined,
      txHash: a.txHash,
    });
  return items.sort(byAt);
}

export function projectDetail(db: DbState, projectId: string): ProjectDetail {
  const p = getProjectOrThrow(db, projectId);
  const meta = getMetaOrThrow(db, projectId);
  const v = vaultPosition(db, p);
  const perInvestor = new Map<string, bigint>();
  for (const i of db.investments.filter((i) => i.projectId === p.id)) perInvestor.set(i.investor, (perInvestor.get(i.investor) ?? 0n) + toMicro(i.amount));
  const raised = v.deposits;
  const principal = toMicro(p.terms.principal);
  return {
    project: p,
    card: projectCard(db, p),
    builder: getBuilderOrThrow(db, p.builderId),
    inspectors: meta.inspectors.map((a) => db.inspectors.find((i) => i.address === a)).filter((x): x is InspectorProfile => !!x),
    milestones: p.milestones.map((m) => milestoneView(db, p, m)),
    funding: {
      principal: p.terms.principal,
      raised: fromMicro(raised),
      remaining: fromMicro(principal > raised ? principal - raised : 0n),
      fundedPct: pct(raised, principal),
      investors: [...perInvestor].map(([investor, amt]) => ({ investor, name: db.investors.find((x) => x.address === investor)?.name, amount: fromMicro(amt) })),
    },
    vault: {
      deposits: fromMicro(v.deposits),
      available: fromMicro(v.available),
      loaned: fromMicro(v.loaned),
      owed: fromMicro(v.owed),
      repaid: fromMicro(v.repaid),
      outstanding: fromMicro(v.outstanding),
      withdrawn: fromMicro(v.withdrawn),
      totalValue: fromMicro(v.totalValue),
    },
    timeline: db.chainEvents.filter((e) => e.projectId === p.id).sort(byAt),
    activity: activityFor(db, p),
    stalledReason: meta.stalledReason,
  };
}

export function investorPortfolio(db: DbState, address: string): InvestorPortfolio {
  const profile = db.investors.find((i) => i.address === address);
  const projectIds = [...new Set(db.investments.filter((i) => i.investor === address).map((i) => i.projectId))];
  const positions = projectIds.map((id) => {
    const p = getProjectOrThrow(db, id);
    const pos = investorPosition(db, p, address);
    return {
      project: projectCard(db, p),
      deposited: fromMicro(pos.deposited),
      withdrawn: fromMicro(pos.withdrawn),
      sharePct: Number(pos.sharePpm) / 10_000,
      currentValue: fromMicro(pos.currentValue),
      withdrawable: fromMicro(pos.withdrawable),
      events: db.chainEvents.filter((e) => e.projectId === id && e.actor === address).sort(byAt),
    };
  });
  const tot = (k: "deposited" | "currentValue" | "withdrawable" | "withdrawn") => fromMicro(sumMicro(positions.map((x) => x[k])));
  return {
    address,
    name: profile?.name,
    kycCredentialTx: profile?.kycCredentialTx,
    positions,
    totals: { deposited: tot("deposited"), currentValue: tot("currentValue"), withdrawable: tot("withdrawable"), withdrawn: tot("withdrawn") },
  };
}

export function inspectorQueue(db: DbState, address: string): InspectorQueue {
  const pending: InspectorQueueItem[] = [];
  const awaitingRelease: InspectorQueueItem[] = [];
  const conditionsNeeded: InspectorQueue["conditionsNeeded"] = [];
  for (const meta of db.projectMeta.filter((m) => m.inspectors.includes(address))) {
    const p = getProjectOrThrow(db, meta.projectId);
    const card = projectCard(db, p);
    if (["draft", "terms_locked", "funding", "funded"].includes(p.status) && meta.inspectors[0] === address) {
      const missing = p.milestones.filter((m) => !meta.conditions.some((c) => c.milestoneId === m.id)).map((m) => m.id);
      if (missing.length) conditionsNeeded.push({ project: card, milestoneIds: missing });
    }
    for (const m of p.milestones) {
      const view = milestoneView(db, p, m);
      const holdsCondition = view.conditionHolder === address;
      const signed = view.attestations.some((a) => a.role === "inspector" && a.signer === address);
      if ((m.status === "ai_reviewed" || m.status === "inspected") && !signed) pending.push({ project: card, milestone: view, holdsCondition });
      else if (view.awaitingFulfillment && holdsCondition) awaitingRelease.push({ project: card, milestone: view, holdsCondition });
    }
  }
  return {
    inspector: db.inspectors.find((i) => i.address === address),
    pending,
    awaitingRelease,
    conditionsNeeded,
    history: db.attestations.filter((a) => a.signer === address).map(({ round: _r, ...a }) => a).sort(byAt),
  };
}

function nextActionFor(p: Project, views: MilestoneView[]): string | undefined {
  switch (p.status) {
    case "draft":
      return "Waiting for platform to approve and lock terms";
    case "terms_locked":
      return "Waiting for platform to open funding";
    case "funding":
      return "Raising from investors";
    case "funded":
      return "Waiting for loan close + escrow creation";
    case "completed":
      return undefined;
  }
  const m = views.find((v) => v.status !== "released" && v.status !== "refunded");
  if (!m) return p.status === "stalled" ? "Project stalled — repay outstanding balance" : "Repay the loan";
  switch (m.status) {
    case "escrowed":
      return `Upload evidence for "${m.title}"`;
    case "rejected":
      return `"${m.title}" rejected — fix and resubmit evidence`;
    case "evidence_submitted":
      return `"${m.title}" awaiting AI review`;
    case "ai_reviewed":
    case "inspected":
      return m.awaitingFulfillment ? `"${m.title}" approved — awaiting release` : `"${m.title}" awaiting inspector sign-off`;
    case "expired":
      return `"${m.title}" expired — refund pending`;
    default:
      return undefined;
  }
}

export function builderDashboard(db: DbState, builderId: string): BuilderDashboard {
  const builder = getBuilderOrThrow(db, builderId);
  const review = db.builderReviews.filter((r) => r.builderId === builderId).at(-1);
  const projects = db.projects
    .filter((p) => p.builderId === builderId)
    .map((p) => {
      const milestoneViews = p.milestones.map((m) => milestoneView(db, p, m));
      return { ...projectCard(db, p), milestoneViews, nextAction: nextActionFor(p, milestoneViews) };
    });
  const mine = db.projects.filter((p) => p.builderId === builderId);
  const ms = mine.flatMap((p) => p.milestones);
  const builderRepaid = sumMicro(db.repayments.filter((r) => r.source === "builder" && mine.some((p) => p.id === r.projectId)).map((r) => r.amount));
  const outstanding = mine.reduce((a, p) => a + vaultPosition(db, p).outstanding, 0n);
  return {
    builder,
    verification: review && { ok: review.result.ok, reasons: review.result.reasons, at: review.at },
    credentialEvent: db.chainEvents.find((e) => e.projectId === PLATFORM_SCOPE && e.txHash === builder.credentialTx),
    projects,
    totals: {
      released: fromMicro(sumMicro(ms.filter((m) => m.status === "released").map((m) => m.amount))),
      locked: fromMicro(sumMicro(ms.filter((m) => m.escrow && !["released", "refunded"].includes(m.status)).map((m) => m.amount))),
      repaid: fromMicro(builderRepaid),
      outstanding: fromMicro(outstanding),
    },
  };
}

/** Async wrappers bound to a Store — this is what the web app calls. */
export class ReadModels {
  constructor(private readonly store: Store) {}
  getMarketplace(filter?: { status?: ProjectStatus[] }): Promise<ProjectCard[]> {
    return this.store.read((db) =>
      db.projects.filter((p) => !filter?.status || filter.status.includes(p.status)).map((p) => projectCard(db, p)),
    );
  }
  getProjectDetail(id: string): Promise<ProjectDetail> {
    return this.store.read((db) => projectDetail(db, id));
  }
  getInvestorPortfolio(address: string): Promise<InvestorPortfolio> {
    return this.store.read((db) => investorPortfolio(db, address));
  }
  getInspectorQueue(address: string): Promise<InspectorQueue> {
    return this.store.read((db) => inspectorQueue(db, address));
  }
  getBuilderDashboard(builderId: string): Promise<BuilderDashboard> {
    return this.store.read((db) => builderDashboard(db, builderId));
  }
  /** Directory for pickers / role switcher in the demo UI. */
  getDirectory() {
    return this.store.read((db) => ({
      builders: db.builders.map(builderSummary),
      investors: db.investors,
      inspectors: db.inspectors,
    }));
  }
  /** Platform-level events (credentials) for an admin view. */
  getPlatformEvents(): Promise<ChainEvent[]> {
    return this.store.read((db) => db.chainEvents.filter((e) => e.projectId === PLATFORM_SCOPE).sort(byAt));
  }
}
