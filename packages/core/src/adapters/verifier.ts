// CORE-05 · @xrlp/verifier's ClaudeVerifierAdapter behind core's VerifierPort (VERIFIER_MODE=mock|live).
// Core-side glue only: uploaded files live at `${DATA_DIR}/files/<fileId>` but Evidence.uri is the HTTP path
// "/api/files/<fileId>", and the verifier needs the server-owned inspector assignment (never from audit notes).
import { join } from "node:path";
import type { Evidence, InspectorAssignment, Milestone, Project, ProjectVerification, ReleasePolicy, Verdict, VerifierPort, VerifyMilestoneInput, VerifyProjectInput } from "@xrlp/shared";
import { ClaudeVerifierAdapter, type PriorEvidence } from "@xrlp/verifier";
import { assignedInspectors } from "../read-models.ts";
import type { Store } from "../store.ts";

const FILE_URI = /^\/api\/files\/([a-f0-9-]{36})$/;

/** "/api/files/<id>" -> absolute path under DATA_DIR; data: URLs and anything else pass through. */
export function evidencePath(uri: string, dataDir: string): string {
  const m = FILE_URI.exec(uri);
  return m ? join(dataDir, "files", m[1]!) : uri;
}

export class CoreVerifierAdapter implements VerifierPort {
  readonly mode: "mock" | "live";
  readonly inner: ClaudeVerifierAdapter;
  constructor(private readonly opts: { mode: "mock" | "live"; dataDir?: string; store: Store; model?: string; now?: () => string }) {
    this.inner = new ClaudeVerifierAdapter({
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
    const assigned = await this.opts.store.read((db) => assignedInspectors(db, input.project.id));
    return this.inner.verifyMilestone({
      ...input,
      evidence: input.evidence.map((e) => this.local(e)),
      priorEvidence: input.priorEvidence.map((e) => this.prior(e)),
      audits: input.audits.map((a) => ({ ...a, photos: a.photos.map((p) => this.local(p)) })),
      assignedInspectors: assigned,
    });
  }
  policyFor(project: Project, milestone: Milestone): ReleasePolicy {
    return this.inner.policyFor(project, milestone);
  }
  verdictHash(v: Verdict): string {
    return this.inner.verdictHash(v);
  }
}
