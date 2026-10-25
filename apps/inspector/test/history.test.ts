import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { api } from "../lib/api.ts";
import { evidenceBundleHash } from "../lib/audit.ts";
import { AUDIT_CHECKS, auditHistory } from "../lib/history.ts";
import { mockControl } from "../lib/mock/backend.ts";
import { ADDR, EVIDENCE } from "../lib/mock/fixtures.ts";

beforeEach(() => {
  mockControl.reset();
  mockControl.setLatency(0);
});

describe("audit history", () => {
  it("includes completed projects, loads each project once, and selects only the active inspector's reports", async () => {
    const details = await api.getAuditHistory(ADDR.dana);
    assert.deepEqual(details.map((d) => d.project.id), ["maple-st-duplex", "oak-ave-rowhouse", "elm-ct-fourplex"]);
    const entries = auditHistory([...details, await api.getProject("rhinebeck-farmhouse")], ADDR.dana);
    assert.equal(entries.length, 1);
    assert.equal(entries[0]!.project.id, "oak-ave-rowhouse");
    assert.equal(entries[0]!.checks.outcome, "pass");
    assert.ok(entries[0]!.releaseTx);
    assert.equal(entries[0]!.verdictPredatesAudit, false);
    for (const id of AUDIT_CHECKS) assert.equal(entries[0]!.checks.required.find((c) => c.check === id)?.result, "pass");
  });

  it("shows Marcus's failed check and no release, and Priya has an empty history", async () => {
    const [entry] = auditHistory(await api.getAuditHistory(ADDR.marcus), ADDR.marcus);
    assert.equal(entry!.checks.outcome, "fail");
    assert.equal(entry!.checks.required.find((c) => c.check === "audit_matches_evidence")?.result, "fail");
    assert.equal(entry!.releaseTx, undefined);
    assert.deepEqual(await api.getAuditHistory(ADDR.priya), []);
  });

  it("a new submission appears first, with pending checks and its attestation hash", async () => {
    const milestoneId = "maple-st-duplex:m1";
    const { audit } = await api.submitAudit({
      projectId: "maple-st-duplex", milestoneId, photos: [],
      report: {
        milestoneId, inspector: ADDR.dana, at: "2026-10-25T03:00:00Z", notes: "Site complete", photos: [],
        evidenceBundleHash: await evidenceBundleHash(EVIDENCE[milestoneId]!),
        checklist: ["02-100", "03-100", "03-300"].map((sovCode) => ({ sovCode, status: "done" })),
      },
    });
    const entries = auditHistory(await api.getAuditHistory(ADDR.dana), ADDR.dana);
    assert.equal(entries.length, 2);
    assert.equal(entries[0]!.milestone.id, milestoneId);
    assert.equal(entries[0]!.audit.txHash, audit.txHash);
    assert.equal(entries[0]!.checks.outcome, "pending");
    assert.equal(entries[0]!.releaseTx, undefined);
  });

  it("does not attribute an older verdict to a later re-audit", async () => {
    const detail = await api.getProject("rhinebeck-farmhouse");
    const audit = detail.audits["rhinebeck-farmhouse:m1"]![0]!;
    detail.audits[audit.milestoneId]!.push({ ...audit, at: "2026-10-25T03:00:00Z", txHash: undefined });
    const entries = auditHistory([detail], ADDR.marcus);
    assert.equal(entries.length, 2);
    assert.equal(entries[0]!.verdictPredatesAudit, true);
    assert.equal(entries[1]!.verdictPredatesAudit, false);
  });

  it("falls back to successful release events scoped to the milestone, ignoring failed transactions", async () => {
    const detail = await api.getProject("oak-ave-rowhouse");
    const expected = detail.project.milestones[0]!.escrow!.finishTx;
    delete detail.project.milestones[0]!.escrow!.finishTx;
    assert.equal(auditHistory([detail], ADDR.dana)[0]!.releaseTx, expected);
    const release = detail.events.find((e) => e.kind === "escrow_finished")!;
    release.result = "tecNO_PERMISSION";
    assert.equal(auditHistory([detail], ADDR.dana)[0]!.releaseTx, undefined);
    release.result = "tesSUCCESS";
    release.milestoneId = "another-milestone";
    assert.equal(auditHistory([detail], ADDR.dana)[0]!.releaseTx, undefined);
  });

  it("missing checks are pending, never an inferred pass", async () => {
    const detail = await api.getProject("oak-ave-rowhouse");
    detail.checks = {};
    const [entry] = auditHistory([detail], ADDR.dana);
    assert.equal(entry!.checks.outcome, "pending");
    assert.deepEqual(entry!.checks.required, []);
  });

  it("seeded audits commit to the builder evidence displayed for their milestone", async () => {
    for (const address of [ADDR.dana, ADDR.marcus]) {
      for (const { audit } of auditHistory(await api.getAuditHistory(address), address)) {
        assert.equal(audit.evidenceBundleHash, await evidenceBundleHash(EVIDENCE[audit.milestoneId]!));
      }
    }
  });
});
