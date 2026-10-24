// CoreService — the workflow orchestrator. Every mutation:
//   1. takes a per-entity lock, 2. reads + validates state (explicit state-machine checks),
//   3. performs the external effect (ledger / verifier), 4. commits state + ChainEvents in one store write.
// If step 3 throws, nothing is committed.
import {
  MILESTONE_TEMPLATES,
  ProjectType,
  RiskTier,
  Rlusd,
  XrplAddress,
  type Attestation,
  type Builder,
  type ChainEvent,
  type Evidence,
  type Investment,
  type Milestone,
  type MilestoneStatus,
  type MilestoneTemplate,
  type Project,
  type ProjectStatus,
  type Verdict,
} from "@xrlp/shared";
import { z } from "zod";
import { DAY_MS, systemClock, type Clock } from "./clock.ts";
import { fulfillmentMatches, isCondition } from "./conditions.ts";
import { DomainError } from "./errors.ts";
import { fakeAddress, newId, slugify } from "./ids.ts";
import { fromMicro, splitByShares, sumMicro, toMicro, totalOwedMicro, minMicro } from "./money.ts";
import type { BuilderDocument, BuilderVerification, LedgerPort, VerifierPort } from "./ports.ts";
import { evaluateQuorum, type QuorumStatus } from "./quorum.ts";
import {
  assertMilestoneStatus,
  assertMilestoneTransition,
  assertProjectStatus,
  assertProjectTransition,
  LOCKED_MILESTONE,
} from "./state-machine.ts";
import type { AttestationRecord, DbState, InspectorProfile, InvestorProfile, ProjectMeta, Store, VerdictRecord } from "./store.ts";

// ---------- input schemas (exported so route handlers can reuse them) ----------

export const RegisterBuilderInput = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1),
  address: XrplAddress,
  licenseNumber: z.string(),
  insurancePolicy: z.string(),
  completedProjects: z.number().int().nonnegative().default(0),
  riskTier: RiskTier.default("medium"),
});
export type RegisterBuilderInput = z.input<typeof RegisterBuilderInput>;

export const BuilderDocumentInput = z.object({
  kind: z.enum(["license", "insurance", "track_record", "identity", "other"]),
  filename: z.string(),
  uri: z.string().optional(),
  fields: z.record(z.string()).optional(),
});

export const RegisterInvestorInput = z.object({ address: XrplAddress, name: z.string().min(1) });
export const RegisterInspectorInput = z.object({
  address: XrplAddress,
  name: z.string().min(1),
  licenseNumber: z.string().min(1),
});

export const CreateProjectInput = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/).optional(),
  builderId: z.string(),
  name: z.string().min(1),
  type: ProjectType,
  siteAddress: z.string().min(1),
  siteGeo: z.object({ lat: z.number(), lng: z.number(), radiusM: z.number().positive() }),
  description: z.string().default(""),
  terms: z.object({
    principal: Rlusd,
    interestRateBps: z.number().int().nonnegative(),
    termDays: z.number().int().positive(),
    paymentIntervalDays: z.number().int().positive(),
    fundingDeadline: z.string().datetime(),
  }),
  /** Platform-assigned inspectors (never chosen by the builder). First = default escrow-condition holder. */
  inspectors: z.array(XrplAddress).min(1).max(2),
});
export type CreateProjectInput = z.input<typeof CreateProjectInput>;

export const EvidenceInput = z.object({
  kind: z.enum(["photo", "invoice", "document", "inspector_report"]),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  uri: z.string().min(1),
  sha256: z.string().min(1),
  meta: z
    .object({
      takenAt: z.string().datetime().optional(),
      gps: z.object({ lat: z.number(), lng: z.number() }).optional(),
      perceptualHash: z.string().optional(),
      invoiceTotal: Rlusd.optional(),
    })
    .partial()
    .default({}),
});
export type EvidenceInput = z.input<typeof EvidenceInput>;

function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    throw new DomainError(
      "VALIDATION",
      r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "),
      r.error.issues,
    );
  }
  return r.data;
}

// ---------- options ----------

export interface CoreServiceOptions {
  store: Store;
  ledger: LedgerPort;
  verifier: VerifierPort;
  clock?: Clock;
  /** Platform signer address (credential issuer, platform attestations). */
  platformAddress?: XrplAddress;
  /** AI agent signer address on the SPV. */
  aiAgentAddress?: XrplAddress;
  /** Close the loan + create escrows automatically when funding completes (default true). */
  autoClose?: boolean;
  /** Escrow CancelAfter per milestone. Default: milestone i of n due at (i+1)/n of termDays from close.
   *  Override for live demos (e.g. make milestone 3 expire in 3 minutes). */
  cancelAfterFor?: (project: Project, milestone: Milestone, closeAt: Date) => Date;
}

export const defaultCancelAfter = (project: Project, milestone: Milestone, closeAt: Date): Date =>
  new Date(closeAt.getTime() + Math.round(((milestone.index + 1) / project.milestones.length) * project.terms.termDays * DAY_MS));

// ---------- tiny keyed mutex ----------

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

// ---------- pure helpers over DbState (also used by read models) ----------

export function getProjectOrThrow(db: DbState, projectId: string): Project {
  const p = db.projects.find((x) => x.id === projectId);
  if (!p) throw new DomainError("NOT_FOUND", `Project ${projectId} not found`);
  return p;
}
export function getMetaOrThrow(db: DbState, projectId: string): ProjectMeta {
  const m = db.projectMeta.find((x) => x.projectId === projectId);
  if (!m) throw new DomainError("NOT_FOUND", `Project meta ${projectId} not found`);
  return m;
}
export function getMilestoneOrThrow(project: Project, milestoneId: string): Milestone {
  const m = project.milestones.find((x) => x.id === milestoneId);
  if (!m) throw new DomainError("NOT_FOUND", `Milestone ${milestoneId} not found in project ${project.id}`);
  return m;
}
export function getBuilderOrThrow(db: DbState, builderId: string): Builder {
  const b = db.builders.find((x) => x.id === builderId);
  if (!b) throw new DomainError("NOT_FOUND", `Builder ${builderId} not found`);
  return b;
}
export function templateFor(project: Project, milestone: Milestone): MilestoneTemplate {
  const t = MILESTONE_TEMPLATES[project.type].find((x) => x.key === milestone.templateKey);
  if (!t) throw new DomainError("NOT_FOUND", `No template ${milestone.templateKey} for ${project.type}`);
  return t;
}
/** Current evidence round for a milestone (0 = never submitted). */
export function currentRound(db: DbState, milestoneId: string): number {
  return db.evidence.filter((e) => e.milestoneId === milestoneId).reduce((r, e) => Math.max(r, e.round), 0);
}
export function roundAttestations(db: DbState, milestoneId: string, round: number): AttestationRecord[] {
  return db.attestations.filter((a) => a.milestoneId === milestoneId && a.round === round);
}
export function latestVerdict(db: DbState, milestoneId: string): VerdictRecord | undefined {
  return db.verdicts.filter((v) => v.milestoneId === milestoneId).at(-1);
}
export function quorumFor(db: DbState, milestone: Milestone): QuorumStatus {
  return evaluateQuorum(roundAttestations(db, milestone.id, currentRound(db, milestone.id)), milestone.requiredInspectors);
}

export interface VaultPosition {
  deposits: bigint;
  loaned: bigint;
  repaid: bigint;
  withdrawn: bigint;
  /** Liquid assets in the vault right now. */
  available: bigint;
  /** principal + simple interest over the term. */
  owed: bigint;
  outstanding: bigint;
  totalValue: bigint;
}

export function vaultPosition(db: DbState, project: Project): VaultPosition {
  const deposits = sumMicro(db.investments.filter((i) => i.projectId === project.id).map((i) => i.amount));
  const loaned = project.chain.loanId ? toMicro(project.terms.principal) : 0n;
  const repaid = sumMicro(db.repayments.filter((r) => r.projectId === project.id).map((r) => r.amount));
  const withdrawn = sumMicro(db.withdrawals.filter((w) => w.projectId === project.id).map((w) => w.amount));
  const owed = loaned ? totalOwedMicro(project.terms.principal, project.terms.interestRateBps, project.terms.termDays) : 0n;
  const outstanding = loaned ? (owed > repaid ? owed - repaid : 0n) : 0n;
  const available = deposits - loaned + repaid - withdrawn;
  return { deposits, loaned, repaid, withdrawn, available, owed, outstanding, totalValue: available + outstanding };
}

export interface InvestorPosition {
  deposited: bigint;
  withdrawn: bigint;
  /** ownership fraction in parts-per-million */
  sharePpm: bigint;
  currentValue: bigint;
  withdrawable: bigint;
}

export function investorPosition(db: DbState, project: Project, investor: string): InvestorPosition {
  const v = vaultPosition(db, project);
  const deposited = sumMicro(db.investments.filter((i) => i.projectId === project.id && i.investor === investor).map((i) => i.amount));
  const withdrawn = sumMicro(db.withdrawals.filter((w) => w.projectId === project.id && w.investor === investor).map((w) => w.amount));
  if (v.deposits === 0n) return { deposited, withdrawn, sharePpm: 0n, currentValue: 0n, withdrawable: 0n };
  const sharePpm = (deposited * 1_000_000n) / v.deposits;
  // Claim on liquid money ever made available to the vault, pro-rata, minus what this investor already took.
  const liquidClaim = (deposited * (v.deposits - v.loaned + v.repaid)) / v.deposits - withdrawn;
  const withdrawable = minMicro(liquidClaim > 0n ? liquidClaim : 0n, v.available);
  const currentValue = (deposited * (v.deposits - v.loaned + v.repaid + v.outstanding)) / v.deposits - withdrawn;
  return { deposited, withdrawn, sharePpm, currentValue: currentValue > 0n ? currentValue : 0n, withdrawable };
}

// ---------- service ----------

export class CoreService {
  readonly store: Store;
  readonly ledger: LedgerPort;
  readonly verifier: VerifierPort;
  readonly clock: Clock;
  readonly platformAddress: XrplAddress;
  readonly aiAgentAddress: XrplAddress;
  private readonly autoClose: boolean;
  private readonly cancelAfterFor: NonNullable<CoreServiceOptions["cancelAfterFor"]>;
  private readonly locks = new KeyedMutex();

  constructor(opts: CoreServiceOptions) {
    this.store = opts.store;
    this.ledger = opts.ledger;
    this.verifier = opts.verifier;
    this.clock = opts.clock ?? systemClock;
    this.platformAddress = opts.platformAddress ?? fakeAddress("platform");
    this.aiAgentAddress = opts.aiAgentAddress ?? fakeAddress("ai-agent");
    this.autoClose = opts.autoClose ?? true;
    this.cancelAfterFor = opts.cancelAfterFor ?? defaultCancelAfter;
  }

  private nowIso(): string {
    return this.clock.now().toISOString();
  }

  private async onLedger<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof DomainError) throw e;
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

  // ===== participants =====

  async registerBuilder(input: RegisterBuilderInput): Promise<Builder> {
    const data = parse(RegisterBuilderInput, input);
    const id = data.id ?? `bld-${slugify(data.name)}`;
    return this.locks.run(`builder:${id}`, () =>
      this.store.write((db) => {
        if (db.builders.some((b) => b.id === id || b.address === data.address))
          throw new DomainError("CONFLICT", `Builder ${id} / ${data.address} already registered`);
        const builder: Builder = {
          id,
          name: data.name,
          address: data.address,
          licenseNumber: data.licenseNumber,
          insurancePolicy: data.insurancePolicy,
          completedProjects: data.completedProjects,
          riskTier: data.riskTier,
          verified: false,
        };
        db.builders.push(builder);
        return builder;
      }),
    );
  }

  /** AI reviews onboarding docs; on ok, platform issues VERIFIED_BUILDER credential on-chain. */
  async verifyBuilder(
    builderId: string,
    documents: BuilderDocument[],
  ): Promise<{ builder: Builder; verification: BuilderVerification; event?: ChainEvent }> {
    const docs = parse(z.array(BuilderDocumentInput), documents) as BuilderDocument[];
    return this.locks.run(`builder:${builderId}`, async () => {
      const builder = await this.store.read((db) => getBuilderOrThrow(db, builderId));
      if (builder.verified) throw new DomainError("CONFLICT", `Builder ${builderId} is already verified`);
      const verification = await this.onVerifier("verifyBuilder", () => this.verifier.verifyBuilder({ builder, documents: docs }));
      const event = verification.ok
        ? await this.onLedger("issueCredential", () =>
            this.ledger.issueCredential({ subject: builder.address, type: "VERIFIED_BUILDER" }),
          )
        : undefined;
      const updated = await this.store.write((db) => {
        const b = getBuilderOrThrow(db, builderId);
        db.builderReviews.push({ builderId, documents: docs, result: verification, at: this.nowIso() });
        if (verification.riskTier) b.riskTier = verification.riskTier;
        if (event) {
          b.verified = true;
          b.credentialTx = event.txHash;
          db.chainEvents.push(event);
        }
        return b;
      });
      return { builder: updated, verification, event };
    });
  }

  /** Registers a (mock-KYC'd) investor and issues the KYC_INVESTOR credential. */
  async registerInvestor(input: z.input<typeof RegisterInvestorInput>): Promise<{ investor: InvestorProfile; event: ChainEvent }> {
    const data = parse(RegisterInvestorInput, input);
    return this.locks.run(`investor:${data.address}`, async () => {
      const exists = await this.store.read((db) => db.investors.some((i) => i.address === data.address));
      if (exists) throw new DomainError("CONFLICT", `Investor ${data.address} already registered`);
      const event = await this.onLedger("issueCredential", () =>
        this.ledger.issueCredential({ subject: data.address, type: "KYC_INVESTOR" }),
      );
      const investor: InvestorProfile = { ...data, kycCredentialTx: event.txHash, createdAt: this.nowIso() };
      await this.store.write((db) => {
        db.investors.push(investor);
        db.chainEvents.push(event);
      });
      return { investor, event };
    });
  }

  async registerInspector(input: z.input<typeof RegisterInspectorInput>): Promise<InspectorProfile> {
    const data = parse(RegisterInspectorInput, input);
    return this.store.write((db) => {
      if (db.inspectors.some((i) => i.address === data.address))
        throw new DomainError("CONFLICT", `Inspector ${data.address} already registered`);
      const inspector: InspectorProfile = { ...data, createdAt: this.nowIso() };
      db.inspectors.push(inspector);
      return inspector;
    });
  }

  // ===== project lifecycle =====

  /** Builder proposes a project from a standard template. Amounts = defaultShare x principal. */
  async createProject(input: CreateProjectInput): Promise<Project> {
    const data = parse(CreateProjectInput, input);
    const id = data.id ?? `${slugify(data.name)}-${newId("p").slice(-4)}`;
    return this.store.write((db) => {
      const builder = getBuilderOrThrow(db, data.builderId);
      if (!builder.verified)
        throw new DomainError("FORBIDDEN", `Builder ${builder.id} is not verified (no VERIFIED_BUILDER credential)`);
      if (db.projects.some((p) => p.id === id)) throw new DomainError("CONFLICT", `Project ${id} already exists`);
      for (const a of data.inspectors)
        if (!db.inspectors.some((i) => i.address === a)) throw new DomainError("VALIDATION", `Inspector ${a} not registered`);
      if (new Set(data.inspectors).size !== data.inspectors.length)
        throw new DomainError("VALIDATION", "Inspectors must be distinct");
      if (toMicro(data.terms.principal) <= 0n) throw new DomainError("VALIDATION", "Principal must be > 0");

      const templates = MILESTONE_TEMPLATES[data.type];
      const amounts = splitByShares(data.terms.principal, templates.map((t) => t.defaultShare));
      const project: Project = {
        id,
        name: data.name,
        type: data.type,
        builderId: builder.id,
        siteAddress: data.siteAddress,
        siteGeo: data.siteGeo,
        description: data.description,
        terms: data.terms,
        status: "draft",
        milestones: [],
        chain: {},
      };
      project.milestones = templates.map((t, index) => {
        const m: Milestone = {
          id: `${id}-m${index + 1}-${t.key}`,
          index,
          templateKey: t.key,
          title: t.title,
          amount: amounts[index]!,
          requiredInspectors: 1,
          status: "pending",
        };
        m.requiredInspectors = this.verifier.policyFor(project, builder, m).requiredInspectors;
        if (m.requiredInspectors > data.inspectors.length)
          throw new DomainError(
            "VALIDATION",
            `Milestone "${m.title}" (${m.amount} RLUSD) requires ${m.requiredInspectors} inspectors; only ${data.inspectors.length} assigned`,
          );
        return m;
      });
      db.projects.push(project);
      db.projectMeta.push({ projectId: id, inspectors: data.inspectors, conditions: [], createdAt: this.nowIso() });
      return project;
    });
  }

  /** Platform approves the plan; terms become immutable. */
  async lockTerms(projectId: string): Promise<Project> {
    return this.locks.run(`project:${projectId}`, () =>
      this.store.write((db) => {
        const p = getProjectOrThrow(db, projectId);
        assertProjectTransition(projectId, p.status, "terms_locked");
        const total = sumMicro(p.milestones.map((m) => m.amount));
        if (total !== toMicro(p.terms.principal))
          throw new DomainError("VALIDATION", `Milestones sum ${fromMicro(total)} != principal ${p.terms.principal}`);
        p.status = "terms_locked";
        getMetaOrThrow(db, projectId).termsLockedAt = this.nowIso();
        return p;
      }),
    );
  }

  /** Creates SPV + Vault + LoanBroker on-chain and opens the vault for deposits. */
  async openFunding(projectId: string): Promise<Project> {
    return this.locks.run(`project:${projectId}`, async () => {
      const { project, builder, meta } = await this.store.read((db) => {
        const project = getProjectOrThrow(db, projectId);
        return { project, builder: getBuilderOrThrow(db, project.builderId), meta: getMetaOrThrow(db, projectId) };
      });
      assertProjectTransition(projectId, project.status, "funding");
      if (this.clock.now() >= new Date(project.terms.fundingDeadline))
        throw new DomainError("VALIDATION", `Funding deadline ${project.terms.fundingDeadline} already passed`);
      const setup = await this.onLedger("setupProjectOnChain", () =>
        this.ledger.setupProjectOnChain({ project, builder, inspectors: meta.inspectors }),
      );
      return this.store.write((db) => {
        const p = getProjectOrThrow(db, projectId);
        p.status = "funding";
        p.chain = {
          ...p.chain,
          spv: setup.spv,
          vaultId: setup.vaultId,
          loanBrokerId: setup.loanBrokerId,
          shareMptIssuanceId: setup.shareMptIssuanceId,
        };
        getMetaOrThrow(db, projectId).fundingOpenedAt = this.nowIso();
        db.chainEvents.push(...setup.events);
        return p;
      });
    });
  }

  /**
   * Inspector-side step: the condition-holding inspector supplies one PREIMAGE-SHA-256 condition per milestone
   * (they keep the fulfillments). Allowed until escrows are created. If the project is already funded and
   * autoClose is on, this triggers loan close + escrow creation.
   */
  async submitMilestoneConditions(
    projectId: string,
    input: { inspector: XrplAddress; conditions: { milestoneId: string; condition: string }[] },
  ): Promise<Project> {
    return this.locks.run(`project:${projectId}`, async () => {
      const project = await this.store.write((db) => {
        const p = getProjectOrThrow(db, projectId);
        const meta = getMetaOrThrow(db, projectId);
        assertProjectStatus(projectId, p.status, ["draft", "terms_locked", "funding", "funded"], "submit escrow conditions");
        if (!meta.inspectors.includes(input.inspector))
          throw new DomainError("FORBIDDEN", `${input.inspector} is not an inspector on ${projectId}`);
        for (const c of input.conditions) {
          getMilestoneOrThrow(p, c.milestoneId);
          if (!isCondition(c.condition))
            throw new DomainError("VALIDATION", `Condition for ${c.milestoneId} is not a PREIMAGE-SHA-256 condition`);
          meta.conditions = meta.conditions.filter((x) => x.milestoneId !== c.milestoneId);
          meta.conditions.push({ milestoneId: c.milestoneId, condition: c.condition.toUpperCase(), holder: input.inspector, at: this.nowIso() });
        }
        return p;
      });
      if (this.autoClose && project.status === "funded" && (await this.hasAllConditions(projectId))) {
        return this.closeLoanLocked(projectId);
      }
      return project;
    });
  }

  private hasAllConditions(projectId: string): Promise<boolean> {
    return this.store.read((db) => {
      const p = getProjectOrThrow(db, projectId);
      const meta = getMetaOrThrow(db, projectId);
      return p.milestones.every((m) => meta.conditions.some((c) => c.milestoneId === m.id));
    });
  }

  /** Investor deposits RLUSD into the project vault. Completing the raise flips the project to funded
   *  (and, with autoClose + all conditions present, closes the loan and creates escrows). */
  async invest(
    projectId: string,
    input: { investor: XrplAddress; amount: Rlusd },
  ): Promise<{ investment: Investment; event: ChainEvent; project: Project }> {
    const { investor, amount } = parse(z.object({ investor: XrplAddress, amount: Rlusd }), input);
    return this.locks.run(`project:${projectId}`, async () => {
      const { project, remaining } = await this.store.read((db) => {
        const project = getProjectOrThrow(db, projectId);
        if (!db.investors.some((i) => i.address === investor))
          throw new DomainError("FORBIDDEN", `Investor ${investor} has no KYC_INVESTOR credential (register first)`);
        const raised = sumMicro(db.investments.filter((i) => i.projectId === projectId).map((i) => i.amount));
        return { project, remaining: toMicro(project.terms.principal) - raised };
      });
      assertProjectStatus(projectId, project.status, ["funding"], "invest");
      if (this.clock.now() >= new Date(project.terms.fundingDeadline))
        throw new DomainError("ILLEGAL_TRANSITION", `Funding deadline passed for ${projectId}`);
      const amt = toMicro(amount);
      if (amt <= 0n) throw new DomainError("VALIDATION", "Amount must be > 0");
      if (amt > remaining)
        throw new DomainError("VALIDATION", `Amount ${amount} exceeds remaining ${fromMicro(remaining)} RLUSD`);

      const event = await this.onLedger("depositToVault", () => this.ledger.depositToVault({ project, investor, amount }));
      const investment: Investment = { projectId, investor, amount, tx: event.txHash, at: event.at };
      let updated = await this.store.write((db) => {
        const p = getProjectOrThrow(db, projectId);
        db.investments.push(investment);
        db.chainEvents.push(event);
        if (amt === remaining) {
          assertProjectTransition(projectId, p.status, "funded");
          p.status = "funded";
        }
        return p;
      });
      if (updated.status === "funded" && this.autoClose && (await this.hasAllConditions(projectId))) {
        updated = await this.closeLoanLocked(projectId);
      }
      return { investment, event, project: updated };
    });
  }

  /** LoanSet to the SPV, then one EscrowCreate per milestone (same step). */
  async closeLoan(projectId: string): Promise<Project> {
    return this.locks.run(`project:${projectId}`, () => this.closeLoanLocked(projectId));
  }

  private async closeLoanLocked(projectId: string): Promise<Project> {
    const { project, builder, meta } = await this.store.read((db) => {
      const project = getProjectOrThrow(db, projectId);
      return { project, builder: getBuilderOrThrow(db, project.builderId), meta: getMetaOrThrow(db, projectId) };
    });
    assertProjectTransition(projectId, project.status, "escrowed");
    const missing = project.milestones.filter((m) => !meta.conditions.some((c) => c.milestoneId === m.id));
    if (missing.length)
      throw new DomainError(
        "ILLEGAL_TRANSITION",
        `Cannot create escrows: inspector has not supplied conditions for ${missing.map((m) => m.title).join(", ")}`,
      );
    const closeAt = this.clock.now();
    const withDeadlines: Project = {
      ...project,
      milestones: project.milestones.map((m) => ({ ...m, cancelAfter: this.cancelAfterFor(project, m, closeAt).toISOString() })),
    };
    const conditions = withDeadlines.milestones.map((m) => {
      const c = meta.conditions.find((x) => x.milestoneId === m.id)!;
      return { milestoneId: m.id, condition: c.condition };
    });
    const closing = await this.onLedger("closeLoanAndCreateEscrows", () =>
      this.ledger.closeLoanAndCreateEscrows({ project: withDeadlines, builder, conditions }),
    );
    return this.store.write((db) => {
      const p = getProjectOrThrow(db, projectId);
      p.status = "escrowed";
      p.chain = { ...p.chain, loanId: closing.loanId };
      for (const m of p.milestones) {
        const esc = closing.escrows.find((e) => e.milestoneId === m.id);
        if (!esc) throw new DomainError("LEDGER_ERROR", `Ledger returned no escrow for ${m.id}`);
        assertMilestoneTransition(m.id, m.status, "escrowed");
        m.status = "escrowed";
        m.cancelAfter = withDeadlines.milestones[m.index]!.cancelAfter;
        m.escrow = { owner: esc.owner, offerSequence: esc.offerSequence, condition: esc.condition, createTx: esc.createTx };
      }
      getMetaOrThrow(db, projectId).escrowedAt = this.nowIso();
      db.chainEvents.push(...closing.events);
      return p;
    });
  }

  /** Funding deadline passed without a full raise -> stalled; investors withdraw. Returns true if it stalled. */
  async checkFundingDeadline(projectId: string): Promise<boolean> {
    return this.locks.run(`project:${projectId}`, () =>
      this.store.write((db) => {
        const p = getProjectOrThrow(db, projectId);
        if (p.status !== "funding" || this.clock.now() < new Date(p.terms.fundingDeadline)) return false;
        assertProjectTransition(projectId, p.status, "stalled");
        p.status = "stalled";
        const meta = getMetaOrThrow(db, projectId);
        meta.stalledAt = this.nowIso();
        meta.stalledReason = "Funding deadline missed";
        return true;
      }),
    );
  }

  // ===== milestones =====

  /** Builder uploads evidence (files already stored; see saveEvidenceBlob). Starts a new review round. */
  async submitEvidence(projectId: string, milestoneId: string, input: { evidence: EvidenceInput[] }): Promise<{ milestone: Milestone; evidence: Evidence[]; round: number }> {
    const items = parse(z.array(EvidenceInput).min(1), input.evidence);
    return this.locks.run(`project:${projectId}`, () =>
      this.store.write((db) => {
        const p = getProjectOrThrow(db, projectId);
        assertProjectStatus(projectId, p.status, ["escrowed", "repaying"], "submit evidence");
        const m = getMilestoneOrThrow(p, milestoneId);
        assertMilestoneTransition(m.id, m.status, "evidence_submitted");
        if (m.cancelAfter && this.clock.now() >= new Date(m.cancelAfter))
          throw new DomainError("ILLEGAL_TRANSITION", `Milestone ${m.id} escrow expired at ${m.cancelAfter}`);
        const round = currentRound(db, m.id) + 1;
        const at = this.nowIso();
        const evidence: Evidence[] = items.map((e) => ({ ...e, id: newId("ev"), uploadedAt: at }));
        db.evidence.push(...evidence.map((e) => ({ ...e, projectId, milestoneId, round })));
        m.status = "evidence_submitted";
        return { milestone: m, evidence, round };
      }),
    );
  }

  /** AI verifier checks the current round. pass -> AI approval attested on-chain; fail -> rejected. */
  async runAiReview(projectId: string, milestoneId: string): Promise<{ verdict: Verdict; milestone: Milestone; attestation?: Attestation }> {
    return this.locks.run(`project:${projectId}`, async () => {
      const ctx = await this.store.read((db) => {
        const project = getProjectOrThrow(db, projectId);
        const milestone = getMilestoneOrThrow(project, milestoneId);
        const builder = getBuilderOrThrow(db, project.builderId);
        const round = currentRound(db, milestoneId);
        const strip = ({ projectId: _p, milestoneId: _m, round: _r, ...e }: (typeof db.evidence)[number]): Evidence => e;
        const builderProjects = new Set(db.projects.filter((x) => x.builderId === builder.id).map((x) => x.id));
        const evidence = db.evidence.filter((e) => e.milestoneId === milestoneId && e.round === round).map(strip);
        const priorEvidence = db.evidence
          .filter((e) => builderProjects.has(e.projectId) && !(e.milestoneId === milestoneId && e.round === round))
          .map(strip);
        const escrowCreatedAt = db.chainEvents.find((e) => e.kind === "escrow_created" && e.milestoneId === milestoneId)?.at;
        return { project, milestone, builder, round, evidence, priorEvidence, escrowCreatedAt };
      });
      assertMilestoneStatus(milestoneId, ctx.milestone.status, ["evidence_submitted"], "run AI review");
      const verdict = await this.onVerifier("verifyMilestone", () =>
        this.verifier.verifyMilestone({
          project: ctx.project,
          builder: ctx.builder,
          milestone: ctx.milestone,
          template: templateFor(ctx.project, ctx.milestone),
          evidence: ctx.evidence,
          priorEvidence: ctx.priorEvidence,
          escrowCreatedAt: ctx.escrowCreatedAt,
        }),
      );
      let attestation: AttestationRecord | undefined;
      let event: ChainEvent | undefined;
      if (verdict.decision === "pass") {
        event = await this.onLedger("attestApproval(ai_agent)", () =>
          this.ledger.attestApproval({
            project: ctx.project,
            milestone: ctx.milestone,
            role: "ai_agent",
            signer: this.aiAgentAddress,
            decision: "approve",
            notes: verdict.summary,
          }),
        );
        attestation = {
          projectId,
          milestoneId,
          round: ctx.round,
          role: "ai_agent",
          signer: this.aiAgentAddress,
          decision: "approve",
          notes: verdict.summary,
          txHash: event.txHash,
          at: event.at,
        };
      }
      const milestone = await this.store.write((db) => {
        const p = getProjectOrThrow(db, projectId);
        const m = getMilestoneOrThrow(p, milestoneId);
        const next: MilestoneStatus = verdict.decision === "fail" ? "rejected" : "ai_reviewed";
        assertMilestoneTransition(m.id, m.status, next);
        m.status = next;
        db.verdicts.push({ ...verdict, projectId, round: ctx.round });
        if (attestation) db.attestations.push(attestation);
        if (event) db.chainEvents.push(event);
        return m;
      });
      return { verdict, milestone, attestation };
    });
  }

  /**
   * Inspector signs approve/reject (recorded on-chain). If this approval completes quorum AND the
   * condition-holding inspector hands over `fulfillment`, the escrow is released in the same call.
   */
  async inspectorAttest(
    projectId: string,
    milestoneId: string,
    input: { inspector: XrplAddress; decision: "approve" | "reject"; notes?: string; fulfillment?: string },
  ): Promise<{ milestone: Milestone; attestation: Attestation; quorum: QuorumStatus; released?: ChainEvent }> {
    return this.locks.run(`project:${projectId}`, async () => {
      const ctx = await this.store.read((db) => {
        const project = getProjectOrThrow(db, projectId);
        const meta = getMetaOrThrow(db, projectId);
        const milestone = getMilestoneOrThrow(project, milestoneId);
        const round = currentRound(db, milestoneId);
        return { project, meta, milestone, round, prior: roundAttestations(db, milestoneId, round), verdict: latestVerdict(db, milestoneId) };
      });
      if (!ctx.meta.inspectors.includes(input.inspector))
        throw new DomainError("FORBIDDEN", `${input.inspector} is not an inspector on ${projectId}`);
      assertMilestoneStatus(milestoneId, ctx.milestone.status, ["ai_reviewed", "inspected"], "inspector attest");
      if (ctx.prior.some((a) => a.role === "inspector" && a.signer === input.inspector))
        throw new DomainError("CONFLICT", `Inspector ${input.inspector} already attested this round`);
      if (input.fulfillment && !fulfillmentMatches(ctx.milestone.escrow?.condition ?? "", input.fulfillment))
        throw new DomainError("VALIDATION", `Fulfillment does not match the escrow condition for ${milestoneId}`);

      const event = await this.onLedger("attestApproval(inspector)", () =>
        this.ledger.attestApproval({
          project: ctx.project,
          milestone: ctx.milestone,
          role: "inspector",
          signer: input.inspector,
          decision: input.decision,
          notes: input.notes,
        }),
      );
      const attestation: AttestationRecord = {
        projectId,
        milestoneId,
        round: ctx.round,
        role: "inspector",
        signer: input.inspector,
        decision: input.decision,
        notes: input.notes ?? "",
        txHash: event.txHash,
        at: event.at,
      };
      const { milestone, quorum } = await this.store.write((db) => {
        const p = getProjectOrThrow(db, projectId);
        const m = getMilestoneOrThrow(p, milestoneId);
        db.attestations.push(attestation);
        db.chainEvents.push(event);
        const next: MilestoneStatus = input.decision === "reject" ? "rejected" : "inspected";
        if (m.status !== next) {
          assertMilestoneTransition(m.id, m.status, next);
          m.status = next;
        }
        return { milestone: m, quorum: quorumFor(db, m) };
      });
      if (quorum.met && input.fulfillment) {
        const r = await this.releaseLocked(projectId, milestoneId, input.fulfillment);
        return { milestone: r.milestone, attestation, quorum, released: r.event };
      }
      return { milestone, attestation, quorum };
    });
  }

  /** Platform co-sign (weight 1) — e.g. when the AI said needs_human. Never sufficient on its own. */
  async platformAttest(
    projectId: string,
    milestoneId: string,
    input: { decision: "approve" | "reject"; notes?: string },
  ): Promise<{ milestone: Milestone; attestation: Attestation; quorum: QuorumStatus }> {
    return this.locks.run(`project:${projectId}`, async () => {
      const ctx = await this.store.read((db) => {
        const project = getProjectOrThrow(db, projectId);
        const milestone = getMilestoneOrThrow(project, milestoneId);
        const round = currentRound(db, milestoneId);
        return { project, milestone, round, prior: roundAttestations(db, milestoneId, round) };
      });
      assertMilestoneStatus(milestoneId, ctx.milestone.status, ["ai_reviewed", "inspected"], "platform attest");
      if (ctx.prior.some((a) => a.role === "platform"))
        throw new DomainError("CONFLICT", "Platform already attested this round");
      const event = await this.onLedger("attestApproval(platform)", () =>
        this.ledger.attestApproval({
          project: ctx.project,
          milestone: ctx.milestone,
          role: "platform",
          signer: this.platformAddress,
          decision: input.decision,
          notes: input.notes,
        }),
      );
      const attestation: AttestationRecord = {
        projectId,
        milestoneId,
        round: ctx.round,
        role: "platform",
        signer: this.platformAddress,
        decision: input.decision,
        notes: input.notes ?? "",
        txHash: event.txHash,
        at: event.at,
      };
      return this.store.write((db) => {
        const p = getProjectOrThrow(db, projectId);
        const m = getMilestoneOrThrow(p, milestoneId);
        db.attestations.push(attestation);
        db.chainEvents.push(event);
        if (input.decision === "reject") {
          assertMilestoneTransition(m.id, m.status, "rejected");
          m.status = "rejected";
        }
        return { milestone: m, attestation, quorum: quorumFor(db, m) };
      });
    });
  }

  /** EscrowFinish. Requires quorum + the condition-holding inspector's fulfillment (never stored). */
  async releaseMilestone(projectId: string, milestoneId: string, input: { fulfillment: string }): Promise<{ milestone: Milestone; event: ChainEvent }> {
    return this.locks.run(`project:${projectId}`, () => this.releaseLocked(projectId, milestoneId, input.fulfillment));
  }

  private async releaseLocked(projectId: string, milestoneId: string, fulfillment: string): Promise<{ milestone: Milestone; event: ChainEvent }> {
    const { project, milestone, quorum } = await this.store.read((db) => {
      const project = getProjectOrThrow(db, projectId);
      const milestone = getMilestoneOrThrow(project, milestoneId);
      return { project, milestone, quorum: quorumFor(db, milestone) };
    });
    assertMilestoneTransition(milestoneId, milestone.status, "released");
    if (!quorum.met)
      throw new DomainError("QUORUM_NOT_MET", `Milestone ${milestoneId} not approved: ${quorum.missing.join("; ")}`, quorum);
    if (!milestone.escrow || !fulfillmentMatches(milestone.escrow.condition, fulfillment))
      throw new DomainError("VALIDATION", `Fulfillment does not match the escrow condition for ${milestoneId}`);
    const event = await this.onLedger("releaseMilestone", () => this.ledger.releaseMilestone({ project, milestone, fulfillment }));
    const updated = await this.store.write((db) => {
      const p = getProjectOrThrow(db, projectId);
      const m = getMilestoneOrThrow(p, milestoneId);
      assertMilestoneTransition(m.id, m.status, "released");
      m.status = "released";
      if (m.escrow) m.escrow.finishTx = event.txHash;
      db.chainEvents.push(event);
      return m;
    });
    return { milestone: updated, event };
  }

  /**
   * Stall path: CancelAfter passed -> expired -> EscrowCancel (funds back to SPV) -> SPV LoanPay back to
   * the vault -> project stalled. Investors can then withdraw their share of the returned money.
   */
  async expireMilestone(projectId: string, milestoneId: string): Promise<{ milestone: Milestone; events: ChainEvent[] }> {
    return this.locks.run(`project:${projectId}`, async () => {
      // Step 1: mark expired (persisted, so a failed cancel can be retried).
      const { project, milestone } = await this.store.write((db) => {
        const p = getProjectOrThrow(db, projectId);
        const m = getMilestoneOrThrow(p, milestoneId);
        if (m.status !== "expired") {
          assertMilestoneTransition(m.id, m.status, "expired");
          if (!m.cancelAfter || this.clock.now() < new Date(m.cancelAfter))
            throw new DomainError("ILLEGAL_TRANSITION", `Milestone ${m.id} escrow not expired yet (CancelAfter ${m.cancelAfter ?? "unset"})`);
          m.status = "expired";
        }
        return { project: p, milestone: m };
      });
      // Step 2: EscrowCancel, then LoanPay the refunded money back into the vault.
      const cancelled = await this.onLedger("cancelExpiredMilestone", () => this.ledger.cancelExpiredMilestone({ project, milestone }));
      const repaid = await this.onLedger("repayLoan(escrow_refund)", () =>
        this.ledger.repayLoan({ project, amount: milestone.amount, source: "escrow_refund" }),
      );
      const updated = await this.store.write((db) => {
        const p = getProjectOrThrow(db, projectId);
        const m = getMilestoneOrThrow(p, milestoneId);
        assertMilestoneTransition(m.id, m.status, "refunded");
        m.status = "refunded";
        if (m.escrow) m.escrow.cancelTx = cancelled.txHash;
        db.chainEvents.push(cancelled, repaid);
        db.repayments.push({ projectId, amount: m.amount, source: "escrow_refund", tx: repaid.txHash, at: repaid.at });
        if (p.status === "escrowed" || p.status === "repaying") {
          p.status = "stalled";
          const meta = getMetaOrThrow(db, projectId);
          meta.stalledAt = this.nowIso();
          meta.stalledReason = `Milestone "${m.title}" expired; escrow refunded to the vault`;
        }
        this.maybeComplete(db, p);
        return m;
      });
      return { milestone: updated, events: [cancelled, repaid] };
    });
  }

  /** Expire every milestone whose CancelAfter has passed (cron / admin "fast-forward" button). */
  async sweepExpired(projectId?: string): Promise<{ projectId: string; milestoneId: string }[]> {
    const due = await this.store.read((db) =>
      db.projects
        .filter((p) => !projectId || p.id === projectId)
        .flatMap((p) =>
          p.milestones
            .filter((m) => LOCKED_MILESTONE.includes(m.status) && m.cancelAfter && this.clock.now() >= new Date(m.cancelAfter))
            .map((m) => ({ projectId: p.id, milestoneId: m.id })),
        ),
    );
    for (const d of due) await this.expireMilestone(d.projectId, d.milestoneId);
    return due;
  }

  // ===== loan =====

  /** Builder repays into the SPV, which LoanPays the vault. Fully repaid -> completed. */
  async repayLoan(projectId: string, input: { amount: Rlusd }): Promise<{ project: Project; event: ChainEvent }> {
    const { amount } = parse(z.object({ amount: Rlusd }), input);
    return this.locks.run(`project:${projectId}`, async () => {
      const { project, outstanding } = await this.store.read((db) => {
        const project = getProjectOrThrow(db, projectId);
        return { project, outstanding: vaultPosition(db, project).outstanding };
      });
      assertProjectStatus(projectId, project.status, ["escrowed", "repaying", "stalled"], "repay");
      const amt = toMicro(amount);
      if (amt <= 0n || amt > outstanding)
        throw new DomainError("VALIDATION", `Repayment must be in (0, ${fromMicro(outstanding)}] RLUSD`);
      const event = await this.onLedger("repayLoan", () => this.ledger.repayLoan({ project, amount, source: "builder" }));
      const updated = await this.store.write((db) => {
        const p = getProjectOrThrow(db, projectId);
        db.repayments.push({ projectId, amount, source: "builder", tx: event.txHash, at: event.at });
        db.chainEvents.push(event);
        if (p.status === "escrowed") {
          assertProjectTransition(projectId, p.status, "repaying");
          p.status = "repaying";
        }
        this.maybeComplete(db, p);
        return p;
      });
      return { project: updated, event };
    });
  }

  private maybeComplete(db: DbState, p: Project): void {
    if (p.status !== "repaying" && p.status !== "stalled") return;
    const v = vaultPosition(db, p);
    const allSettled = p.milestones.every((m) => m.status === "released" || m.status === "refunded");
    if (v.outstanding === 0n && allSettled) {
      assertProjectTransition(p.id, p.status, "completed");
      p.status = "completed";
      getMetaOrThrow(db, p.id).completedAt = this.nowIso();
    }
  }

  /** Investor withdraws their pro-rata share of liquid vault assets (default: everything withdrawable). */
  async withdraw(projectId: string, input: { investor: XrplAddress; amount?: Rlusd }): Promise<{ event: ChainEvent; amount: Rlusd }> {
    const data = parse(z.object({ investor: XrplAddress, amount: Rlusd.optional() }), input);
    return this.locks.run(`project:${projectId}`, async () => {
      const { project, pos } = await this.store.read((db) => {
        const project = getProjectOrThrow(db, projectId);
        return { project, pos: investorPosition(db, project, data.investor) };
      });
      const allowed: ProjectStatus[] = ["stalled", "repaying", "completed", "escrowed"];
      assertProjectStatus(projectId, project.status, allowed, "withdraw");
      const amt = data.amount ? toMicro(data.amount) : pos.withdrawable;
      if (amt <= 0n || amt > pos.withdrawable)
        throw new DomainError("VALIDATION", `Withdrawable for ${data.investor} is ${fromMicro(pos.withdrawable)} RLUSD`);
      const amount = fromMicro(amt);
      const event = await this.onLedger("withdrawFromVault", () =>
        this.ledger.withdrawFromVault({ project, investor: data.investor, amount }),
      );
      await this.store.write((db) => {
        db.withdrawals.push({ projectId, investor: data.investor, amount, tx: event.txHash, at: event.at });
        db.chainEvents.push(event);
      });
      return { event, amount };
    });
  }
}
