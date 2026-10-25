// http mode against a stub core: paths, multipart fields, error envelope (05-api §1) and drift warnings.
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

type Seen = { method?: string; url?: string; contentType?: string; form?: FormData };
const seen: Seen[] = [];
let reply: (req: IncomingMessage) => { status: number; body: unknown } = () => ({ status: 200, body: [] });

const server = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const contentType = req.headers["content-type"];
  const form = contentType?.startsWith("multipart/")
    ? await new Response(Buffer.concat(chunks), { headers: { "content-type": contentType } }).formData()
    : undefined;
  seen.push({ method: req.method, url: req.url, contentType, form });
  const { status, body } = reply(req);
  res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
});

let api: typeof import("../lib/api.ts").api;
let ApiError: typeof import("../lib/api.ts").ApiError;
let fx: typeof import("../lib/mock/fixtures.ts");

before(async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.NEXT_PUBLIC_API_MODE = "http";
  process.env.CORE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  ({ api, ApiError } = await import("../lib/api.ts"));
  fx = await import("../lib/mock/fixtures.ts");
});
after(() => server.close());

describe("http client", () => {
  it("is in http mode and hits the 05-api paths", async () => {
    assert.equal(api.mode, "http");
    reply = () => ({ status: 200, body: fx.INSPECTORS });
    assert.equal((await api.listInspectors()).length, 3);
    reply = () => ({ status: 200, body: [] });
    await api.getQueue(fx.ADDR.dana);
    assert.deepEqual(
      seen.slice(-2).map((s) => `${s.method} ${s.url}`),
      ["GET /api/inspectors", `GET /api/inspectors/${fx.ADDR.dana}/queue`],
    );
  });

  it("route 10 posts multipart report + photos + signedTxBlob", async () => {
    const milestone = fx.PROJECTS[0]!.milestones[0]!;
    const report = {
      milestoneId: milestone.id,
      inspector: fx.ADDR.dana,
      evidenceBundleHash: "cd".repeat(32),
      checklist: [{ sovCode: "03-100", status: "done" as const }],
      photos: [{ ...fx.EVIDENCE[milestone.id]![0]!, filename: "site-1.jpg" }],
      notes: "",
      at: "2026-10-25T10:00:00Z",
    };
    const event = fx.chainEvent({ projectId: "maple-st-duplex", milestoneId: milestone.id, kind: "audit_attested", at: report.at });
    reply = () => ({ status: 200, body: { milestone: { ...milestone, status: "audited" }, audit: { ...report, txHash: event.txHash }, events: [event] } });

    const res = await api.submitAudit({
      projectId: "maple-st-duplex",
      milestoneId: milestone.id,
      report,
      photos: [new Blob(["jpeg-bytes"], { type: "image/jpeg" })],
      signedTxBlob: "12000322",
    });
    assert.equal(res.milestone.status, "audited");
    const req = seen.at(-1)!;
    assert.equal(`${req.method} ${req.url}`, "POST /api/projects/maple-st-duplex/milestones/maple-st-duplex%3Am1/audit");
    assert.deepEqual(JSON.parse(String(req.form?.get("report"))), report);
    const photo = req.form?.getAll("photos")[0] as File;
    assert.equal(photo.name, "site-1.jpg");
    assert.equal(await photo.text(), "jpeg-bytes");
    assert.equal(req.form?.get("signedTxBlob"), "12000322");
  });

  it("history reads unique route 2 projects discovered through route 18 and rejects incomplete refreshes", async () => {
    const backend = await import("../lib/mock/backend.ts");
    backend.mockControl.setLatency(0);
    const queue = await backend.inspectorQueue(fx.ADDR.dana);
    const details = await Promise.all([...new Set(queue.map((t) => t.projectId))].map((id) => backend.getProject(id)));
    const start = seen.length;
    reply = (req) => ({ status: 200, body: req.url?.endsWith("/queue") ? queue : details.find((d) => req.url === `/api/projects/${d.project.id}`) });
    assert.deepEqual(await api.getAuditHistory(fx.ADDR.dana), JSON.parse(JSON.stringify(details)));
    assert.deepEqual(seen.slice(start).map((s) => s.url).sort(), [
      `/api/inspectors/${fx.ADDR.dana}/queue`, "/api/projects/maple-st-duplex", "/api/projects/oak-ave-rowhouse", "/api/projects/elm-ct-fourplex",
    ].sort());
    reply = (req) => req.url?.endsWith("/queue")
      ? { status: 200, body: queue }
      : { status: 503, body: { error: { code: "ledger_error", message: "Unavailable" } } };
    await assert.rejects(api.getAuditHistory(fx.ADDR.dana), (e) => e instanceof ApiError && e.status === 503);
  });

  it("maps the error envelope to ApiError", async () => {
    reply = () => ({ status: 409, body: { error: { code: "invalid_state", message: "already audited", txHash: "AB" } } });
    await assert.rejects(api.getProject("maple-st-duplex"), (e) => e instanceof ApiError && e.code === "invalid_state" && e.status === 409 && e.txHash === "AB");
    reply = () => ({ status: 502, body: "<html>" });
    await assert.rejects(api.getProject("maple-st-duplex"), (e) => e instanceof ApiError && e.code === "network");
  });

  it("loads re-audit checks through route 2 and surfaces failures rather than hiding the failed-check context", async () => {
    const backend = await import("../lib/mock/backend.ts");
    backend.mockControl.setLatency(0);
    const tasks = await backend.inspectorQueue(fx.ADDR.marcus);
    const detail = await backend.getProject("rhinebeck-farmhouse");
    const start = seen.length;
    reply = (req) => ({ status: 200, body: req.url?.endsWith("/queue") ? tasks : detail });
    const result = await api.getAuditReview(fx.ADDR.marcus, "rhinebeck-farmhouse", "rhinebeck-farmhouse:m1");
    assert.equal(result?.checks?.outcome, "fail");
    assert.deepEqual(seen.slice(start).map((r) => r.url), [`/api/inspectors/${fx.ADDR.marcus}/queue`, "/api/projects/rhinebeck-farmhouse"]);
    // Core may call the resubmitted round `audit`, but its own prior report still calls for comparison.
    tasks[0]!.needs = "audit";
    assert.equal((await api.getAuditReview(fx.ADDR.marcus, "rhinebeck-farmhouse", "rhinebeck-farmhouse:m1"))?.checks?.outcome, "fail");
    reply = (req) => req.url?.endsWith("/queue") ? { status: 200, body: tasks } : { status: 503, body: { error: { code: "ledger_error", message: "Unavailable" } } };
    await assert.rejects(api.getAuditReview(fx.ADDR.marcus, "rhinebeck-farmhouse", "rhinebeck-farmhouse:m1"), (e) => e instanceof ApiError && e.status === 503);
  });

  it("files: core's upload uri when it is an /api/files path (core's evidence id is a different key), else the evidence id", async () => {
    const core = process.env.CORE_URL!.replace(/\/$/, "");
    const uuid = "3d48fdf5-56ee-409d-96f2-66062a247391";
    assert.equal(api.fileUrl({ id: "ev_43dc9c70ecf0", uri: `/api/files/${uuid}` }), `${core}/api/files/${uuid}`);
    assert.equal(api.fileUrl({ id: "ev 1", uri: "data:image/svg+xml,<svg/>" }), `${core}/api/files/ev%201`);
    assert.equal(api.fileUrl({ id: "ev_1", uri: "/api/files/../../etc/passwd" }), `${core}/api/files/ev_1`);

    const start = seen.length;
    reply = () => ({ status: 200, body: { bytes: true } });
    const bytes = await api.fileBytes({ id: "ev_1", uri: `/api/files/${uuid}` });
    assert.equal(new TextDecoder().decode(bytes), '{"bytes":true}');
    assert.equal(seen[start]?.url, `/api/files/${uuid}`);
    reply = () => ({ status: 404, body: { error: { code: "not_found", message: "gone" } } });
    await assert.rejects(api.fileBytes({ id: "ev_1", uri: `/api/files/${uuid}` }), (e) => e instanceof ApiError && e.code === "not_found");
  });

  it("warns (does not throw) when core drifts from the contract", async () => {
    const warn = console.warn;
    const warnings: unknown[] = [];
    console.warn = (...args: unknown[]) => void warnings.push(args);
    try {
      reply = () => ({ status: 200, body: [{ address: fx.ADDR.dana, name: "Dana" }] });
      const panel = await api.listInspectors();
      assert.equal(panel[0]?.name, "Dana");
      assert.equal(warnings.length, 1);
    } finally {
      console.warn = warn;
    }
  });
});
