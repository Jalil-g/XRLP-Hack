import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { api } from "../lib/api.ts";
import { buildAudit, emptyDraft, evidenceBundleHash, photoEvidence } from "../lib/audit.ts";
import { bundleComparison, latestOwnAudit, reviewIssues } from "../lib/re-audit.ts";
import { mockControl } from "../lib/mock/backend.ts";
import { ADDR, AUDITS, EVIDENCE } from "../lib/mock/fixtures.ts";
import { inspectorKey, signAuditAttestation } from "../lib/signing.ts";

const projectId = "rhinebeck-farmhouse";
const milestoneId = `${projectId}:m1`;
const review = () => api.getAuditReview(ADDR.marcus, projectId, milestoneId);

beforeEach(() => { mockControl.reset(); mockControl.setLatency(0); });

describe("re-audit review", () => {
  it("loads the failed suite and warning, with current evidence and the inspector's previous report", async () => {
    const { task, checks } = (await review())!;
    assert.equal(task.needs, "re_audit");
    assert.deepEqual(reviewIssues(checks).map((c) => [c.check, c.result, c.required]), [
      ["audit_matches_evidence", "fail", true], ["stage_visually_consistent", "warn", true],
    ]);
    assert.match(reviewIssues(checks)[0]!.reason, /no conductors/);
    assert.equal(bundleComparison(await evidenceBundleHash(task.evidence), latestOwnAudit(task, ADDR.marcus)?.evidenceBundleHash), "same");
    assert.deepEqual(emptyDraft(task).photos, []);
    assert.ok(Object.values(emptyDraft(task).checklist).every((line) => !line.status));
  });

  it("selects the latest own report by timestamp without assuming API array order or including other inspectors", async () => {
    const { task } = (await review())!;
    const old = task.priorAudits[0]!;
    const newer = { ...old, at: "2026-10-24T20:00:00Z", notes: "Newer" };
    task.priorAudits = [newer, { ...newer, inspector: ADDR.dana, at: "2026-10-25T20:00:00Z" }, old];
    assert.equal(latestOwnAudit(task, ADDR.marcus), newer);
    assert.equal(task.priorAudits[0], newer);
    assert.equal(latestOwnAudit(task, ADDR.priya), undefined);
  });

  it("keeps unknown comparisons and absent checks distinct from unchanged evidence or passing checks", () => {
    assert.equal(bundleComparison("invalid", "cd".repeat(32)), "unknown");
    assert.equal(bundleComparison(undefined, "cd".repeat(32)), "unknown");
    assert.equal(bundleComparison("AB".repeat(32), "ab".repeat(32)), "same");
    assert.equal(bundleComparison("ab".repeat(32), "cd".repeat(32)), "changed");
    assert.deepEqual(reviewIssues(undefined), []);
    assert.deepEqual(reviewIssues({ outcome: "needs_human", required: [], optional: [{ check: "optional", result: "warn", reason: "Review", evidenceIds: [] }] }).map((c) => c.required), [false]);
  });

  it("does not return another inspector's task", async () => {
    assert.equal(await api.getAuditReview(ADDR.dana, projectId, milestoneId), null);
  });

  it("reloads resubmitted files, rejects a stale signed report, and replaces only the submitting inspector's report", async (t) => {
    // A second inspector's existing report must survive Marcus's replacement.
    const other = { ...AUDITS[milestoneId]![0]!, inspector: ADDR.dana };
    AUDITS[milestoneId]!.push(other);
    t.after(() => { AUDITS[milestoneId]!.pop(); mockControl.reset(); });
    mockControl.reset();
    const { task: before } = (await review())!;
    const file = new Blob(["new inspector photo"], { type: "image/jpeg" });
    const photo = await photoEvidence(file, "2026-10-25T04:00:00Z");
    const draft = { ...emptyDraft(before), checklist: Object.fromEntries(before.sov.map((s) => [s.code, {
      status: s.code === "26-100" ? "partial" as const : "done" as const,
      note: s.code === "26-100" ? "Conductors still missing at two boxes." : "",
    }])), photos: [{ file, evidence: photo }], notes: "Re-inspected the missing conductors." };
    const key = (await inspectorKey(ADDR.marcus))!;
    const stale = await buildAudit({ ...before, milestone: before.milestone! }, ADDR.marcus, draft, "2026-10-25T04:00:00Z");
    const signedStale = await signAuditAttestation(stale, before.milestone!.escrow!.owner, key);
    const resubmitted = { ...EVIDENCE[milestoneId]![0]!, id: "new-photo", filename: "resubmitted-electrical.jpg", sha256: "ab".repeat(32), uploadedAt: "2026-10-25T03:59:00Z" };
    mockControl.replaceEvidence(projectId, milestoneId, [resubmitted]);
    await assert.rejects(api.submitAudit({ projectId, milestoneId, report: stale, photos: [file], signedTxBlob: signedStale.blob }), /evidenceBundleHash/);
    assert.equal((await api.getProject(projectId)).audits[milestoneId]!.length, 2);
    assert.equal((await api.getProject(projectId)).checks[milestoneId]!.outcome, "fail");

    const { task } = (await review())!;
    assert.equal(task.evidence[0]!.filename, "resubmitted-electrical.jpg");
    assert.equal(bundleComparison(await evidenceBundleHash(task.evidence), latestOwnAudit(task, ADDR.marcus)?.evidenceBundleHash), "changed");
    const report = await buildAudit({ ...task, milestone: task.milestone! }, ADDR.marcus, draft, "2026-10-25T04:01:00Z");
    const signed = await signAuditAttestation(report, task.milestone!.escrow!.owner, key);
    const result = await api.submitAudit({ projectId, milestoneId, report, photos: [file], signedTxBlob: signed.blob });
    const detail = await api.getProject(projectId);
    assert.equal(result.audit.txHash, signed.txHash);
    assert.equal(detail.audits[milestoneId]!.length, 2);
    assert.deepEqual(detail.audits[milestoneId]!.find((a) => a.inspector === ADDR.dana), other);
    assert.equal(detail.audits[milestoneId]!.find((a) => a.inspector === ADDR.marcus)!.txHash, signed.txHash);
    assert.deepEqual(detail.checks[milestoneId], { required: [], optional: [], outcome: "pending" });
    assert.equal(detail.attestations[milestoneId]!.at(-1)!.txHash, signed.txHash);
    assert.ok(detail.attestations[milestoneId]!.some((a) => a.txHash === before.priorAudits[0]!.txHash));
    assert.equal(result.milestone.escrow?.finishTx, undefined);
    assert.equal((await review())!.task.needs, "none");
    await assert.rejects(api.submitAudit({ projectId, milestoneId, report, photos: [file], signedTxBlob: signed.blob }), /no audit is due/);
  });
});
