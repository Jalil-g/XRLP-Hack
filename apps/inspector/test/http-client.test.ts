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
  it("loads the upload URI even when the evidence ID differs from the file UUID", () => {
    const uri = "/api/files/12345678-1234-1234-1234-123456789abc";
    assert.equal(api.fileUrl({ id: "evidence-42", uri }), process.env.CORE_URL!.replace(/\/$/, "") + uri);
    assert.equal(api.fileUrl({ id: "fixture", uri: "data:image/png;base64,AA" }), "data:image/png;base64,AA");
  });

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

  it("maps the error envelope to ApiError", async () => {
    reply = () => ({ status: 409, body: { error: { code: "invalid_state", message: "already audited", txHash: "AB" } } });
    await assert.rejects(api.getProject("maple-st-duplex"), (e) => e instanceof ApiError && e.code === "invalid_state" && e.status === 409 && e.txHash === "AB");
    reply = () => ({ status: 502, body: "<html>" });
    await assert.rejects(api.getProject("maple-st-duplex"), (e) => e instanceof ApiError && e.code === "network");
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
