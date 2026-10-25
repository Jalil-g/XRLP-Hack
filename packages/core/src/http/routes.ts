// Routes 1–25 of docs/05-api.md §2 + GET /api/files/:fileId. Parse -> CoreApi call -> JSON. No business logic here.
import { CreateProjectInput, EvidenceKind, InspectorAudit, ProjectStatus, Rlusd, XrplAddress } from "@xrlp/shared";
import type { Context, Hono } from "hono";
import { z } from "zod";
import { DEMO_SEEDS, type AuditReportInput, type CoreApi, type EvidenceUpload } from "../api-surface.ts";
import { DomainError } from "../errors.ts";
import type { SiteVisitReportInput } from "../site-visit.ts";
import type { UploadStore } from "./files.ts";

const ActorBody = z.object({ actor: XrplAddress });
const InvestBody = z.object({ investor: XrplAddress, amount: Rlusd });
const AmountBody = z.object({ amount: Rlusd });
const FeeBody = z.object({ builder: XrplAddress });
const DecisionBody = z.object({ actor: XrplAddress, decision: z.enum(["approve", "reject"]), reason: z.string().min(1) });
const ResetBody = z.object({ seed: z.enum(DEMO_SEEDS).optional() }).default({});
const ListQuery = z.object({ status: ProjectStatus.optional() });
const AuditReport = InspectorAudit.pick({ inspector: true, evidenceBundleHash: true, checklist: true, notes: true });

function parse<S extends z.ZodTypeAny>(schema: S, input: unknown, what: string): z.output<S> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".") || what}: ${i.message}`).join("; ");
    throw new DomainError("VALIDATION", msg, r.error.issues);
  }
  return r.data;
}

async function jsonBody(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new DomainError("VALIDATION", "body: invalid JSON");
  }
}

async function formBody(c: Context): Promise<Record<string, string | File | (string | File)[]>> {
  if (!(c.req.header("content-type") ?? "").includes("multipart/form-data")) {
    throw new DomainError("VALIDATION", "body: expected multipart/form-data");
  }
  return c.req.parseBody({ all: true });
}

/** Accept `files[]` or `files` (single value or repeated). */
function field(form: Record<string, string | File | (string | File)[]>, name: string): (string | File)[] {
  const v = form[`${name}[]`] ?? form[name];
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}
const filesOf = (vals: (string | File)[], name: string): File[] =>
  vals.map((v) => {
    if (typeof v === "string") throw new DomainError("VALIDATION", `${name}: expected a file, got text`);
    return v;
  });

/** A multipart text part holding JSON. */
function jsonPart(form: Record<string, string | File | (string | File)[]>, name: string): unknown {
  const [raw] = field(form, name);
  if (typeof raw !== "string") throw new DomainError("VALIDATION", `${name}: expected a JSON text part`);
  try {
    return JSON.parse(raw);
  } catch {
    throw new DomainError("VALIDATION", `${name}: invalid JSON`);
  }
}

export function registerRoutes(app: Hono, api: CoreApi, uploads: UploadStore): void {
  // 1–8: projects
  app.get("/api/projects", async (c) => c.json(await api.listProjects(parse(ListQuery, c.req.query(), "query"))));
  app.get("/api/projects/:id", async (c) => c.json(await api.getProject(c.req.param("id"))));
  app.post("/api/projects", async (c) => c.json(await api.createProject(parse(CreateProjectInput, await jsonBody(c), "body"))));
  app.post("/api/projects/:id/verification-fee", async (c) =>
    c.json(await api.payVerificationFee(c.req.param("id"), parse(FeeBody, await jsonBody(c), "body"))),
  );
  app.post("/api/projects/:id/verify-project", async (c) => c.json(await api.verifyProject(c.req.param("id"))));
  app.post("/api/projects/:id/lock-terms", async (c) =>
    c.json(await api.lockTermsAndOpenFunding(c.req.param("id"), parse(ActorBody, await jsonBody(c), "body"))),
  );
  app.post("/api/projects/:id/investments", async (c) =>
    c.json(await api.invest(c.req.param("id"), parse(InvestBody, await jsonBody(c), "body"))),
  );
  app.post("/api/projects/:id/close", async (c) => c.json(await api.closeLoan(c.req.param("id"), parse(ActorBody, await jsonBody(c), "body"))));

  // 9–13: milestones
  app.post("/api/projects/:id/milestones/:mid/evidence", async (c) => {
    const form = await formBody(c);
    const files = filesOf(field(form, "files"), "files");
    const kinds = field(form, "kind");
    if (files.length === 0) throw new DomainError("VALIDATION", "files: at least one file is required");
    if (kinds.length !== files.length) throw new DomainError("VALIDATION", `kind: expected ${files.length} values, got ${kinds.length}`);
    const uploads_: EvidenceUpload[] = [];
    for (const [i, f] of files.entries()) {
      const kind = parse(EvidenceKind, kinds[i], `kind[${i}]`);
      uploads_.push({ ...(await uploads.save(f)), kind });
    }
    return c.json(await api.submitEvidence(c.req.param("id"), c.req.param("mid"), uploads_));
  });
  app.post("/api/projects/:id/milestones/:mid/audit", async (c) => {
    const form = await formBody(c);
    const report: AuditReportInput = parse(AuditReport, jsonPart(form, "report"), "report");
    const photos = [];
    for (const f of filesOf(field(form, "photos"), "photos")) photos.push(await uploads.save(f));
    const [blob] = field(form, "signedTxBlob");
    if (blob !== undefined && typeof blob !== "string") throw new DomainError("VALIDATION", "signedTxBlob: expected hex text");
    return c.json(
      await api.submitAudit(c.req.param("id"), c.req.param("mid"), { report, photos, ...(blob ? { signedTxBlob: blob } : {}) }),
    );
  });
  app.post("/api/projects/:id/milestones/:mid/run-checks", async (c) => c.json(await api.runChecks(c.req.param("id"), c.req.param("mid"))));
  app.post("/api/projects/:id/milestones/:mid/decision", async (c) =>
    c.json(await api.resolveNeedsHuman(c.req.param("id"), c.req.param("mid"), parse(DecisionBody, await jsonBody(c), "body"))),
  );
  app.post("/api/projects/:id/milestones/:mid/cancel", async (c) => c.json(await api.cancelExpired(c.req.param("id"), c.req.param("mid"))));

  // 14–16
  app.post("/api/projects/:id/repayments", async (c) => c.json(await api.repay(c.req.param("id"), parse(AmountBody, await jsonBody(c), "body"))));
  app.post("/api/projects/:id/withdrawals", async (c) =>
    c.json(await api.withdraw(c.req.param("id"), parse(InvestBody, await jsonBody(c), "body"))),
  );
  app.get("/api/projects/:id/events", async (c) => c.json(await api.listEvents(c.req.param("id"))));

  // 17–20: directory + portfolio
  app.get("/api/builders", async (c) => c.json(await api.listBuilders()));
  app.get("/api/builders/:id", async (c) => c.json(await api.getBuilder(c.req.param("id"))));
  app.get("/api/inspectors", async (c) => c.json(await api.listInspectors()));
  app.get("/api/inspectors/:address/queue", async (c) =>
    c.json(await api.inspectorQueue(parse(XrplAddress, c.req.param("address"), "address"))),
  );
  app.post("/api/investors/:address/kyc", async (c) => c.json(await api.kycInvestor(parse(XrplAddress, c.req.param("address"), "address"))));
  app.get("/api/portfolio/:investor", async (c) => c.json(await api.portfolio(parse(XrplAddress, c.req.param("investor"), "investor"))));

  // 21–23: admin / demo
  app.get("/api/admin/demo/parties", async (c) => c.json(await api.listDemoParties()));
  app.post("/api/admin/demo/reset", async (c) => c.json(await api.resetDemo(parse(ResetBody, await jsonBody(c), "body"))));
  app.post("/api/admin/keeper/tick", async (c) => c.json(await api.keeperTick()));
  app.post("/api/admin/demo/try-steal/:id/:mid", async (c) => c.json(await api.tryStealDemo(c.req.param("id"), c.req.param("mid"))));

  // 24–25: project-level needs_human (inspector pre-construction site visit, operator decision)
  app.post("/api/projects/:id/site-visit", async (c) => {
    const form = await formBody(c);
    const report = jsonPart(form, "report");
    const photos = [];
    for (const f of filesOf(field(form, "photos"), "photos")) photos.push(await uploads.save(f));
    const [blob] = field(form, "signedTxBlob");
    if (blob !== undefined && typeof blob !== "string") throw new DomainError("VALIDATION", "signedTxBlob: expected hex text");
    // The report schema is enforced by the service (SiteVisitReportInput); extra client fields (photos, at) are ignored.
    return c.json(await api.submitSiteVisit(c.req.param("id"), { report: report as SiteVisitReportInput, photos, ...(blob ? { signedTxBlob: blob } : {}) }));
  });
  app.post("/api/projects/:id/decision", async (c) =>
    c.json(await api.decideProject(c.req.param("id"), parse(DecisionBody, await jsonBody(c), "body"))),
  );

  // files
  app.get("/api/files/:fileId", async (c) => {
    const f = await uploads.get(c.req.param("fileId"));
    if (!f) throw new DomainError("NOT_FOUND", `File ${c.req.param("fileId")} not found`);
    return c.body(new Uint8Array(f.bytes), 200, {
      "content-type": f.meta.mimeType,
      "content-length": String(f.bytes.length),
      "content-disposition": `inline; filename="${f.meta.filename.replace(/"/g, "")}"`,
      "x-content-sha256": f.meta.sha256,
    });
  });
}
