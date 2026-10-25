import assert from "node:assert/strict";
import { test } from "node:test";
import { MILESTONE_TEMPLATES, type Evidence, type EvidenceKind } from "@xrlp/shared";
import {
  checkGpsWithinSite,
  checkInvoiceMatchesBudget,
  checkLienWaivers,
  checkNoDuplicatePhoto,
  checkPhotoFresh,
  checkRequiredEvidence,
} from "../src/checks.ts";
import { decide, policyFor, type CheckOutcome, type LoadedEvidence, type PriorEvidence } from "../src/index.ts";
import type { MilestoneContext } from "../src/types.ts";
import { builder, GEO, project } from "../fixtures/scenarios.ts";

const m1 = project.milestones[0]!;
const tpl = MILESTONE_TEMPLATES.residential_new.find((t) => t.key === "foundation")!;
const ctx: MilestoneContext = { project, builder, milestone: m1, template: tpl, riskTier: builder.riskTier };
const policy = policyFor(project, builder, m1);

let n = 0;
function ev(kind: EvidenceKind, meta: Evidence["meta"] = {}, extra: Partial<LoadedEvidence> & { filename?: string } = {}): LoadedEvidence {
  const id = `ev${++n}`;
  const evidence: Evidence = {
    id, kind, filename: extra.filename ?? `${id}.${kind === "photo" ? "jpg" : "txt"}`, mimeType: kind === "photo" ? "image/jpeg" : "text/plain",
    uri: `x/${id}`, sha256: extra.sha256 ?? `sha-${id}`, meta, uploadedAt: "2026-10-20T00:00:00Z",
  };
  return { evidence, bytes: new Uint8Array(), sha256: extra.sha256 ?? `sha-${id}`, meta, text: extra.text ?? null };
}
const onSite = { lat: GEO.mapleSite.lat + 0.0002, lng: GEO.mapleSite.lng };
const okPhoto = (hash: string, extra: Partial<LoadedEvidence> = {}) =>
  ev("photo", { gps: onSite, takenAt: "2026-10-19T12:00:00.000Z", perceptualHash: hash }, extra);

// --- required evidence -------------------------------------------------------------------------
test("required_evidence_present: passes with full set, fails listing what's missing", () => {
  const full = [okPhoto("0"), okPhoto("1"), okPhoto("2"), ev("invoice"), ev("document")];
  assert.equal(checkRequiredEvidence(tpl, full, "foundation").result, "pass");
  const r = checkRequiredEvidence(tpl, [okPhoto("0"), ev("invoice")], "foundation");
  assert.equal(r.result, "fail");
  assert.match(r.reason, /photo 1\/3/);
  assert.match(r.reason, /document 0\/1/);
  assert.equal(checkRequiredEvidence(undefined, full, "nope").result, "fail");
});

// --- GPS ----------------------------------------------------------------------------------------
test("gps_within_site: pass on site, fail when far, warn when GPS mostly missing", () => {
  assert.equal(checkGpsWithinSite(ctx, [okPhoto("0")], policy).result, "pass");
  const far = ev("photo", { gps: GEO.offsite });
  const r = checkGpsWithinSite(ctx, [okPhoto("0"), far], policy);
  assert.equal(r.result, "fail");
  assert.deepEqual(r.evidenceIds, [far.evidence.id]);
  assert.match(r.reason, /lazy fraud/);
  assert.equal(checkGpsWithinSite(ctx, [okPhoto("0"), ev("photo"), ev("photo")], policy).result, "warn");
  assert.equal(checkGpsWithinSite(ctx, [ev("invoice")], policy).result, "skipped");
});

// --- freshness ----------------------------------------------------------------------------------
test("photo_fresh: before escrow / before previous approval / future / too old / missing", () => {
  const tl = { escrowCreatedAt: "2026-10-15T00:00:00Z", now: "2026-10-24T00:00:00Z" };
  const at = (takenAt: string) => ev("photo", { takenAt });
  assert.equal(checkPhotoFresh([at("2026-10-19T00:00:00Z")], tl, policy).result, "pass");
  assert.equal(checkPhotoFresh([at("2026-10-01T00:00:00Z")], tl, policy).result, "fail");
  assert.equal(checkPhotoFresh([at("2026-10-19T00:00:00Z")], { ...tl, previousMilestoneApprovedAt: "2026-10-20T00:00:00Z" }, policy).result, "fail");
  assert.equal(checkPhotoFresh([at("2026-10-25T00:00:00Z")], tl, policy).result, "fail");
  assert.equal(checkPhotoFresh([at("2026-09-01T00:00:00Z")], { now: tl.now }, policy).result, "fail", "older than maxPhotoAgeDays");
  assert.equal(checkPhotoFresh([ev("photo")], tl, policy).result, "warn");
});

// --- duplicates (the strong one) ---------------------------------------------------------------
const prior = (hash: string, sha: string, projectId = "prj_other", milestoneId = "ms_x"): PriorEvidence => ({
  evidence: ev("photo", { perceptualHash: hash }, { sha256: sha }).evidence, projectId, milestoneId, projectName: "Other Project",
});

test("no_duplicate_photo: exact sha256 match across projects fails", () => {
  const p = okPhoto("00000000000000ff", { sha256: "same" });
  const r = checkNoDuplicatePhoto(ctx, [p], [prior("ffffffffffffff00", "same")], policy);
  assert.equal(r.result, "fail");
  assert.match(r.reason, /byte-identical/);
  assert.match(r.reason, /another project \(Other Project/);
});

test("no_duplicate_photo: perceptual near-duplicate fails, similar warns, distant passes", () => {
  const p = okPhoto("0000000000000000");
  assert.equal(checkNoDuplicatePhoto(ctx, [p], [prior("000000000000000f", "a")], policy).result, "fail"); // distance 4
  assert.equal(checkNoDuplicatePhoto(ctx, [p], [prior("0000000000000fff", "b")], policy).result, "warn"); // distance 12
  assert.equal(checkNoDuplicatePhoto(ctx, [p], [prior("0000ffffffffffff", "c")], policy).result, "pass"); // distance 48
});

test("no_duplicate_photo: copies within one submission fail; same-milestone priors (resubmission) are ignored", () => {
  const a = okPhoto("0000000000000000");
  const b = okPhoto("0000000000000001");
  assert.equal(checkNoDuplicatePhoto(ctx, [a, b], [], policy).result, "fail");
  const resubmit = prior("0000000000000000", "z", project.id, m1.id);
  assert.equal(checkNoDuplicatePhoto(ctx, [a], [resubmit], policy).result, "pass");
  const earlierPhase = prior("0000000000000000", "z", project.id, "ms_maple_0");
  const r = checkNoDuplicatePhoto(ctx, [a], [earlierPhase], policy);
  assert.equal(r.result, "fail");
  assert.match(r.reason, /this project's milestone/);
});

// --- invoices -----------------------------------------------------------------------------------
test("invoice_matches_budget: within tolerance, shortfall, overrun, unreadable", () => {
  const inv = (total?: string) => ev("invoice", total ? { invoiceTotal: total } : {});
  assert.equal(checkInvoiceMatchesBudget(ctx, [inv("24000.00"), inv("900.00")], policy).result, "pass"); // 99.6%
  const short = checkInvoiceMatchesBudget(ctx, [inv("18400.00")], policy);
  assert.equal(short.result, "fail");
  assert.match(short.reason, /73\.6%/);
  assert.equal(checkInvoiceMatchesBudget(ctx, [inv("40000.00")], policy).result, "fail");
  assert.equal(checkInvoiceMatchesBudget(ctx, [inv()], policy).result, "warn");
  const unread = inv();
  assert.equal(checkInvoiceMatchesBudget(ctx, [unread], policy, { [unread.evidence.id]: "25000.00" }).result, "pass", "LLM total used");
  assert.equal(checkInvoiceMatchesBudget(ctx, [], policy).result, "fail", "template requires an invoice");
});

// --- lien waivers (stub) ------------------------------------------------------------------------
test("lien_waiver_matches_invoices: match, amount mismatch, missing waiver", () => {
  const invoice = ev("invoice", { invoiceTotal: "24850.00" }, { text: "Invoice No: GRM-24117\nTOTAL: $24,850.00" });
  const waiver = (amt: string) => ev("document", {}, { filename: "lien-waiver.txt", text: `LIEN WAIVER\nInvoice No: GRM-24117\nAmount: $${amt}` });
  assert.equal(checkLienWaivers([invoice]).result, "skipped");
  assert.equal(checkLienWaivers([invoice, waiver("24,850.00")]).result, "pass");
  assert.equal(checkLienWaivers([invoice, waiver("20,000.00")]).result, "fail");
  const other = ev("invoice", { invoiceTotal: "100.00" }, { text: "Invoice No: XYZ-1\nTOTAL: 100.00" });
  assert.equal(checkLienWaivers([invoice, other, waiver("24,850.00")]).result, "warn");
});

// --- decision mapping ---------------------------------------------------------------------------
const o = (check: string, result: CheckOutcome["result"], confidence = 0.99, source: CheckOutcome["source"] = "deterministic"): CheckOutcome =>
  ({ check, result, reason: "r", evidenceIds: [], confidence, source });

test("decide: any required failure blocks; partial results cannot become an automatic pass", () => {
  assert.equal(decide([o("no_duplicate_photo", "fail")], policy).decision, "fail");
  assert.equal(decide([o("gps_within_site", "fail")], policy).decision, "fail");
  const pass = decide([o("photo_fresh", "pass"), o("stage_visually_consistent", "pass", 0.9, "llm")], policy);
  assert.equal(pass.decision, "needs_human");
  assert.equal(pass.confidence, 0);
});

test("decide: required LLM failure blocks; low-confidence approval and missing gates need review", () => {
  assert.equal(decide([o("stage_visually_consistent", "fail", 0.4, "llm")], policy).decision, "fail");
  assert.equal(decide([o("stage_visually_consistent", "pass", 0.4, "llm")], policy).decision, "needs_human");
  assert.equal(decide([o("stage_visually_consistent", "fail", 0.95, "llm")], policy).decision, "fail");
});

test("decide: unverified builder caps at needs_human", () => {
  const p = policyFor(project, { ...builder, verified: false }, m1);
  assert.equal(decide([o("photo_fresh", "pass")], p).decision, "needs_human");
});
