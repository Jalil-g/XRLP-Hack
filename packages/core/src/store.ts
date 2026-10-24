// Persistence. Whole-DB transactional interface: `write(fn)` runs fn on a private copy and commits
// only if fn returns without throwing. Small data, so the JSON file is re-read on every call
// (keeps Next.js workers / the seed script / the CLI consistent without a cache).
import type {
  Attestation,
  Builder,
  ChainEvent,
  Evidence,
  Investment,
  Project,
  Rlusd,
  Verdict,
  XrplAddress,
} from "@xrlp/shared";
import type { BuilderDocument, BuilderVerification } from "./ports.ts";

export interface InvestorProfile {
  address: XrplAddress;
  name: string;
  kycCredentialTx?: string;
  createdAt: string;
}

export interface InspectorProfile {
  address: XrplAddress;
  name: string;
  licenseNumber: string;
  createdAt: string;
}

/** Project fields not in the shared Project schema. */
export interface ProjectMeta {
  projectId: string;
  inspectors: XrplAddress[];
  /** PUBLIC escrow conditions supplied by the condition-holding inspector (fulfillments are never stored). */
  conditions: { milestoneId: string; condition: string; holder: XrplAddress; at: string }[];
  createdAt: string;
  termsLockedAt?: string;
  fundingOpenedAt?: string;
  escrowedAt?: string;
  completedAt?: string;
  stalledAt?: string;
  stalledReason?: string;
}

export interface BuilderReview {
  builderId: string;
  documents: BuilderDocument[];
  result: BuilderVerification;
  at: string;
}

/** `round` = 1-based evidence submission round for the milestone (resubmission after rejection = new round). */
export type EvidenceRecord = Evidence & { projectId: string; milestoneId: string; round: number };
export type VerdictRecord = Verdict & { projectId: string; round: number };
export type AttestationRecord = Attestation & { projectId: string; round: number };

export interface Withdrawal {
  projectId: string;
  investor: XrplAddress;
  amount: Rlusd;
  tx: string;
  at: string;
}

export interface Repayment {
  projectId: string;
  amount: Rlusd;
  source: "builder" | "escrow_refund";
  tx: string;
  at: string;
}

export interface DbState {
  version: 1;
  builders: Builder[];
  builderReviews: BuilderReview[];
  investors: InvestorProfile[];
  inspectors: InspectorProfile[];
  projects: Project[];
  projectMeta: ProjectMeta[];
  investments: Investment[];
  withdrawals: Withdrawal[];
  repayments: Repayment[];
  evidence: EvidenceRecord[];
  verdicts: VerdictRecord[];
  attestations: AttestationRecord[];
  chainEvents: ChainEvent[];
}

export const emptyDb = (): DbState => ({
  version: 1,
  builders: [],
  builderReviews: [],
  investors: [],
  inspectors: [],
  projects: [],
  projectMeta: [],
  investments: [],
  withdrawals: [],
  repayments: [],
  evidence: [],
  verdicts: [],
  attestations: [],
  chainEvents: [],
});

/** Fill in collections missing from older files. */
export const normalizeDb = (raw: Partial<DbState>): DbState => ({ ...emptyDb(), ...raw, version: 1 });

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
