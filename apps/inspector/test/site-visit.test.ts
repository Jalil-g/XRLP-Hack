// INS-06 pre-construction site visit (TODO(#53): proposed contract, mock only): schemas, form logic, hash, mock route, queue.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, it } from "node:test";
import { decode, Wallet } from "xrpl";
import { SoftwareSigner } from "@xrlp/attest-signer";
import { api } from "../lib/api.ts";
import { photoEvidence } from "../lib/audit.ts";
import { mockControl } from "../lib/mock/backend.ts";
import { ADDR } from "../lib/mock/fixtures.ts";
import { mockSigner } from "../lib/mock/keys.ts";
import { taskHref } from "../lib/queue.ts";
import {
  InspectorSiteVisit,
  SubmitSiteVisitResult,
  buildSiteVisit,
  buildSiteVisitTx,
  emptySiteVisitDraft,
  parseSiteVisitTx,
  signSiteVisit,
  siteVisitHash,
  siteVisitOutcome,
  siteVisitProblems,
  type SiteVisitDraft,
} from "../lib/site-visit.ts";

const PROJECT = "elm-ct-fourplex";
const PHOTO = readFileSync(new URL("./fixtures/audit-foundation-02-site.jpg", import.meta.url));
const AT = "2026-10-25T09:00:00Z";

beforeEach(() => {
  mockControl.reset();
  mockControl.setLatency(0);
});

function assertExact<T>(schema: { parse(v: unknown): T }, value: unknown) {
  assert.deepEqual(schema.parse(value), value);
}

async function filledDraft(over: Partial<SiteVisitDraft["answers"]> = {}): Promise<{ draft: SiteVisitDraft; file: Blob }> {
  const file = new Blob([PHOTO], { type: "image/jpeg" });
  const draft = emptySiteVisitDraft();
  draft.answers = {
    siteExists: { answer: "yes", note: "" },
    siteAccessible: { answer: "yes", note: " Gate on Elm Ct " },
    plansMatchSite: { answer: "unable_to_confirm", note: "Survey stakes missing on the north lot line" },
    ...over,
  };
  draft.photos = [{ file, evidence: await photoEvidence(file, AT) }];
  draft.notes = "  Former auto-repair lot; no visible contamination.  ";
  return { draft, file };
}

describe("queue: pre-visit task", () => {
  it("Dana's Elm Ct pre-visit links to the site-visit form; milestone tasks still link to audits", async () => {
    const tasks = await api.getQueue(ADDR.dana);
    const pre = tasks.find((t) => t.projectId === PROJECT);
    assert.equal(pre?.needs, "pre_visit");
    assert.equal(pre?.milestone, undefined);
    assert.equal(taskHref(pre!), `/site-visit/${PROJECT}`);
    const audit = tasks.find((t) => t.needs === "audit")!;
    assert.equal(taskHref(audit), `/audit/${audit.projectId}/${encodeURIComponent(audit.milestone!.id)}`);
    assert.equal(taskHref({ projectId: PROJECT, needs: "none" }), null);
  });
});

describe("form logic", () => {
  it("blocks until every question is answered, non-yes answers are explained, and a photo is added", () => {
    const empty = emptySiteVisitDraft();
    assert.deepEqual(siteVisitProblems(empty).map((p) => p.field), ["answers.siteExists", "answers.siteAccessible", "answers.plansMatchSite", "photos"]);
    const unexplained = { ...empty, answers: { ...empty.answers, siteExists: { answer: "no" as const, note: "  " } } };
    assert.match(siteVisitProblems(unexplained)[0]!.message, /say why/);
    assert.throws(() => buildSiteVisit(PROJECT, ADDR.dana, empty, AT), /Site visit incomplete/);
  });

  it("builds a report that parses exactly as InspectorSiteVisit: notes trimmed, empty notes omitted", async () => {
    const { draft } = await filledDraft();
    const v = buildSiteVisit(PROJECT, ADDR.dana, draft, AT);
    assertExact(InspectorSiteVisit, v);
    assert.deepEqual(v.answers, {
      siteExists: { answer: "yes" },
      siteAccessible: { answer: "yes", note: "Gate on Elm Ct" },
      plansMatchSite: { answer: "unable_to_confirm", note: "Survey stakes missing on the north lot line" },
    });
    assert.equal(v.notes, "Former auto-repair lot; no visible contamination.");
    assert.equal(v.photos.length, 1);
  });

  it("outcome: any no = concern, any unable = unconfirmed, else confirmed", () => {
    const a = (x: "yes" | "no" | "unable_to_confirm") => ({ answer: x });
    assert.equal(siteVisitOutcome({ answers: { siteExists: a("yes"), siteAccessible: a("yes"), plansMatchSite: a("yes") } }), "confirmed");
    assert.equal(siteVisitOutcome({ answers: { siteExists: a("yes"), siteAccessible: a("unable_to_confirm"), plansMatchSite: a("yes") } }), "unconfirmed");
    assert.equal(siteVisitOutcome({ answers: { siteExists: a("no"), siteAccessible: a("unable_to_confirm"), plansMatchSite: a("yes") } }), "concern");
  });
});

describe("siteVisitHash", () => {
  const base = {
    projectId: PROJECT,
    inspector: ADDR.dana,
    answers: { siteExists: { answer: "yes" as const }, siteAccessible: { answer: "no" as const, note: " Blocked " }, plansMatchSite: { answer: "yes" as const, note: "" } },
    notes: " ok ",
    photos: [{ sha256: "BB" }, { sha256: "aa" }],
  };

  it("golden canonical string", async () => {
    const expected =
      `{"answers":{"plansMatchSite":{"answer":"yes"},"siteAccessible":{"answer":"no","note":"Blocked"},"siteExists":{"answer":"yes"}},` +
      `"inspector":"${ADDR.dana}","notes":"ok","photos":["aa","bb"],"projectId":"${PROJECT}","v":1}`;
    assert.equal(await siteVisitHash(base), createHash("sha256").update(expected).digest("hex"));
  });

  it("ignores photo order / whitespace / server fields; changes with any answer, note, photo or project", async () => {
    const h = await siteVisitHash(base);
    assert.equal(await siteVisitHash({ ...base, photos: [...base.photos].reverse(), notes: "ok", txHash: "AB", at: AT } as typeof base), h);
    for (const changed of [
      { ...base, answers: { ...base.answers, siteExists: { answer: "no" as const, note: "x" } } },
      { ...base, answers: { ...base.answers, siteAccessible: { answer: "no" as const, note: "Open" } } },
      { ...base, photos: [{ sha256: "aa" }] },
      { ...base, projectId: "other" },
    ]) assert.notEqual(await siteVisitHash(changed), h);
  });
});

describe("mock route (proposed POST /api/projects/:id/site-visit)", () => {
  it("files an unsigned visit: response parses exactly, the pre-visit leaves Dana's queue, a second filing is refused", async () => {
    const { draft, file } = await filledDraft();
    const report = buildSiteVisit(PROJECT, ADDR.dana, draft, AT);
    const res = await api.submitSiteVisit({ projectId: PROJECT, report, photos: [file] });
    assertExact(SubmitSiteVisitResult, res);
    assert.match(res.visit.txHash ?? "", /^[0-9A-F]{64}$/);
    assert.equal((await api.getQueue(ADDR.dana)).find((t) => t.projectId === PROJECT)?.needs, "none");
    await assert.rejects(api.submitSiteVisit({ projectId: PROJECT, report, photos: [file] }), /already filed/);
  });

  it("refuses: unassigned inspector, project past verification, unexplained no, no photos, mismatched project", async () => {
    const { draft, file } = await filledDraft();
    const report = buildSiteVisit(PROJECT, ADDR.dana, draft, AT);
    await assert.rejects(api.submitSiteVisit({ projectId: PROJECT, report: { ...report, inspector: ADDR.marcus }, photos: [file] }), /not the assigned inspector/);
    await assert.rejects(api.submitSiteVisit({ projectId: "maple-st-duplex", report: { ...report, projectId: "maple-st-duplex" }, photos: [file] }), /no pre-construction visit is due/);
    await assert.rejects(api.submitSiteVisit({ projectId: PROJECT, report: { ...report, answers: { ...report.answers, siteExists: { answer: "no" } } }, photos: [file] }), /note is required/);
    await assert.rejects(api.submitSiteVisit({ projectId: PROJECT, report, photos: [] }), /at least one site photo/);
    await assert.rejects(api.submitSiteVisit({ projectId: PROJECT, report: { ...report, projectId: "x" }, photos: [file] }), /does not match the route/);
  });

  it("signed: Dana's key, 1-drop Payment to the platform with a site_visit memo; txHash = the signed tx", async () => {
    const { draft, file } = await filledDraft();
    const report = buildSiteVisit(PROJECT, ADDR.dana, draft, AT);
    const signed = await signSiteVisit(report, api.siteVisitAttestationTarget()!, (await mockSigner(ADDR.dana))!, "mock");
    const memo = parseSiteVisitTx(decode(signed.blob) as never);
    assert.deepEqual(memo, { ...signed.memo, signer: ADDR.dana, destination: ADDR.platform });
    assert.equal(memo?.kind, "site_visit");
    const res = await api.submitSiteVisit({ projectId: PROJECT, report, photos: [file], signedTxBlob: signed.blob });
    assert.equal(res.visit.txHash, signed.txHash);
  });

  it("signed: rejects an edited report, other photo bytes, another inspector's key, another recipient", async () => {
    const { draft, file } = await filledDraft();
    const report = buildSiteVisit(PROJECT, ADDR.dana, draft, AT);
    const dana = (await mockSigner(ADDR.dana))!;
    const signed = await signSiteVisit(report, ADDR.platform, dana, "mock");
    await assert.rejects(api.submitSiteVisit({ projectId: PROJECT, report: { ...report, notes: "edited" }, photos: [file], signedTxBlob: signed.blob }), /memo hash does not match/);
    await assert.rejects(api.submitSiteVisit({ projectId: PROJECT, report, photos: [new Blob(["x"])], signedTxBlob: signed.blob }), /memo hash does not match/);
    const asMarcus = await signSiteVisit({ ...report, inspector: ADDR.marcus }, ADDR.platform, (await mockSigner(ADDR.marcus))!, "mock");
    await assert.rejects(api.submitSiteVisit({ projectId: PROJECT, report, photos: [file], signedTxBlob: asMarcus.blob }), /signed by rKMQ/);
    const elsewhere = await signSiteVisit(report, Wallet.generate().classicAddress, dana, "mock");
    await assert.rejects(api.submitSiteVisit({ projectId: PROJECT, report, photos: [file], signedTxBlob: elsewhere.blob }), /not the platform account/);
    // An audit-kind memo is not a site visit (no repurposing of milestone audit attestations).
    const stranger = new SoftwareSigner(Wallet.generate());
    const tx = buildSiteVisitTx({ account: stranger.wallet.classicAddress, platform: ADDR.platform, memo: { ...signed.memo, kind: "audit" as never } });
    const blob = (await stranger.signAttestation({ ...tx, Fee: "12", Sequence: 1, LastLedgerSequence: 100_000_000 })).tx_blob;
    assert.equal(parseSiteVisitTx(decode(blob) as never), null);
  });
});
