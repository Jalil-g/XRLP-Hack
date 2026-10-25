// CoreService v2 — the workflow orchestrator (implements CoreApi, one method per route in docs/05-api.md §2).
// Every mutation: 1. per-project lock, 2. read + validate state (shared v2 state machines), 3. external effect
// (ledger / verifier / release service), 4. commit state + ChainEvents in one store write. If 3 throws, nothing is
// committed. Multi-tx steps (verdict -> release, cancel -> LoanPay) commit after each tx so a later failure never
// erases an on-chain fact; keeperTick() retries the remainder.
import { auditHash as canonicalAuditHash, verifyAuditBlob } from "@xrlp/attest-signer";
import {
  CreateProjectInput,
  explorerTxUrl,
  LedgerError,
  XrplAddress,
  type AttestMemo,
  type Builder,
  type ChainEvent,
  type ChainEventKind,
  type Evidence,
  type Inspector,
  type InspectorAudit,
  type InspectorTask,
  type Investment,
  type LedgerPort,
  type Milestone,
  type MilestoneStatusV2,
  type PortfolioPosition,
  type Project,
  type ProjectDetail,
  type ProjectStatus,
  type ProjectSummary,
  type ProjectVerification,
  type Rlusd,
  type TryStealResult,
  type TxResult,
  type Verdict,
  type VerifierPort,
  type InspectorAssignment,
} from "@xrlp/shared";
import { z } from "zod";
import type { AuditReportInput, CoreApi, DemoParty, EvidenceUpload, KeeperIssue, KeeperTickResult, ReleaseServicePort, StoredFile } from "./api-surface.ts";
import { DAY_MS, systemClock, type Clock } from "./clock.ts";
import { isCondition } from "./conditions.ts";
import { DomainError, ledgerErrorCode } from "./errors.ts";
import { canonicalJson, fakeAddress, newId, sha256Hex, slugify } from "./ids.ts";
import { redemptionShares, fromMicro, maxMicro, sumMicro, toMicro, totalOwedMicro } from "./money.ts";
import { PLATFORM_SCOPE } from "./ports.ts";
import {
  assignedInspectors,
  currentRound,
  getMilestoneOrThrow,
  getProjectOrThrow,
  inspectorQueue,
  investorTotals,
  latestVerdict,
  metaOf,
  portfolio,
  projectDetail,
  projectEvents,
  projectSummary,
  roundAudits,
  roundEvidence,
  sovFor,
  stripEvidence,
  vaultPhase,
} from "./read-models.ts";
import { evaluateRelease, type OperatorDecision, type ReleaseEvaluation } from "./release-policy.ts";
import {
  assertMilestoneStatus,
  assertMilestoneTransition,
  assertProjectStatus,
  assertProjectTransition,
  canMilestoneTransition,
  canProjectTransition,
  isLocked,
  isTerminal,
} from "./state-machine.ts";
import type { AuditRecord, DbState, ProjectMeta, Store } from "./store.ts";

// ---------- non-route inputs (seed / admin) ----------

export const RegisterBuilderInput = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  address: XrplAddress,
  licenseNumber: z.string(),
  insurancePolicy: z.string(),
  completedProjects: z.number().int().nonnegative().default(0),
  riskTier: z.enum(["low", "medium", "high"]).default("medium"),
});
export type RegisterBuilderInput = z.input<typeof RegisterBuilderInput>;

export const RegisterInspectorInput = z.object({
  address: XrplAddress,
  name: z.string().min(1),
  licenseNumber: z.string().min(1),
  trades: z.array(z.string()).default([]),
  homeGeo: z.object({ lat: z.number(), lng: z.number() }).optional(),
});
export type RegisterInspectorInput = z.input<typeof RegisterInspectorInput>;

/** Evidence upload, optionally with metadata the HTTP layer / verifier extracted (EXIF, pHash, invoice total). */
export type EvidenceFile = EvidenceUpload & { meta?: Evidence["meta"] };

function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new DomainError("VALIDATION", r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "), r.error.issues);
  }
  return r.data;
}

// ---------- options ----------

export interface CoreServiceOptions {
  store: Store;
  ledger: LedgerPort;
  verifier: VerifierPort;
  release: ReleaseServicePort;
  clock?: Clock;
  platformAddress?: XrplAddress;
  aiAgentAddress?: XrplAddress;
  releaseServiceAddress?: XrplAddress;
  /** Vault RedemptionDate = SubscriptionDate + termDays + this buffer. Default 7. */
  redemptionBufferDays?: number;
  /** First-loss cover posted at lock-terms, bps of principal. Default 1000 (10%). */
  coverBps?: number;
  /** Escrow CancelAfter per milestone. Default: milestone i of n at (i+1)/n of termDays after close, capped before maturity. */
  cancelAfterFor?: (project: Project, milestone: Milestone, closeAt: Date) => Date;
  /** Route 21: rebuild demo data (wired by the factory; fake mode only). */
  seed?: (name: "maple-st") => Promise<void>;
  /** Route 21: wipe ledger-side demo state (fake ledger). */
  resetLedger?: () => void;
}

export const verificationFeeFor = (principal: Rlusd): Rlusd => fromMicro(maxMicro(250_000_000n, (toMicro(principal) * 20n) / 10_000n));

class KeyedMutex {
  private tails = new Map<string, Promise<unknown>>();
  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(task, task);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await next;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

const OPEN_PROJECT: readonly ProjectStatus[] = ["escrowed", "repaying", "stalled"];
/** Investor.kycCredentialTx when the ledger already held an accepted KYC_INVESTOR (no tx this time). */
export const KYC_ALREADY_ON_LEDGER = "already-accepted";

// ---------- service ----------

export class CoreService implements CoreApi {
  readonly store: Store;
  readonly ledger: LedgerPort;
  readonly verifier: VerifierPort;
  readonly release: ReleaseServicePort;
  readonly clock: Clock;
  readonly platformAddress: XrplAddress;
  readonly aiAgentAddress: XrplAddress;
  readonly releaseServiceAddress: XrplAddress;
  private readonly opts: CoreServiceOptions;
  private readonly locks = new KeyedMutex();

  constructor(opts: CoreServiceOptions) {
    this.opts = opts;
    this.store = opts.store;
    this.ledger = opts.ledger;
    this.verifier = opts.verifier;
    this.release = opts.release;
    this.clock = opts.clock ?? systemClock;
    this.platformAddress = opts.platformAddress ?? fakeAddress("platform");
    this.aiAgentAddress = opts.aiAgentAddress ?? fakeAddress("ai-agent");
    this.releaseServiceAddress = opts.releaseServiceAddress ?? fakeAddress("release-service");
  }

  // ---------- plumbing ----------

  private now(): Date {
    return this.clock.now();
  }
  private nowIso(): string {
    return this.now().toISOString();
  }

  private async onLedger<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof DomainError) throw e;
      if (e instanceof LedgerError) {
        throw new DomainError(ledgerErrorCode(e), `${what}: ${e.message}`, e, { txResult: e.txResult, txHash: e.txHash });
      }
      throw new DomainError("LEDGER_ERROR", `${what} failed: ${(e as Error).message}`, e);
    }
  }
  private async onVerifier<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof DomainError) throw e;
      throw new DomainError("VERIFIER_ERROR", `${what} failed: ${(e as Error).message}`, e);
    }
  }

  /** TxResult -> ChainEvent with project context. Txs without a kind (e.g. SPV account setup) are skipped. */
  private ev(
    tx: TxResult,
    ctx: { projectId: string; milestoneId?: string; kind?: ChainEventKind; actor?: XrplAddress; amount?: Rlusd },
  ): ChainEvent | undefined {
    const kind = ctx.kind ?? tx.kind;
    if (!kind) return undefined;
    return {
      projectId: ctx.projectId,
      ...(ctx.milestoneId ? { milestoneId: ctx.milestoneId } : {}),
      kind,
      txHash: tx.hash,
      explorerUrl: tx.explorerUrl,
      ...(tx.result && tx.result !== "tesSUCCESS" ? { result: tx.result } : {}),
      ...(ctx.actor ? { actor: ctx.actor } : {}),
      ...(ctx.amount ? { amount: ctx.amount } : {}),
      at: tx.at ?? this.nowIso(),
    };
  }
  private evs(txs: TxResult[], ctx: Parameters<CoreService["ev"]>[1]): ChainEvent[] {
    return txs.map((t) => this.ev(t, ctx)).filter((e): e is ChainEvent => !!e);
  }

  private read<T>(fn: (db: DbState) => T): Promise<T> {
    return this.store.read(fn);
  }

  private requirePlatform(actor: string, action: string): void {
    if (actor !== this.platformAddress) throw new DomainError("FORBIDDEN", `${action} must be done by the platform (${this.platformAddress})`);
  }

  private setProjectStatus(db: DbState, p: Project, to: ProjectStatus): void {
    if (p.status === to) return;
    assertProjectTransition(p.id, p.status, to);
    p.status = to;
  }
  private setMilestoneStatus(m: Milestone, to: MilestoneStatusV2): void {
    if (m.status === to) return;
    assertMilestoneTransition(m.id, m.status, to);
    m.status = to;
  }
  private projectIn(db: DbState, id: string): Project {
    return getProjectOrThrow(db, id);
  }
  private meta(db: DbState, id: string): ProjectMeta {
    const m = metaOf(db, id);
    if (!m) throw new DomainError("NOT_FOUND", `Project meta ${id} not found`);
    return m;
  }
  private builderOf(db: DbState, p: Project): Builder {
    const b = db.builders.find((x) => x.id === p.builderId);
    if (!b) throw new DomainError("NOT_FOUND", `Builder ${p.builderId} not found`);
    return b;
  }
  private attest(signer: "aiAgent" | "platform" | "releaseService", spv: XrplAddress, memo: AttestMemo, what: string): Promise<TxResult> {
    return this.onLedger(what, () => this.ledger.attest({ signer, spv, memo }));
  }

  // ---------- participants (seed / admin; not HTTP routes) ----------

  async registerBuilder(input: RegisterBuilderInput): Promise<Builder> {
    const d = parse(RegisterBuilderInput, input);
    const id = d.id ?? `bld-${slugify(d.name)}`;
    return this.store.write((db) => {
      if (db.builders.some((b) => b.id === id || b.address === d.address)) throw new DomainError("CONFLICT", `Builder ${id} already registered`);
      const b: Builder = {
        id,
        name: d.name,
        address: d.address,
        licenseNumber: d.licenseNumber,
        insurancePolicy: d.insurancePolicy,
        completedProjects: d.completedProjects,
        riskTier: d.riskTier,
        verified: false,
      };
      db.builders.push(b);
      return b;
    });
  }

  /** Adds a licensed inspector to the verified panel and issues VERIFIED_INSPECTOR. */
  async registerInspector(input: RegisterInspectorInput): Promise<{ inspector: Inspector; events: ChainEvent[] }> {
    const d = parse(RegisterInspectorInput, input);
    const exists = await this.read((db) => db.inspectors.some((i) => i.address === d.address));
    if (exists) throw new DomainError("CONFLICT", `Inspector ${d.address} already on the panel`);
    const txs = await this.onLedger("issue VERIFIED_INSPECTOR", () => this.ledger.issueCredential({ subject: d.address, type: "VERIFIED_INSPECTOR" }));
    const events = this.evs(txs, { projectId: PLATFORM_SCOPE, actor: d.address });
    return this.store.write((db) => {
      const inspector: Inspector = { ...d, verified: true, credentialTx: txs[0]?.hash };
      db.inspectors.push(inspector);
      db.chainEvents.push(...events);
      return { inspector, events };
    });
  }

  // ---------- route 19 ----------

  async kycInvestor(address: XrplAddress, name?: string): Promise<{ events: ChainEvent[] }> {
    const addr = parse(XrplAddress, address);
    const done = await this.read((db) => db.investors.find((i) => i.address === addr)?.kycCredentialTx);
    if (done) return { events: [] };
    const txs = await this.onLedger("issue KYC_INVESTOR", () => this.ledger.issueCredential({ subject: addr, type: "KYC_INVESTOR" }));
    const events = this.evs(txs, { projectId: PLATFORM_SCOPE, actor: addr });
    return this.store.write((db) => {
      let inv = db.investors.find((i) => i.address === addr);
      if (!inv) db.investors.push((inv = { address: addr, name: name ?? `Investor ${addr.slice(0, 6)}`, createdAt: this.nowIso() }));
      // [] = already issued + accepted on-ledger (devnet adapter: nothing submitted); still KYC'd.
      inv.kycCredentialTx = txs[0]?.hash ?? inv.kycCredentialTx ?? KYC_ALREADY_ON_LEDGER;
      db.chainEvents.push(...events);
      return { events };
    });
  }

  // ---------- routes 1, 2, 16, 17, 18, 20 (reads) ----------

  listProjects(q: { status?: ProjectStatus } = {}): Promise<ProjectSummary[]> {
    return this.read((db) => db.projects.filter((p) => !q.status || p.status === q.status).map((p) => projectSummary(db, p)));
  }
  async getProject(id: string): Promise<ProjectDetail> {
    const d = await this.read((db) => projectDetail(db, getProjectOrThrow(db, id), this.now()));
    // Queued checks before the first run: the policy's required check ids.
    for (const m of d.project.milestones) {
      const c = d.checks[m.id];
      if (c && c.outcome === "pending" && c.required.length === 0) c.suite = [...this.verifier.policyFor(d.project, m).requiredChecks];
    }
    const balances = await this.liveBalances(d.project.chain.spv, d.builder.address);
    return balances ? { ...d, balances } : d;
  }

  /** SPV + builder RLUSD, best effort: a slow or failing ledger read never breaks the project page. */
  private async liveBalances(spv: XrplAddress | undefined, builder: XrplAddress): Promise<ProjectDetail["balances"]> {
    if (!spv) return undefined;
    let timer: Parameters<typeof clearTimeout>[0];
    const timeout = new Promise<undefined>((r) => (timer = setTimeout(r, 2000)));
    const read = Promise.all([this.ledger.getBalance(spv, "RLUSD"), this.ledger.getBalance(builder, "RLUSD")]).then(
      ([s, b]) => ({ spv: s, builder: b }),
      () => undefined,
    );
    try {
      return await Promise.race([read, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }
  listEvents(id: string): Promise<ChainEvent[]> {
    return this.read((db) => {
      getProjectOrThrow(db, id);
      return projectEvents(db, id);
    });
  }
  listDemoParties(): Promise<DemoParty[]> {
    return this.read((db) => [
      { address: this.platformAddress, name: "Platform", role: "platform" },
      { address: this.aiAgentAddress, name: "AI verifier", role: "ai_agent" },
      { address: this.releaseServiceAddress, name: "Release service", role: "release_service" },
      ...db.investors.map((i) => ({ address: i.address, name: i.name, role: "investor" as const, kyc: !!i.kycCredentialTx })),
      ...db.builders.map((b) => ({ address: b.address, name: b.name, role: "builder" as const })),
      ...db.inspectors.map((i) => ({ address: i.address, name: i.name, role: "inspector" as const })),
      ...db.projects.flatMap((p) => p.chain.spv ? [{ address: p.chain.spv, name: p.name, role: "spv" as const }] : []),
    ]);
  }
  listBuilders(): Promise<Builder[]> {
    return this.read((db) => db.builders);
  }
  getBuilder(id: string): Promise<Builder> {
    return this.read((db) => {
      const b = db.builders.find((x) => x.id === id);
      if (!b) throw new DomainError("NOT_FOUND", `Builder ${id} not found`);
      return b;
    });
  }
  listInspectors(): Promise<Inspector[]> {
    return this.read((db) => db.inspectors);
  }
  inspectorQueue(address: XrplAddress): Promise<InspectorTask[]> {
    return this.read((db) => inspectorQueue(db, address));
  }
  portfolio(investor: XrplAddress): Promise<PortfolioPosition[]> {
    return this.read((db) => portfolio(db, investor, this.now()));
  }

  // ---------- route 3 ----------

  async createProject(input: CreateProjectInput): Promise<Project> {
    const d = parse(CreateProjectInput, input);
    const codes = d.sov.map((l) => l.code);
    if (new Set(codes).size !== codes.length) throw new DomainError("VALIDATION", "Schedule of Values codes must be unique");
    const sovTotal = sumMicro(d.sov.map((l) => l.amount));
    if (sovTotal !== toMicro(d.terms.principal))
      throw new DomainError("VALIDATION", `Schedule of Values totals ${fromMicro(sovTotal)} but principal is ${d.terms.principal}`);
    return this.store.write((db) => {
      if (!db.builders.some((b) => b.id === d.builderId)) throw new DomainError("NOT_FOUND", `Builder ${d.builderId} not found`);
      const base = slugify(d.name) || "project";
      let id = base;
      for (let n = 2; db.projects.some((p) => p.id === id); n++) id = `${base}-${n}`;
      const project: Project = {
        id,
        name: d.name,
        type: d.type,
        builderId: d.builderId,
        siteAddress: d.siteAddress,
        siteGeo: d.siteGeo,
        description: d.description,
        terms: d.terms,
        status: "draft",
        sov: d.sov,
        milestones: d.sov.map((l, i) => ({
          id: `${id}-m${i + 1}-${slugify(l.code)}`,
          index: i,
          templateKey: l.code,
          title: l.title,
          amount: l.amount,
          requiredInspectors: 1,
          status: "pending",
          sovCodes: [l.code],
        })),
        chain: {},
      };
      db.projects.push(project);
      db.projectMeta.push({ projectId: id, documents: d.documents, createdAt: this.nowIso() });
      return project;
    });
  }

  // ---------- route 4 ----------

  async payVerificationFee(id: string, body: { builder: XrplAddress }): Promise<{ project: Project; events: ChainEvent[] }> {
    return this.locks.run(id, async () => {
      const { p, b } = await this.read((db) => {
        const p = this.projectIn(db, id);
        return { p, b: this.builderOf(db, p) };
      });
      if (body.builder !== b.address) throw new DomainError("FORBIDDEN", "Only the project's builder pays its verification fee");
      assertProjectTransition(id, p.status, "verifying");
      const amount = verificationFeeFor(p.terms.principal);
      const tx = await this.onLedger("verification fee", () => this.ledger.payVerificationFee({ builder: b.address, amount }));
      const events = this.evs([tx], { projectId: id, kind: "verification_fee_paid", actor: b.address, amount });
      return this.store.write((db) => {
        const p = this.projectIn(db, id);
        this.setProjectStatus(db, p, "verifying");
        this.meta(db, id).verificationFee = { amount, tx: tx.hash, at: tx.at ?? this.nowIso() };
        db.chainEvents.push(...events);
        return { project: p, events };
      });
    });
  }

  // ---------- route 5 ----------

  async verifyProject(id: string): Promise<{ verification: ProjectVerification; project: Project; events: ChainEvent[] }> {
    return this.locks.run(id, async () => {
      const { p, b, meta } = await this.read((db) => {
        const p = this.projectIn(db, id);
        return { p, b: this.builderOf(db, p), meta: this.meta(db, id) };
      });
      assertProjectStatus(id, p.status, ["verifying"], "verify project");
      const verification = await this.onVerifier("project verification", () =>
        this.verifier.verifyProject({ project: p, builder: b, sov: p.sov ?? [], documents: meta.documents }),
      );
      const verificationHash = sha256Hex(canonicalJson(verification));
      const attTx = await this.attest(
        "aiAgent",
        this.platformAddress,
        { v: 1, kind: "verdict", milestoneId: `${id}:project`, hash: verificationHash, decision: verification.decision },
        "attest project verification",
      );
      const events = this.evs([attTx], { projectId: id, kind: "project_verified", actor: this.aiAgentAddress });
      let credTxs: TxResult[] = [];
      if (verification.decision === "pass" && !b.verified) {
        credTxs = await this.onLedger("issue VERIFIED_BUILDER", () => this.ledger.issueCredential({ subject: b.address, type: "VERIFIED_BUILDER" }));
        events.push(...this.evs(credTxs, { projectId: id, actor: b.address }));
      }
      return this.store.write((db) => {
        const p = this.projectIn(db, id);
        const meta = this.meta(db, id);
        db.verifications.push({ ...verification, projectId: id, verificationHash, txHash: attTx.hash });
        if (verification.decision === "pass") {
          this.setProjectStatus(db, p, "verified");
          meta.verifiedAt = this.nowIso();
          meta.preVisitRequested = false;
          const builder = this.builderOf(db, p);
          builder.riskTier = verification.riskTier;
          if (!builder.verified) {
            builder.verified = true;
            builder.credentialTx = credTxs[0]?.hash;
          }
        } else if (verification.decision === "fail") {
          this.setProjectStatus(db, p, "rejected");
        } else {
          meta.preVisitRequested = true; // inspector pre-construction visit (route 18 needs: "pre_visit")
        }
        db.chainEvents.push(...events);
        return { verification, project: p, events };
      });
    });
  }

  // ---------- route 6 ----------

  async lockTermsAndOpenFunding(id: string, body: { actor: XrplAddress }): Promise<{ project: Project; assignment: InspectorAssignment; events: ChainEvent[] }> {
    this.requirePlatform(body.actor, "Lock terms");
    return this.locks.run(id, async () => {
      const { p, b, panel } = await this.read((db) => {
        const p = this.projectIn(db, id);
        return { p, b: this.builderOf(db, p), panel: db.inspectors };
      });
      assertProjectTransition(id, p.status, "terms_locked");
      const subscriptionDate = new Date(p.terms.fundingDeadline);
      if (subscriptionDate <= this.now()) throw new DomainError("VALIDATION", `Funding deadline ${p.terms.fundingDeadline} is not in the future`);
      const policies = p.milestones.map((m) => this.verifier.policyFor(p, m));
      const count = Math.max(...policies.map((x) => x.requiredAudits)) as 1 | 2;
      const assignment = await this.onVerifier("inspector assignment", () => this.verifier.assignInspector({ project: p, panel, count }));
      if (assignment.inspectors.length < count) throw new DomainError("CONFLICT", `Need ${count} verified inspector(s) on the panel, got ${assignment.inspectors.length}`);
      const assignTx = await this.attest(
        "platform",
        this.platformAddress,
        { v: 1, kind: "decision", milestoneId: `${id}:assignment`, hash: sha256Hex(canonicalJson(assignment)), decision: "assign", reason: assignment.inspectors.join(",") },
        "attest inspector assignment",
      );
      const redemptionDate = new Date(subscriptionDate.getTime() + (p.terms.termDays + (this.opts.redemptionBufferDays ?? 7)) * DAY_MS);
      const coverDeposit = fromMicro((toMicro(p.terms.principal) * BigInt(this.opts.coverBps ?? 1000)) / 10_000n);
      const setup = await this.onLedger("project setup", () =>
        this.ledger.setupProjectOnChain({
          project: p,
          builder: b,
          inspectors: assignment.inspectors,
          subscriptionDate: subscriptionDate.toISOString(),
          redemptionDate: redemptionDate.toISOString(),
          coverDeposit,
        }),
      );
      const events = [
        ...this.evs([assignTx], { projectId: id, kind: "inspector_assigned", actor: this.platformAddress }),
        ...setup.txs
          .map((t) => this.ev(t, { projectId: id, actor: this.platformAddress, ...(t.kind === "cover_deposited" ? { amount: coverDeposit } : {}) }))
          .filter((e): e is ChainEvent => !!e),
      ];
      return this.store.write((db) => {
        const p = this.projectIn(db, id);
        this.setProjectStatus(db, p, "terms_locked");
        this.setProjectStatus(db, p, "funding");
        p.milestones.forEach((m, i) => (m.requiredInspectors = policies[i]!.requiredAudits));
        p.chain = {
          ...p.chain,
          spv: setup.spv,
          vaultId: setup.vaultId,
          loanBrokerId: setup.loanBrokerId,
          shareMptIssuanceId: setup.shareMptIssuanceId,
          subscriptionDate: setup.subscriptionDate,
          redemptionDate: setup.redemptionDate,
        };
        const meta = this.meta(db, id);
        meta.assignment = { ...assignment, at: this.nowIso(), tx: assignTx.hash };
        meta.fundingOpenedAt = this.nowIso();
        db.chainEvents.push(...events);
        return { project: p, assignment, events };
      });
    });
  }

  // ---------- route 7 ----------

  async invest(id: string, body: { investor: XrplAddress; amount: Rlusd }): Promise<{ investment: Investment; events: ChainEvent[] }> {
    const amount = fromMicro(toMicro(body.amount));
    if (toMicro(amount) <= 0n) throw new DomainError("VALIDATION", "Investment must be positive");
    return this.locks.run(id, async () => {
      const { p, kyc, raised } = await this.read((db) => {
        const p = this.projectIn(db, id);
        return {
          p,
          kyc: !!db.investors.find((i) => i.address === body.investor)?.kycCredentialTx,
          raised: sumMicro(db.investments.filter((i) => i.projectId === id).map((i) => i.amount)),
        };
      });
      assertProjectStatus(id, p.status, ["funding"], "invest");
      if (!kyc) throw new DomainError("FORBIDDEN", `Investor ${body.investor} has no KYC_INVESTOR credential (route 19)`);
      if (vaultPhase(p, this.now()) !== "subscription") throw new DomainError("ILLEGAL_TRANSITION", `Subscription closed at ${p.chain.subscriptionDate}`);
      const left = toMicro(p.terms.principal) - raised;
      if (toMicro(amount) > left) throw new DomainError("CONFLICT", `Only ${fromMicro(left)} RLUSD left to raise`);
      const tx = await this.onLedger("vault deposit", () => this.ledger.deposit({ project: p, investor: body.investor, amount }));
      const events = this.evs([tx], { projectId: id, kind: "vault_deposit", actor: body.investor, amount });
      return this.store.write((db) => {
        const p = this.projectIn(db, id);
        const investment: Investment = { projectId: id, investor: body.investor, amount, tx: tx.hash, at: tx.at ?? this.nowIso() };
        db.investments.push(investment);
        const total = sumMicro(db.investments.filter((i) => i.projectId === id).map((i) => i.amount));
        if (total === toMicro(p.terms.principal)) this.setProjectStatus(db, p, "funded"); // never auto-closes
        db.chainEvents.push(...events);
        return { investment, events };
      });
    });
  }

  // ---------- route 8 ----------

  private cancelAfterFor(p: Project, m: Milestone, closeAt: Date): Date {
    const d = this.opts.cancelAfterFor
      ? this.opts.cancelAfterFor(p, m, closeAt)
      : new Date(closeAt.getTime() + Math.round(((m.index + 1) / p.milestones.length) * p.terms.termDays * DAY_MS));
    const cap = new Date(new Date(p.chain.redemptionDate!).getTime() - 3_600_000);
    return d < cap ? d : cap;
  }

  async closeLoan(id: string, body: { actor: XrplAddress }): Promise<{ project: Project; events: ChainEvent[] }> {
    this.requirePlatform(body.actor, "Close the loan");
    return this.locks.run(id, async () => {
      const { p, b } = await this.read((db) => {
        const p = this.projectIn(db, id);
        return { p, b: this.builderOf(db, p) };
      });
      if (p.status === "funding") throw new DomainError("ILLEGAL_TRANSITION", `Project ${id} is not fully funded`);
      assertProjectTransition(id, p.status, "escrowed");
      if (vaultPhase(p, this.now()) === "subscription")
        throw new DomainError("TOO_SOON", `Loan can close only after SubscriptionDate ${p.chain.subscriptionDate}`, undefined, { txResult: "tecTOO_SOON" });
      const conditions = await this.release.conditionsForClose(p);
      if (conditions.length !== p.milestones.length || conditions.some((c) => !isCondition(c)) || new Set(conditions).size !== conditions.length)
        throw new DomainError("CONFLICT", "Release service returned invalid or duplicate escrow conditions");
      const closeAt = this.now();
      const cancelAfters = p.milestones.map((m) => this.cancelAfterFor(p, m, closeAt).toISOString());
      const res = await this.onLedger("loan close", () => this.ledger.closeLoanAndCreateEscrows({ project: p, builder: b, conditions, cancelAfters }));
      const events: ChainEvent[] = [];
      for (const t of res.txs) {
        const esc = t.kind === "escrow_created" ? res.escrows.find((e) => e.createTx === t.hash) : undefined;
        const m = esc ? p.milestones.find((x) => x.id === esc.milestoneId) : undefined;
        const e = this.ev(t, {
          projectId: id,
          milestoneId: m?.id,
          actor: p.chain.spv,
          amount: m ? m.amount : t.kind === "loan_set" ? p.terms.principal : undefined,
        });
        if (e) events.push(e);
      }
      return this.store.write((db) => {
        const p = this.projectIn(db, id);
        for (const esc of res.escrows) {
          const m = getMilestoneOrThrow(p, esc.milestoneId);
          const created = res.txs.find((t) => t.hash === esc.createTx);
          m.escrow = {
            owner: esc.owner,
            offerSequence: esc.offerSequence,
            condition: esc.condition,
            createTx: esc.createTx,
            createdAt: created?.at ?? this.nowIso(),
          };
          m.cancelAfter = esc.cancelAfter;
          this.setMilestoneStatus(m, "escrowed");
        }
        p.chain.loanId = res.loanId;
        this.setProjectStatus(db, p, "escrowed");
        this.meta(db, id).escrowedAt = this.nowIso();
        db.chainEvents.push(...events);
        return { project: p, events };
      });
    });
  }

  // ---------- route 9 ----------

  async submitEvidence(id: string, mid: string, files: EvidenceFile[]): Promise<{ milestone: Milestone; evidence: Evidence[] }> {
    if (!files.length) throw new DomainError("VALIDATION", "No evidence files");
    return this.locks.run(id, () =>
      this.store.write((db) => {
        const p = this.projectIn(db, id);
        assertProjectStatus(id, p.status, OPEN_PROJECT, "submit evidence");
        const m = getMilestoneOrThrow(p, mid);
        let round = currentRound(db, mid);
        if (m.status === "escrowed" || m.status === "failed") {
          this.setMilestoneStatus(m, "evidence_submitted");
          round += 1;
        } else assertMilestoneStatus(mid, m.status, ["evidence_submitted"], "submit evidence");
        const at = this.nowIso();
        const evidence: Evidence[] = files.map((f) => ({
          id: newId("ev"),
          kind: f.kind,
          filename: f.filename,
          mimeType: f.mimeType,
          uri: f.uri,
          sha256: f.sha256,
          meta: f.meta ?? {},
          uploadedAt: at,
        }));
        db.evidence.push(...evidence.map((e) => ({ ...e, projectId: id, milestoneId: mid, round })));
        return { milestone: m, evidence };
      }),
    );
  }

  // ---------- route 10 ----------

  async submitAudit(
    id: string,
    mid: string,
    body: { report: AuditReportInput; photos: StoredFile[]; signedTxBlob?: string },
  ): Promise<{ milestone: Milestone; audit: InspectorAudit; events: ChainEvent[] }> {
    return this.locks.run(id, async () => {
      const { p, m, round, assigned, bundleHash } = await this.read((db) => {
        const p = this.projectIn(db, id);
        const round = currentRound(db, mid);
        return {
          p, m: getMilestoneOrThrow(p, mid), round, assigned: assignedInspectors(db, id),
          bundleHash: sha256Hex(roundEvidence(db, mid, round).map((e) => e.sha256).sort().join("\n")),
        };
      });
      const inspector = body.report.inspector;
      if (!assigned.includes(inspector)) throw new DomainError("FORBIDDEN", `${inspector} is not an assigned inspector for ${id}`);
      assertProjectStatus(id, p.status, OPEN_PROJECT, "submit audit");
      if (round === 0) throw new DomainError("ILLEGAL_TRANSITION", `No builder evidence for ${mid} yet`);
      if (m.status !== "audited") assertMilestoneTransition(mid, m.status, "audited");
      if (body.report.evidenceBundleHash.toLowerCase() !== bundleHash)
        throw new DomainError("VALIDATION", "Audit must cover the current builder evidence bundle");
      const at = this.nowIso();
      const photos: Evidence[] = body.photos.map((f) => ({
        id: newId("ap"),
        kind: "photo",
        filename: f.filename,
        mimeType: f.mimeType,
        uri: f.uri,
        sha256: f.sha256,
        meta: {},
        uploadedAt: at,
      }));
      const unsigned: InspectorAudit = {
        milestoneId: mid,
        inspector,
        evidenceBundleHash: body.report.evidenceBundleHash,
        checklist: body.report.checklist,
        photos,
        notes: body.report.notes,
        at,
      };
      const auditHash = await canonicalAuditHash(unsigned);
      if (body.signedTxBlob) {
        try {
          if (!p.chain.spv) throw new Error("project SPV missing");
          await verifyAuditBlob(body.signedTxBlob, unsigned, p.chain.spv);
        } catch {
          // Never echo the blob, signatures or parser contents in an API error.
          throw new DomainError("VALIDATION", "Signed audit does not match the assigned inspector, project, report and uploaded photos");
        }
      } else if (this.ledger.mode !== "fake") {
        throw new DomainError("FORBIDDEN", "A signed inspector audit is required outside fake demo mode");
      }
      // Inspector-app-signed attestation when provided; otherwise core submits it with the demo key (disclosed).
      const tx = body.signedTxBlob
        ? await this.onLedger("submit signed audit", () => this.ledger.submitSignedBlob(body.signedTxBlob!))
        : await this.attest(
            "platform",
            p.chain.spv!,
            { v: 1, kind: "audit", milestoneId: mid, hash: auditHash, reason: `signed-for ${inspector}` },
            "attest audit",
          );
      const audit: InspectorAudit = { ...unsigned, txHash: tx.hash };
      const events = this.evs([tx], { projectId: id, milestoneId: mid, kind: "audit_attested", actor: inspector });
      const allDone = audit.checklist.every((c) => c.status === "done");
      return this.store.write((db) => {
        const p = this.projectIn(db, id);
        const m = getMilestoneOrThrow(p, mid);
        if (m.status !== "audited") this.setMilestoneStatus(m, "audited");
        const rec: AuditRecord = { ...audit, projectId: id, round };
        db.audits.push(rec);
        db.attestations.push({ milestoneId: mid, role: "inspector", signer: inspector, decision: allDone ? "approve" : "reject", notes: audit.notes, txHash: tx.hash, at, projectId: id, round, kind: "audit", hash: auditHash });
        db.chainEvents.push(...events);
        return { milestone: m, audit, events };
      });
    });
  }

  // ---------- route 11 ----------

  async runChecks(id: string, mid: string): Promise<{ verdict: Verdict; release?: { txHash: string; explorerUrl: string }; events: ChainEvent[] }> {
    return this.locks.run(id, async () => {
      const ctx = await this.read((db) => {
        const p = this.projectIn(db, id);
        const m = getMilestoneOrThrow(p, mid);
        const round = currentRound(db, mid);
        return {
          p,
          m,
          round,
          b: this.builderOf(db, p),
          evidence: roundEvidence(db, mid, round).map(stripEvidence),
          audits: roundAudits(db, mid, round),
          // ALL projects' evidence except this milestone's own submissions (cross-project duplicate detection)
          prior: db.evidence.filter((e) => e.milestoneId !== mid),
          assigned: assignedInspectors(db, id),
        };
      });
      const { p, m, round } = ctx;
      assertProjectStatus(id, p.status, OPEN_PROJECT, "run checks");
      assertMilestoneStatus(mid, m.status, ["evidence_submitted", "audited"], "run checks");
      const policy = this.verifier.policyFor(p, m);
      const verdict = await this.onVerifier("milestone checks", () =>
        this.verifier.verifyMilestone({
          project: p,
          builder: ctx.b,
          milestone: m,
          sov: sovFor(p, m),
          evidence: ctx.evidence,
          audits: ctx.audits,
          priorEvidence: ctx.prior,
          escrowCreatedAt: m.escrow?.createdAt,
          policy,
        }),
      );
      const verdictHash = this.verifier.verdictHash(verdict);
      // Attest the verdict BEFORE any release.
      const tx = await this.attest("aiAgent", p.chain.spv!, { v: 1, kind: "verdict", milestoneId: mid, hash: verdictHash, decision: verdict.decision }, "attest verdict");
      const evaluation = evaluateRelease({ milestoneId: mid, verdict, policy, audits: ctx.audits, assignedInspectors: ctx.assigned });
      const events = this.evs([tx], { projectId: id, milestoneId: mid, kind: "verdict_attested", actor: this.aiAgentAddress });
      await this.store.write((db) => {
        const p = this.projectIn(db, id);
        const m = getMilestoneOrThrow(p, mid);
        db.verdicts.push({ ...verdict, projectId: id, round, verdictHash, policy2: policy, txHash: tx.hash });
        db.attestations.push({
          milestoneId: mid,
          role: "ai_agent",
          signer: this.aiAgentAddress,
          decision: evaluation.outcome === "pass" ? "approve" : "reject",
          notes: verdict.summary,
          txHash: tx.hash,
          kind: "verdict",
          hash: verdictHash,
          at: this.nowIso(),
          projectId: id,
          round,
        });
        this.applyOutcome(m, evaluation);
        db.chainEvents.push(...events);
      });
      if (evaluation.outcome !== "pass") return { verdict, events };
      const rel = await this.releaseVerifiedLocked(id, mid);
      return { verdict, release: rel.finish, events: [...events, ...rel.events] };
    });
  }

  private applyOutcome(m: Milestone, evaluation: ReleaseEvaluation): void {
    const to: MilestoneStatusV2 = evaluation.outcome === "pass" ? "verified" : evaluation.outcome === "fail" ? "failed" : "needs_human";
    if (evaluation.outcome === "pending") return;
    this.setMilestoneStatus(m, to);
  }

  /** verified -> released via the release service (preflight, release attestation, finish). Caller holds the project lock. */
  private async releaseVerifiedLocked(id: string, mid: string): Promise<{ finish: { txHash: string; explorerUrl: string }; events: ChainEvent[] }> {
    const { p, m, b } = await this.read((db) => {
      const p = this.projectIn(db, id);
      return { p, m: getMilestoneOrThrow(p, mid), b: this.builderOf(db, p) };
    });
    assertMilestoneStatus(mid, m.status, ["verified"], "release");
    const txs = await this.onLedger("release", () => this.release.release({ project: p, milestone: m }));
    const finishTx = txs.find((t) => t.kind === "escrow_finished") ?? txs.at(-1)!;
    const events = txs
      .map((t) =>
        t === finishTx
          ? this.ev(t, { projectId: id, milestoneId: mid, kind: "escrow_finished", actor: b.address, amount: m.amount })
          : this.ev(t, { projectId: id, milestoneId: mid, kind: t.kind ?? "approval_attested", actor: this.releaseServiceAddress }),
      )
      .filter((e): e is ChainEvent => !!e);
    await this.store.write((db) => {
      const p = this.projectIn(db, id);
      const m = getMilestoneOrThrow(p, mid);
      this.setMilestoneStatus(m, "released");
      if (m.escrow) m.escrow.finishTx = finishTx.hash;
      db.attestations.push({
        milestoneId: mid,
        role: "release_service",
        kind: "release",
        signer: this.releaseServiceAddress,
        decision: "approve",
        notes: "test suite green; escrow finished",
        txHash: txs[0]?.hash,
        at: this.nowIso(),
        projectId: id,
        round: currentRound(db, mid),
      });
      this.maybeComplete(db, p);
      db.chainEvents.push(...events);
    });
    return { finish: { txHash: finishTx.hash, explorerUrl: finishTx.explorerUrl }, events };
  }

  // ---------- route 12 ----------

  async resolveNeedsHuman(
    id: string,
    mid: string,
    body: { actor: XrplAddress; decision: "approve" | "reject"; reason: string },
  ): Promise<{ milestone: Milestone; events: ChainEvent[] }> {
    this.requirePlatform(body.actor, "Resolve needs_human");
    const reason = body.reason?.trim();
    if (!reason) throw new DomainError("VALIDATION", "A reason is required (it is attested on-chain)");
    if (body.decision !== "approve" && body.decision !== "reject") throw new DomainError("VALIDATION", "decision must be approve | reject");
    return this.locks.run(id, async () => {
      const ctx = await this.read((db) => {
        const p = this.projectIn(db, id);
        const m = getMilestoneOrThrow(p, mid);
        const round = currentRound(db, mid);
        return { p, m, round, verdict: latestVerdict(db, mid), audits: roundAudits(db, mid, round), assigned: assignedInspectors(db, id) };
      });
      assertMilestoneStatus(mid, ctx.m.status, ["needs_human"], "resolve");
      if (!ctx.verdict) throw new DomainError("ILLEGAL_TRANSITION", `No verdict for ${mid}`);
      // Attest the decision FIRST: the override is public before it has any effect.
      const tx = await this.attest(
        "platform",
        ctx.p.chain.spv!,
        { v: 1, kind: "decision", milestoneId: mid, hash: sha256Hex(reason), decision: body.decision, reason },
        "attest operator decision",
      );
      const decision: OperatorDecision = { decision: body.decision, reason, txHash: tx.hash };
      const { projectId: _p, round: _r, verdictHash: _h, policy2, txHash: _t, ...verdict } = ctx.verdict;
      const evaluation = evaluateRelease({ milestoneId: mid, verdict, policy: policy2, audits: ctx.audits, assignedInspectors: ctx.assigned, operatorDecision: decision });
      const events = this.evs([tx], { projectId: id, milestoneId: mid, kind: "decision_attested", actor: body.actor });
      const milestone = await this.store.write((db) => {
        const p = this.projectIn(db, id);
        const m = getMilestoneOrThrow(p, mid);
        db.decisions.push({ projectId: id, milestoneId: mid, round: ctx.round, actor: body.actor, decision: body.decision, reason, txHash: tx.hash, at: this.nowIso() });
        db.attestations.push({ milestoneId: mid, role: "platform", signer: body.actor, decision: body.decision, notes: reason, txHash: tx.hash, at: this.nowIso(), projectId: id, round: ctx.round, kind: "decision", hash: sha256Hex(reason) });
        this.applyOutcome(m, evaluation);
        db.chainEvents.push(...events);
        return m;
      });
      if (evaluation.outcome !== "pass") return { milestone, events };
      const rel = await this.releaseVerifiedLocked(id, mid);
      const after = await this.read((db) => getMilestoneOrThrow(this.projectIn(db, id), mid));
      return { milestone: after, events: [...events, ...rel.events] };
    });
  }

  // ---------- route 13 ----------

  async cancelExpired(id: string, mid: string): Promise<{ milestone: Milestone; events: ChainEvent[] }> {
    return this.locks.run(id, () => this.cancelExpiredLocked(id, mid));
  }

  /** `events` collects each committed step's events, so a caller still sees the cancel when the refund then throws. */
  private async cancelExpiredLocked(id: string, mid: string, events: ChainEvent[] = []): Promise<{ milestone: Milestone; events: ChainEvent[] }> {
    const { p, m } = await this.read((db) => {
      const p = this.projectIn(db, id);
      return { p, m: getMilestoneOrThrow(p, mid) };
    });
    if (!m.escrow) throw new DomainError("ILLEGAL_TRANSITION", `Milestone ${mid} has no escrow`);
    if (m.status !== "expired") {
      // The ledger lets anyone cancel any open escrow after CancelAfter, whatever our workflow state says.
      if (!isLocked(m.status)) throw new DomainError("ILLEGAL_TRANSITION", `Milestone ${mid} is ${m.status}; its escrow is not open`);
      if (!m.cancelAfter || this.now() < new Date(m.cancelAfter))
        throw new DomainError("TOO_SOON", `Escrow for ${mid} can be cancelled after ${m.cancelAfter}`, undefined, { txResult: "tecNO_PERMISSION" });
      const tx = await this.cancelOrConfirmGone(m);
      const evs = tx ? this.evs([tx], { projectId: id, milestoneId: mid, kind: "escrow_cancelled", actor: this.platformAddress, amount: m.amount }) : [];
      events.push(...evs);
      await this.store.write((db) => {
        const p = this.projectIn(db, id);
        const m = getMilestoneOrThrow(p, mid);
        m.status = "expired"; // forced: ledger reality (cancel succeeded) wins over workflow state
        if (m.escrow && tx) m.escrow.cancelTx = tx.hash;
        if (canProjectTransition(p.status, "stalled")) {
          p.status = "stalled";
          this.meta(db, id).stalledAt = this.nowIso();
        }
        db.chainEvents.push(...evs);
      });
    }
    // Refund the vault: multisig LoanPay from the SPV (separate commit; keeperTick retries if it fails). A write-ahead
    // marker + the loan's TotalValueOutstanding make the retry safe: a LoanPay whose outcome we never learned (lost
    // socket, or our commit failed after it applied) is detected on the loan instead of being paid twice.
    const loanNow = p.chain.loanId ? await this.ledger.getLoanSnapshot({ loanId: p.chain.loanId }).catch(() => undefined) : undefined;
    const prior = await this.read((db) => metaOf(db, id)?.refundAttempts?.[mid]);
    if (prior) {
      if (!prior.tvoBefore || !loanNow)
        throw new DomainError("LEDGER_ERROR", `A refund LoanPay for ${mid} may already have applied (${prior.txHash ?? "hash unknown"}) and the loan can't be read to confirm; reconcile before retrying`, undefined, { txHash: prior.txHash });
      // Half the refund is the threshold: fees can make the drop a little smaller than the payment.
      if ((toMicro(prior.tvoBefore) - toMicro(loanNow.totalValueOutstanding)) * 2n >= toMicro(m.amount)) {
        // It applied: record it without paying again. Only a known hash becomes a ChainEvent.
        const tx: TxResult | undefined = prior.txHash
          ? { hash: prior.txHash, explorerUrl: explorerTxUrl(prior.txHash), result: "reconciled_loan_repaid", kind: "loan_payment" }
          : undefined;
        return this.commitRefund(id, m, p.chain.spv, tx, events);
      }
    }
    await this.store.write((db) => {
      const meta = this.meta(db, id);
      meta.refundAttempts = { ...meta.refundAttempts, [mid]: { at: this.nowIso(), ...(loanNow ? { tvoBefore: loanNow.totalValueOutstanding } : {}) } };
    });
    let tx: TxResult;
    try {
      tx = await this.onLedger("escrow refund LoanPay", () => this.ledger.repayLoan({ project: p, amount: m.amount, source: "escrow_refund" }));
    } catch (e) {
      const txHash = e instanceof DomainError ? e.txHash : undefined;
      if (txHash) await this.store.write((db) => void (this.meta(db, id).refundAttempts![mid]!.txHash = txHash));
      throw e;
    }
    return this.commitRefund(id, m, p.chain.spv, tx, events);
  }

  /** milestone -> refunded, repayment recorded, write-ahead marker cleared. No tx = reconciled without a known hash. */
  private async commitRefund(id: string, ms: Milestone, spv: XrplAddress | undefined, tx: TxResult | undefined, events: ChainEvent[]) {
    const mid = ms.id;
    const evs = tx ? this.evs([tx], { projectId: id, milestoneId: mid, kind: "loan_payment", actor: spv, amount: ms.amount }) : [];
    const milestone = await this.store.write((db) => {
      const p = this.projectIn(db, id);
      const m = getMilestoneOrThrow(p, mid);
      this.setMilestoneStatus(m, "refunded");
      db.repayments.push({ projectId: id, milestoneId: mid, amount: m.amount, source: "escrow_refund", tx: tx?.hash ?? `reconciled:${mid}`, at: tx?.at ?? this.nowIso() });
      const meta = this.meta(db, id);
      if (meta.refundAttempts) delete meta.refundAttempts[mid];
      this.maybeComplete(db, p);
      db.chainEvents.push(...evs);
      return m;
    });
    events.push(...evs);
    return { milestone, events };
  }

  /**
   * EscrowCancel, or null when the escrow is already gone from the ledger (cancelled out of band: anyone may cancel
   * after CancelAfter, or our commit was lost after a successful cancel). A `verified` milestone whose escrow is gone
   * may have been finished, so that case is left for a human instead of refunding.
   */
  private async cancelOrConfirmGone(m: Milestone): Promise<TxResult | null> {
    const { owner, offerSequence } = m.escrow!;
    try {
      return await this.onLedger("escrow cancel", () => this.ledger.cancelEscrow({ owner, offerSequence }));
    } catch (e) {
      if (!(e instanceof DomainError) || e.code !== "LEDGER_ERROR") throw e;
      const onLedger = await this.ledger.getEscrow(owner, offerSequence).catch(() => undefined);
      if (onLedger !== null) throw e; // still there (or unknown): the cancel really failed
      if (m.status === "verified")
        throw new DomainError("LEDGER_ERROR", `Escrow for ${m.id} is gone from the ledger but the milestone is verified; check for a finish before refunding`, e);
      return null;
    }
  }

  // ---------- route 14 ----------

  async repay(id: string, body: { amount: Rlusd }): Promise<{ project: Project; events: ChainEvent[] }> {
    const amount = fromMicro(toMicro(body.amount));
    if (toMicro(amount) <= 0n) throw new DomainError("VALIDATION", "Repayment must be positive");
    return this.locks.run(id, async () => {
      const p = await this.read((db) => this.projectIn(db, id));
      assertProjectStatus(id, p.status, OPEN_PROJECT, "repay");
      const tx = await this.onLedger("LoanPay", () => this.ledger.repayLoan({ project: p, amount, source: "builder" }));
      const events = this.evs([tx], { projectId: id, kind: "loan_payment", actor: p.chain.spv, amount });
      return this.store.write((db) => {
        const p = this.projectIn(db, id);
        db.repayments.push({ projectId: id, amount, source: "builder", tx: tx.hash, at: tx.at ?? this.nowIso() });
        if (canProjectTransition(p.status, "repaying")) p.status = "repaying";
        this.maybeComplete(db, p);
        db.chainEvents.push(...events);
        return { project: p, events };
      });
    });
  }

  /** repaying -> completed once every milestone is terminal and the loan is repaid. */
  private maybeComplete(db: DbState, p: Project): void {
    if (p.status !== "repaying" || !p.milestones.every((m) => isTerminal(m.status))) return;
    const repaid = sumMicro(db.repayments.filter((r) => r.projectId === p.id).map((r) => r.amount));
    if (repaid >= totalOwedMicro(p.terms.principal, p.terms.interestRateBps, p.terms.termDays)) {
      p.status = "completed";
      this.meta(db, p.id).completedAt = this.nowIso();
    }
  }

  // ---------- route 15 ----------

  async withdraw(id: string, body: { investor: XrplAddress; amount: Rlusd }): Promise<{ events: ChainEvent[] }> {
    const amount = fromMicro(toMicro(body.amount));
    if (toMicro(amount) <= 0n) throw new DomainError("VALIDATION", "Withdrawal must be positive");
    return this.locks.run(id, async () => {
      const { p, pos } = await this.read((db) => {
        const p = this.projectIn(db, id);
        return { p, pos: investorTotals(db, p, body.investor) };
      });
      if (!p.chain.vaultId) throw new DomainError("ILLEGAL_TRANSITION", `Project ${id} has no vault`);
      if (vaultPhase(p, this.now()) !== "redemption")
        throw new DomainError("TOO_SOON", `Withdrawals open at RedemptionDate ${p.chain.redemptionDate}`, undefined, { txResult: "tecTOO_SOON" });
      if (toMicro(amount) > pos.withdrawable) throw new DomainError("CONFLICT", `Withdrawable now: ${fromMicro(pos.withdrawable)} RLUSD`);
      // Book-value model, exact for our fake ledger. Live wiring must use validated burn metadata (decisions.md).
      const sharesBurned = redemptionShares(toMicro(amount), pos.assetsTotal, pos.sharesOutstanding).toString();
      const tx = await this.onLedger("vault withdraw", () => this.ledger.withdraw({ project: p, investor: body.investor, amount }));
      const events = this.evs([tx], { projectId: id, kind: "vault_withdraw", actor: body.investor, amount });
      return this.store.write((db) => {
        db.withdrawals.push({ projectId: id, investor: body.investor, amount, sharesBurned, tx: tx.hash, at: tx.at ?? this.nowIso() });
        db.chainEvents.push(...events);
        return { events };
      });
    });
  }

  // ---------- route 21 ----------

  async resetDemo(body: { seed?: "maple-st" } = {}): Promise<{ ok: true }> {
    if (body.seed && !this.opts.seed) throw new DomainError("VALIDATION", "Demo seeding is not configured for this ledger mode (use the XRPL prestage script on devnet)");
    await this.store.reset();
    await this.release.clear();
    this.opts.resetLedger?.();
    if (body.seed) await this.opts.seed!(body.seed);
    return { ok: true };
  }

  // ---------- route 22 ----------

  /**
   * Cancels every expired open escrow (+ refund LoanPay), retries pending refunds and pending releases. Idempotent per
   * step: cancel and LoanPay commit separately, so a failed refund is retried without a second cancel. Failures stay
   * on the milestone for the next tick and are reported in `issues`.
   */
  async keeperTick(): Promise<KeeperTickResult> {
    const todo = await this.read((db) =>
      db.projects.flatMap((p) =>
        p.milestones
          .filter((m) => m.escrow)
          .map((m) => ({ pid: p.id, mid: m.id, status: m.status, cancelAfter: m.cancelAfter })),
      ),
    );
    const events: ChainEvent[] = [];
    const issues: KeeperIssue[] = [];
    const now = this.now();
    for (const t of todo) {
      const expired = !!t.cancelAfter && now >= new Date(t.cancelAfter);
      const cancelPath = t.status === "expired" || (expired && isLocked(t.status));
      if (!cancelPath && !(t.status === "verified" && !expired)) continue;
      try {
        if (cancelPath) await this.locks.run(t.pid, () => this.cancelExpiredLocked(t.pid, t.mid, events));
        else events.push(...(await this.locks.run(t.pid, () => this.releaseVerifiedLocked(t.pid, t.mid))).events);
      } catch (e) {
        const after = await this.read((db) => db.projects.find((p) => p.id === t.pid)?.milestones.find((m) => m.id === t.mid)?.status);
        const step = !cancelPath ? "release" : after === "expired" ? "refund" : "cancel";
        issues.push({
          projectId: t.pid,
          milestoneId: t.mid,
          step,
          code: e instanceof DomainError ? e.code : "INTERNAL",
          message: (e as Error).message,
        });
      }
    }
    return { events, issues };
  }

  // ---------- route 23 ----------

  async tryStealDemo(id: string, mid: string): Promise<TryStealResult> {
    return this.locks.run(id, async () => {
      const { p, m } = await this.read((db) => {
        const p = this.projectIn(db, id);
        return { p, m: getMilestoneOrThrow(p, mid) };
      });
      if (!m.escrow || !isLocked(m.status) || m.status === "expired") throw new DomainError("ILLEGAL_TRANSITION", `Milestone ${mid} has no open escrow`);
      const tx = await this.onLedger("try-steal", () => this.release.tryStealDemo({ project: p, milestone: m }));
      const events = this.evs([tx], { projectId: id, milestoneId: mid, kind: "release_refused", actor: this.platformAddress });
      await this.store.write((db) => db.chainEvents.push(...events));
      if (tx.result !== "tecCRYPTOCONDITION_ERROR")
        throw new DomainError("LEDGER_ERROR", `Expected tecCRYPTOCONDITION_ERROR, ledger said ${tx.result}`, undefined, { txResult: tx.result, txHash: tx.hash });
      return { result: "tecCRYPTOCONDITION_ERROR", txHash: tx.hash, explorerUrl: tx.explorerUrl };
    });
  }
}
