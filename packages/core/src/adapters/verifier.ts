// CORE-05 · @xrlp/verifier's ClaudeVerifierAdapter behind core's VerifierPort (VERIFIER_MODE=mock|live).
// Core-side glue only: uploaded files live at `${DATA_DIR}/files/<fileId>` but Evidence.uri is the HTTP path
// "/api/files/<fileId>", and the verifier needs the server-owned inspector assignment (never from audit notes).
// The release policy's risk tier is the STORED builder's riskTier (route 5 / route 25 / prestage write it), not the
// verifier's process-local memory: after a restart or for prestaged projects the inner adapter would not know it.
import { join } from "node:path";
import type { Evidence, InspectorAssignment, Milestone, Project, ProjectVerification, ReleasePolicy, RiskTier, Verdict, VerifierPort, VerifyMilestoneInput, VerifyProjectInput } from "@xrlp/shared";
import { ClaudeVerifierAdapter, releasePolicyFor, type PriorEvidence } from "@xrlp/verifier";
import { assignedInspectors } from "../read-models.ts";
import { emptyDb, type DbState, type Store } from "../store.ts";

const FILE_URI = /^\/api\/files\/([a-f0-9-]{36})$/;

/** "/api/files/<id>" -> absolute path under DATA_DIR; data: URLs and anything else pass through. */
export function evidencePath(uri: string, dataDir: string): string {
  const m = FILE_URI.exec(uri);
  return m ? join(dataDir, "files", m[1]!) : uri;
}

/**
 * builderId -> stored riskTier, kept current by every store read and committed write that goes through `track(store)`.
 * `policyFor` is synchronous (VerifierPort), so it cannot read the store itself; every service call that needs a policy
 * reads the project from the store first, which refreshes this cache.
 */
export class BuilderRiskTiers {
  private byBuilder = new Map<string, RiskTier>();
  note(db: Pick<DbState, "builders">): void {
    this.byBuilder = new Map(db.builders.map((b) => [b.id, b.riskTier]));
  }
  forProject(project: Pick<Project, "builderId">): RiskTier | undefined {
    return this.byBuilder.get(project.builderId);
  }
  /** Store decorator: same semantics, plus the cache refresh. */
  track(store: Store): Store {
    return {
      read: (fn) => store.read((db) => (this.note(db), fn(db))),
      write: (fn) =>
        store.write((db) => {
          const out = fn(db);
          this.note(db);
          return out;
        }),
      reset: async (db) => {
        await store.reset(db);
        this.note(db ?? emptyDb());
      },
    };
  }
}

export class CoreVerifierAdapter implements VerifierPort {
  readonly mode: "mock" | "live";
  readonly inner: ClaudeVerifierAdapter;
  readonly tiers = new BuilderRiskTiers();
  /** `opts.store` with risk-tier tracking. createCore hands THIS store to the service. */
  readonly store: Store;
  constructor(private readonly opts: { mode: "mock" | "live"; dataDir?: string; store: Store; model?: string; now?: () => string }) {
    this.store = this.tiers.track(opts.store);
    this.inner = new ClaudeVerifierAdapter({
      riskTier: (project) => this.tiers.forProject(project),
      mode: opts.mode,
      ...(opts.dataDir ? { dataDir: opts.dataDir } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    });
    this.mode = opts.mode;
  }

  private local<E extends Evidence>(e: E): E {
    return this.opts.dataDir ? { ...e, uri: evidencePath(e.uri, this.opts.dataDir) } : e;
  }

  /** Core's prior-evidence records carry projectId/milestoneId/projectName: hand them over as @xrlp/verifier PriorEvidence
   *  (plain Evidence reads as "previously submitted evidence" from project "unknown"). */
  private prior(e: Evidence): PriorEvidence | Evidence {
    const { projectId, milestoneId, projectName, round: _r, ...evidence } = e as Evidence & { projectId?: string; milestoneId?: string; projectName?: string; round?: number };
    if (!projectId || !milestoneId) return this.local(e);
    return { evidence: this.local(evidence as Evidence), projectId, milestoneId, ...(projectName ? { projectName } : {}) };
  }

  verifyProject(input: VerifyProjectInput): Promise<ProjectVerification> {
    return this.inner.verifyProject(input);
  }
  assignInspector(input: Parameters<VerifierPort["assignInspector"]>[0]): Promise<InspectorAssignment> {
    return this.inner.assignInspector(input);
  }
  async verifyMilestone(input: VerifyMilestoneInput): Promise<Verdict> {
    const assigned = await this.store.read((db) => assignedInspectors(db, input.project.id));
    return this.inner.verifyMilestone({
      ...input,
      evidence: input.evidence.map((e) => this.local(e)),
      priorEvidence: input.priorEvidence.map((e) => this.prior(e)),
      audits: input.audits.map((a) => ({ ...a, photos: a.photos.map((p) => this.local(p)) })),
      assignedInspectors: assigned,
    });
  }
  policyFor(project: Project, milestone: Milestone): ReleasePolicy {
    // The stored tier wins over the inner adapter's in-process memory (which says "high" after any non-pass verification,
    // even once the operator approved the project, and is empty after a restart).
    const tier = this.tiers.forProject(project);
    return tier ? releasePolicyFor(project, milestone, tier) : this.inner.policyFor(project, milestone);
  }
  verdictHash(v: Verdict): string {
    return this.inner.verdictHash(v);
  }
}
