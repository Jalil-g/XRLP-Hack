// Mock mode: fixtures match the 05-api schemas exactly, and routes 2 / 10 / 18 behave like core.
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { ApiError, api } from "../lib/api.ts";
import { ADDR } from "../lib/mock/fixtures.ts";
import { mockControl } from "../lib/mock/backend.ts";
import { Inspector, InspectorTask, ProjectDetail, SubmitAuditResult, type InspectorAudit } from "../lib/types.ts";

const report = (inspector: string, milestoneId: string, codes: string[]): InspectorAudit => ({
  milestoneId,
  inspector,
  evidenceBundleHash: "ab".repeat(32),
  checklist: codes.map((sovCode) => ({ sovCode, status: "done" as const })),
  photos: [],
  notes: "Matches SoV.",
  at: "2026-10-25T10:00:00Z",
});

/** Parsing must not add, drop or coerce anything: the fixture IS the contract shape. */
function assertExact<T>(schema: { parse(v: unknown): T }, value: unknown) {
  assert.deepEqual(schema.parse(value), value);
}

beforeEach(() => {
  mockControl.reset();
  mockControl.setLatency(0);
});

describe("fixtures match docs/05-api.md", () => {
  it("route 18a: panel of 3 verified inspectors", async () => {
    const panel = await api.listInspectors();
    assertExact(Inspector.array(), panel);
    assert.equal(panel.length, 3);
    assert.ok(panel.every((i) => i.verified && i.credentialTx));
  });

  it("route 2: every project parses as ProjectDetail", async () => {
    for (const id of ["maple-st-duplex", "rhinebeck-farmhouse", "elm-ct-fourplex"]) assertExact(ProjectDetail, await api.getProject(id));
  });

  it("route 18b: every queue parses as InspectorTask[]", async () => {
    for (const a of [ADDR.dana, ADDR.marcus, ADDR.priya]) assertExact(InspectorTask.array(), await api.getQueue(a));
  });

  it("SoV lines of each milestone sum to its amount", async () => {
    for (const id of ["maple-st-duplex", "rhinebeck-farmhouse"]) {
      const { project } = await api.getProject(id);
      for (const m of project.milestones) {
        const sum = (project.sov ?? []).filter((l) => m.sovCodes?.includes(l.code)).reduce((s, l) => s + Number(l.amount), 0);
        assert.equal(sum, Number(m.amount), m.id);
      }
    }
  });
});

describe("route 18: queue", () => {
  it("covers every `needs` value across the panel", async () => {
    const needs = async (a: string) => (await api.getQueue(a)).map((t) => `${t.milestone?.id ?? t.projectId}=${t.needs}`);
    assert.deepEqual(await needs(ADDR.dana), [
      "maple-st-duplex:m1=audit",
      "maple-st-duplex:m2=audit",
      "maple-st-duplex:m3=none",
      "elm-ct-fourplex=pre_visit",
    ]);
    assert.deepEqual(await needs(ADDR.marcus), ["rhinebeck-farmhouse:m1=re_audit", "rhinebeck-farmhouse:m2=none"]);
    assert.deepEqual(await needs(ADDR.priya), []);
  });

  it("task carries only its milestone's SoV lines and builder evidence", async () => {
    const [m1] = await api.getQueue(ADDR.dana);
    assert.deepEqual(m1?.sov.map((l) => l.code), ["02-100", "03-100", "03-300"]);
    assert.ok(m1?.evidence.length && m1.evidence.every((e) => e.id.startsWith("maple-st-duplex:m1:")));
  });

  it("unknown inspector → not_found", async () => {
    await assert.rejects(api.getQueue("rUnknownUnknownUnknownUnknown1"), (e) => e instanceof ApiError && e.code === "not_found");
  });
});

describe("route 10: submit audit", () => {
  it("files the audit: milestone audited, audit_attested event, task leaves the queue", async () => {
    const res = await api.submitAudit({
      projectId: "maple-st-duplex",
      milestoneId: "maple-st-duplex:m1",
      report: report(ADDR.dana, "maple-st-duplex:m1", ["02-100", "03-100", "03-300"]),
      photos: [],
      signedTxBlob: "1200032200000000",
    });
    assertExact(SubmitAuditResult, res);
    assert.equal(res.milestone.status, "audited");
    assert.equal(res.events[0]?.kind, "audit_attested");
    assert.equal(res.audit.txHash, res.events[0]?.txHash);
    assert.equal(res.events[0]?.explorerUrl, `https://devnet.xrpl.org/transactions/${res.audit.txHash}`);

    const task = (await api.getQueue(ADDR.dana)).find((t) => t.milestone?.id === "maple-st-duplex:m1");
    assert.equal(task?.needs, "none");
    assert.equal(task?.priorAudits.length, 1);
    const detail = await api.getProject("maple-st-duplex");
    assert.equal(detail.audits["maple-st-duplex:m1"]?.[0]?.txHash, res.audit.txHash);
    assert.equal(detail.events[0]?.kind, "audit_attested");
  });

  it("rejects an inspector who is not assigned", async () => {
    const r = report(ADDR.marcus, "maple-st-duplex:m1", ["03-100"]);
    await assert.rejects(
      api.submitAudit({ projectId: "maple-st-duplex", milestoneId: "maple-st-duplex:m1", report: r, photos: [] }),
      (e) => e instanceof ApiError && e.code === "validation",
    );
  });

  it("rejects checklist lines from another milestone, and a second audit", async () => {
    const input = (codes: string[]) => ({ projectId: "maple-st-duplex", milestoneId: "maple-st-duplex:m1", report: report(ADDR.dana, "maple-st-duplex:m1", codes), photos: [] });
    await assert.rejects(api.submitAudit(input(["06-100"])), (e) => e instanceof ApiError && e.code === "validation");
    await api.submitAudit(input(["03-100"]));
    await assert.rejects(api.submitAudit(input(["03-100"])), (e) => e instanceof ApiError && e.code === "invalid_state");
  });

  it("re-audit supersedes the inspector's earlier audit", async () => {
    const res = await api.submitAudit({
      projectId: "rhinebeck-farmhouse",
      milestoneId: "rhinebeck-farmhouse:m1",
      report: { ...report(ADDR.marcus, "rhinebeck-farmhouse:m1", ["02-410", "22-100", "26-100"]), checklist: [{ sovCode: "26-100", status: "partial", note: "Conductors missing at 2 boxes" }] },
      photos: [],
    });
    assert.equal(res.milestone.status, "audited");
    const { audits } = await api.getProject("rhinebeck-farmhouse");
    assert.equal(audits["rhinebeck-farmhouse:m1"]?.length, 1);
    assert.equal(audits["rhinebeck-farmhouse:m1"]?.[0]?.checklist[0]?.status, "partial");
    const task = (await api.getQueue(ADDR.marcus)).find((t) => t.milestone?.id === "rhinebeck-farmhouse:m1");
    assert.equal(task?.needs, "none");
  });
});
