// CORE-04: HTTP layer over a stub CoreApi (no CoreService), on a real listening server.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, describe, it } from "node:test";
import { serve, type ServerType } from "@hono/node-server";
import type { CoreApi } from "../src/api-surface.ts";
import { DomainError } from "../src/errors.ts";
import { createHttpServer } from "../src/http/app.ts";

const INVESTOR = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
const PLATFORM = "rPT1Sjq2YGrBMTttX4GZHjKu9dyfzbpAYe";
const MID = "maple-st:m1"; // milestone ids contain ':'

type Call = { method: string; args: unknown[] };
const calls: Call[] = [];
let impl: Partial<Record<keyof CoreApi, (...args: unknown[]) => unknown>> = {};
const stub = new Proxy({} as CoreApi, {
  get: (_t, method: string) => async (...args: unknown[]) => {
    calls.push({ method, args });
    const f = impl[method as keyof CoreApi];
    return f ? f(...args) : { ok: true, method };
  },
});

let dataDir: string;
let server: ServerType;
let base: string;

before(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "core-http-"));
  const app = createHttpServer(stub, { dataDir, corsOrigins: ["http://localhost:3000"], maxFileBytes: 1024 * 1024 });
  await new Promise<void>((resolve) => {
    server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, (info) => {
      base = `http://127.0.0.1:${info.port}`;
      resolve();
    });
  });
});
after(() => {
  server.close();
  rmSync(dataDir, { recursive: true, force: true });
});
beforeEach(() => {
  calls.length = 0;
  impl = {};
});

const post = (path: string, body?: unknown) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("core HTTP server", () => {
  it("1 GET /api/projects passes the status filter and returns JSON", async () => {
    impl.listProjects = () => [{ id: "maple-st", name: "Maple St duplex" }];
    const r = await fetch(`${base}/api/projects?status=verified`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), [{ id: "maple-st", name: "Maple St duplex" }]);
    assert.deepEqual(calls[0], { method: "listProjects", args: [{ status: "verified" }] });
  });

  it("1 rejects an unknown status with 400 validation", async () => {
    const r = await fetch(`${base}/api/projects?status=bogus`);
    assert.equal(r.status, 400);
    assert.equal(((await r.json()) as { error: { code: string } }).error.code, "validation");
    assert.equal(calls.length, 0);
  });

  it("2 GET /api/projects/:id maps NOT_FOUND to the 404 envelope", async () => {
    impl.getProject = () => {
      throw new DomainError("NOT_FOUND", "Project nope not found");
    };
    const r = await fetch(`${base}/api/projects/nope`);
    assert.equal(r.status, 404);
    assert.deepEqual(await r.json(), { error: { code: "not_found", message: "Project nope not found" } });
  });

  it("3 POST /api/projects validates CreateProjectInput (400 validation, service not called)", async () => {
    const r = await post("/api/projects", { name: "x" });
    assert.equal(r.status, 400);
    const body = (await r.json()) as { error: { code: string; message: string } };
    assert.equal(body.error.code, "validation");
    assert.match(body.error.message, /type|sov|terms/);
    assert.equal(calls.length, 0);
    const bad = await fetch(`${base}/api/projects`, { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
    assert.equal(bad.status, 400);
  });

  it("7 POST investments parses investor + amount", async () => {
    impl.invest = () => ({ investment: { amount: "10000" }, events: [] });
    const r = await post("/api/projects/maple-st/investments", { investor: INVESTOR, amount: "10000" });
    assert.equal(r.status, 200);
    assert.deepEqual(calls[0], { method: "invest", args: ["maple-st", { investor: INVESTOR, amount: "10000" }] });
    const bad = await post("/api/projects/maple-st/investments", { investor: INVESTOR, amount: "10.1234567" });
    assert.equal(bad.status, 400);
  });

  it("8 POST close maps TOO_SOON to 409 too_soon with tx details", async () => {
    impl.closeLoan = () => {
      throw new DomainError("TOO_SOON", "Subscription ends in 42s", undefined, { txResult: "tecTOO_SOON", txHash: "ABC" });
    };
    const r = await post("/api/projects/maple-st/close", { actor: PLATFORM });
    assert.equal(r.status, 409);
    assert.deepEqual(await r.json(), {
      error: { code: "too_soon", message: "Subscription ends in 42s", txResult: "tecTOO_SOON", txHash: "ABC" },
    });
  });

  it("9 multipart evidence: files stored with sha256, kinds paired, then served by GET /api/files/:id", async () => {
    impl.submitEvidence = (_id, _mid, files) => ({ milestone: { id: MID }, evidence: files });
    const photo = Buffer.from("fake-jpeg-bytes-foundation");
    const invoice = Buffer.from("%PDF-1.4 invoice");
    const form = new FormData();
    form.append("files[]", new Blob([photo], { type: "image/jpeg" }), "foundation-01.jpg");
    form.append("kind[]", "photo");
    form.append("files[]", new Blob([invoice], { type: "application/pdf" }), "invoice.pdf");
    form.append("kind[]", "invoice");
    const r = await fetch(`${base}/api/projects/maple-st/milestones/${encodeURIComponent(MID)}/evidence`, { method: "POST", body: form });
    assert.equal(r.status, 200);
    const [id, mid, uploads] = calls[0]!.args as [string, string, { fileId: string; sha256: string; kind: string; uri: string; mimeType: string }[]];
    assert.equal(id, "maple-st");
    assert.equal(mid, MID);
    assert.deepEqual(uploads.map((u) => u.kind), ["photo", "invoice"]);
    assert.equal(uploads[0]!.sha256, createHash("sha256").update(photo).digest("hex"));
    assert.equal(uploads[0]!.uri, `/api/files/${uploads[0]!.fileId}`);

    const f = await fetch(base + uploads[0]!.uri);
    assert.equal(f.status, 200);
    assert.equal(f.headers.get("content-type"), "image/jpeg");
    assert.deepEqual(Buffer.from(await f.arrayBuffer()), photo);
    assert.equal((await fetch(`${base}/api/files/00000000-0000-0000-0000-000000000000`)).status, 404);
    assert.equal((await fetch(`${base}/api/files/..%2F..%2Fetc`)).status, 404);
  });

  it("9 rejects mismatched kinds and non-multipart bodies", async () => {
    const form = new FormData();
    form.append("files[]", new Blob([Buffer.from("x")]), "a.jpg");
    const r = await fetch(`${base}/api/projects/p/milestones/m/evidence`, { method: "POST", body: form });
    assert.equal(r.status, 400);
    assert.equal((await post("/api/projects/p/milestones/m/evidence", {})).status, 400);
    assert.equal(calls.length, 0);
  });

  it("10 multipart audit: report JSON + photos + signedTxBlob", async () => {
    impl.submitAudit = (_i, _m, body) => ({ milestone: { id: MID }, audit: body, events: [] });
    const report = { inspector: INVESTOR, evidenceBundleHash: "ab", checklist: [{ sovCode: "foundation", status: "done" }], notes: "ok" };
    const form = new FormData();
    form.append("report", JSON.stringify(report));
    form.append("photos[]", new Blob([Buffer.from("site-photo")], { type: "image/jpeg" }), "site.jpg");
    form.append("signedTxBlob", "12000022");
    const r = await fetch(`${base}/api/projects/maple-st/milestones/${encodeURIComponent(MID)}/audit`, { method: "POST", body: form });
    assert.equal(r.status, 200);
    const body = calls[0]!.args[2] as { report: unknown; photos: { filename: string }[]; signedTxBlob: string };
    assert.deepEqual(body.report, report);
    assert.equal(body.photos[0]!.filename, "site.jpg");
    assert.equal(body.signedTxBlob, "12000022");
  });

  it("11 POST run-checks returns verdict + release", async () => {
    impl.runChecks = () => ({ verdict: { decision: "pass" }, release: { txHash: "F1", explorerUrl: "https://devnet.xrpl.org/transactions/F1" }, events: [] });
    const r = await post(`/api/projects/maple-st/milestones/${encodeURIComponent(MID)}/run-checks`);
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as { release: { txHash: string } }).release.txHash, "F1");
    assert.deepEqual(calls[0], { method: "runChecks", args: ["maple-st", MID] });
  });

  it("12 decision body validated; UNSAFE_RELEASE maps to 409 unsafe_release", async () => {
    assert.equal((await post(`/api/projects/p/milestones/m/decision`, { actor: PLATFORM, decision: "maybe", reason: "x" })).status, 400);
    impl.resolveNeedsHuman = () => {
      throw new DomainError("UNSAFE_RELEASE", "builder has no RLUSD trust line");
    };
    const r = await post(`/api/projects/p/milestones/m/decision`, { actor: PLATFORM, decision: "approve", reason: "site visit ok" });
    assert.equal(r.status, 409);
    assert.equal(((await r.json()) as { error: { code: string } }).error.code, "unsafe_release");
  });

  it("23 POST try-steal returns the tec result", async () => {
    impl.tryStealDemo = () => ({ result: "tecCRYPTOCONDITION_ERROR", txHash: "BAD", explorerUrl: "https://devnet.xrpl.org/transactions/BAD" });
    const r = await post(`/api/admin/demo/try-steal/maple-st/${encodeURIComponent("maple-st:m2")}`);
    assert.equal(r.status, 200);
    assert.equal(((await r.json()) as { result: string }).result, "tecCRYPTOCONDITION_ERROR");
    assert.deepEqual(calls[0], { method: "tryStealDemo", args: ["maple-st", "maple-st:m2"] });
  });

  it("CORS preflight allows the web app and rejects other origins", async () => {
    const ok = await fetch(`${base}/api/projects`, {
      method: "OPTIONS",
      headers: { Origin: "http://localhost:3000", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" },
    });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get("access-control-allow-origin"), "http://localhost:3000");
    const evil = await fetch(`${base}/api/projects`, { method: "OPTIONS", headers: { Origin: "http://evil.test", "Access-Control-Request-Method": "POST" } });
    assert.notEqual(evil.headers.get("access-control-allow-origin"), "http://evil.test");
  });

  it("unknown routes and unexpected errors use the envelope", async () => {
    const r = await fetch(`${base}/api/nope`);
    assert.equal(r.status, 404);
    assert.equal(((await r.json()) as { error: { code: string } }).error.code, "not_found");
    impl.listBuilders = () => {
      throw new Error("boom");
    };
    const e = await fetch(`${base}/api/builders`);
    assert.equal(e.status, 500);
    assert.equal(((await e.json()) as { error: { message: string } }).error.message, "boom");
  });

  it("covers the remaining routes (13–22) with correct method + args", async () => {
    await post(`/api/projects/p/milestones/m/cancel`);
    await post(`/api/projects/p/repayments`, { amount: "7000.02" });
    await post(`/api/projects/p/withdrawals`, { investor: INVESTOR, amount: "100" });
    await fetch(`${base}/api/projects/p/events`);
    await fetch(`${base}/api/builders/b1`);
    await fetch(`${base}/api/inspectors`);
    await fetch(`${base}/api/inspectors/${INVESTOR}/queue`);
    await post(`/api/investors/${INVESTOR}/kyc`);
    await fetch(`${base}/api/portfolio/${INVESTOR}`);
    await post(`/api/admin/demo/reset`, { seed: "maple-st" });
    await post(`/api/admin/keeper/tick`);
    await post(`/api/projects/p/verification-fee`, { builder: INVESTOR });
    await post(`/api/projects/p/verify-project`);
    await post(`/api/projects/p/lock-terms`, { actor: PLATFORM });
    assert.deepEqual(
      calls.map((c) => c.method),
      [
        "cancelExpired",
        "repay",
        "withdraw",
        "listEvents",
        "getBuilder",
        "listInspectors",
        "inspectorQueue",
        "kycInvestor",
        "portfolio",
        "resetDemo",
        "keeperTick",
        "payVerificationFee",
        "verifyProject",
        "lockTermsAndOpenFunding",
      ],
    );
    assert.deepEqual(calls[9]!.args, [{ seed: "maple-st" }]);
    assert.equal((await fetch(`${base}/api/portfolio/not-an-address`)).status, 400);
  });
});
