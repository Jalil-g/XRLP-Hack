// Persistence. Whole-DB transactional interface: `write(fn)` runs fn on a private copy and commits
// only if fn returns without throwing. Small data, so the JSON file is re-read on every call
// (keeps the HTTP server / the seed script / the CLI consistent without a cache).
import type {
  Attestation,
  Builder,
  BuilderDocument,
  ChainEvent,
  Evidence,
  Inspector,
  InspectorAssignment,
  InspectorAudit,
  Investment,
  Project,
  ProjectVerification,
  ReleasePolicy,
  Rlusd,
  Verdict,
  XrplAddress,
} from "@xrlp/shared";
import type { InspectorSiteVisit } from "./site-visit.ts";

export interface InvestorProfile {
  address: XrplAddress;
  name: string;
  kycCredentialTx?: string;
  createdAt: string;
}

/** Project fields not in the shared Project schema. */
export interface ProjectMeta {
  projectId: string;
  documents: BuilderDocument[];
  createdAt: string;
  verificationFee?: { amount: Rlusd; tx: string; at: string };
  /** AI verification said needs_human: a panel inspector does a pre-construction visit. */
  preVisitRequested?: boolean;
  /** Route 24 reports. `signedByInspector: false` = core attested it with the platform key on the inspector's behalf. */
  siteVisits?: (InspectorSiteVisit & { hash: string; signedByInspector: boolean })[];
  assignment?: InspectorAssignment & { at: string; tx?: string };
  verifiedAt?: string;
  fundingOpenedAt?: string;
  escrowedAt?: string;
  /** Partial close (LoanSet applied, some EscrowCreate failed): milestones still without an escrow; RLUSD sits in the SPV. */
  closePending?: string[];
  completedAt?: string;
  stalledAt?: string;
  /** Write-ahead marker per milestone id: a refund LoanPay was attempted and its outcome is not yet recorded. */
  refundAttempts?: Record<string, { at: string; tvoBefore?: Rlusd; txHash?: string }>;
}

/** `round` = 1-based evidence submission round for the milestone (resubmission after a failure = new round). */
export type EvidenceRecord = Evidence & { projectId: string; milestoneId: string; round: number };
export type AuditRecord = InspectorAudit & { projectId: string; round: number };
export type VerdictRecord = Verdict & { projectId: string; round: number; verdictHash: string; policy2: ReleasePolicy; txHash?: string };
export type VerificationRecord = ProjectVerification & { projectId: string; verificationHash: string; txHash?: string };
export interface DecisionRecord {
  projectId: string;
  milestoneId: string;
  round: number;
  actor: XrplAddress;
  decision: "approve" | "reject";
  reason: string;
  txHash: string;
  at: string;
}
export type AttestationRecord = Attestation & { projectId: string; round: number };

export interface Withdrawal {
  /** Whole share units burned; absent in legacy records that require reconciliation. */
  sharesBurned?: string;
  projectId: string;
  investor: XrplAddress;
  amount: Rlusd;
  tx: string;
  at: string;
}

export interface Repayment {
  projectId: string;
  milestoneId?: string;
  amount: Rlusd;
  source: "builder" | "escrow_refund";
  tx: string;
  at: string;
}

export interface DbState {
  version: 2;
  builders: Builder[];
  investors: InvestorProfile[];
  inspectors: Inspector[];
  projects: Project[];
  projectMeta: ProjectMeta[];
  verifications: VerificationRecord[];
  investments: Investment[];
  withdrawals: Withdrawal[];
  repayments: Repayment[];
  evidence: EvidenceRecord[];
  audits: AuditRecord[];
  verdicts: VerdictRecord[];
  decisions: DecisionRecord[];
  attestations: AttestationRecord[];
  chainEvents: ChainEvent[];
}

export const emptyDb = (): DbState => ({
  version: 2,
  builders: [],
  investors: [],
  inspectors: [],
  projects: [],
  projectMeta: [],
  verifications: [],
  investments: [],
  withdrawals: [],
  repayments: [],
  evidence: [],
  audits: [],
  verdicts: [],
  decisions: [],
  attestations: [],
  chainEvents: [],
});

/**
 * CORE-08: what makes two ChainEvents the same fact. Not the hash alone: one tx may back events of a different kind,
 * project or milestone, and each of those is history worth keeping. Only an exact repeat (a retry or reconcile recording
 * a tx again, a re-imported prestage) collapses. Hex hashes compare case-insensitively. No txHash -> no key.
 */
export function chainEventKey(e: ChainEvent): string | undefined {
  if (!e.txHash) return undefined;
  return JSON.stringify([e.txHash.toUpperCase(), e.kind, e.projectId, e.milestoneId ?? null]);
}

/**
 * The only way core appends to `db.chainEvents`: skips an event whose key is already recorded (or repeated in `events`),
 * so the first recording wins. Events without a txHash are always appended. Returns the events actually added.
 */
export function recordChainEvents(db: DbState, events: readonly ChainEvent[]): ChainEvent[] {
  const seen = new Set<string>();
  for (const e of db.chainEvents) {
    const k = chainEventKey(e);
    if (k) seen.add(k);
  }
  const added: ChainEvent[] = [];
  for (const e of events) {
    const k = chainEventKey(e);
    if (k) {
      if (seen.has(k)) continue;
      seen.add(k);
    }
    db.chainEvents.push(e);
    added.push(e);
  }
  return added;
}

/** Fill in collections missing from older files. v1 inspector profiles become panel inspectors; v1-only collections are dropped. */
export function normalizeDb(raw: Partial<DbState> & Record<string, unknown>): DbState {
  const base = emptyDb();
  const out = { ...base } as DbState;
  for (const k of Object.keys(base) as (keyof DbState)[]) {
    if (k === "version") continue;
    const v = raw[k];
    if (Array.isArray(v)) (out as unknown as Record<string, unknown>)[k] = v;
  }
  out.inspectors = out.inspectors.map((i) => ({
    address: i.address,
    name: i.name,
    licenseNumber: i.licenseNumber,
    trades: i.trades ?? [],
    homeGeo: i.homeGeo,
    verified: i.verified ?? true,
    credentialTx: i.credentialTx,
  }));
  out.projectMeta = out.projectMeta.map((m) => ({ ...m, documents: m.documents ?? [] }));
  return out;
}

export interface Store {
  /** Read-only view (a copy — mutations are discarded). */
  read<T>(fn: (db: DbState) => T): Promise<T>;
  /** Serialized read-modify-write. Commits atomically iff fn does not throw. */
  write<T>(fn: (db: DbState) => T): Promise<T>;
  /** Replace everything (seed/reset). */
  reset(db?: DbState): Promise<void>;
}

/** Serializes async tasks (one writer at a time within this process). */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

export class MemoryStore implements Store {
  private db: DbState;
  private queue = new SerialQueue();
  constructor(initial: DbState = emptyDb()) {
    this.db = structuredClone(initial);
  }
  async read<T>(fn: (db: DbState) => T): Promise<T> {
    return fn(structuredClone(this.db));
  }
  write<T>(fn: (db: DbState) => T): Promise<T> {
    return this.queue.run(async () => {
      const draft = structuredClone(this.db);
      const out = fn(draft);
      this.db = draft;
      return out;
    });
  }
  async reset(db: DbState = emptyDb()): Promise<void> {
    await this.queue.run(async () => {
      this.db = structuredClone(db);
    });
  }
}
