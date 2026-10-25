// INS-03 audit logic: bundle hash parity with the verifier, EXIF parity, geofence, draft validation, InspectorAudit shape.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, describe, it } from "node:test";
import { api } from "../lib/api.ts";
import {
  buildAudit,
  distanceM,
  draftProblems,
  emptyDraft,
  evidenceBundleHash,
  geoVerdict,
  parseExifDate,
  photoEvidence,
  readPhotoMeta,
  type AuditDraft,
} from "../lib/audit.ts";
import { mockControl } from "../lib/mock/backend.ts";
import { ADDR } from "../lib/mock/fixtures.ts";
import { InspectorAudit, type InspectorTask } from "../lib/types.ts";

/** Copied from packages/verifier/fixtures/evidence/maple-st/audits/photos/ (an inspector's site photo of Maple St). */
const SITE_PHOTO = readFileSync(new URL("./fixtures/audit-foundation-02-site.jpg", import.meta.url));
const MAPLE_SITE = { lat: 40.6795, lng: -73.962, radiusM: 120 };

beforeEach(() => {
  mockControl.reset();
  mockControl.setLatency(0);
});

async function mapleM1(): Promise<InspectorTask & { milestone: NonNullable<InspectorTask["milestone"]> }> {
  const t = (await api.getQueue(ADDR.dana)).find((x) => x.milestone?.id === "maple-st-duplex:m1");
  assert.ok(t?.milestone);
  return t as InspectorTask & { milestone: NonNullable<InspectorTask["milestone"]> };
}

describe("evidenceBundleHash = packages/verifier/src/audit.ts", () => {
  it("golden value from the verifier's Maple St foundation audit fixture", async () => {
    // sha256 of the six files in the verifier's `foundation` scenario bundle (wide, bolts, walls, invoice, footing, lien).
    const files = [
      "980706ed6ff65df8a29100bac1fe80ea6368abc6679e03f83d2d9ad2054806e1",
      "aea3e205d7cfe5fd7cf73a3c6a8f521e63bab8eba8af9abb1d350e798802e886",
      "971a5b002008f91d78178f5f584724abe6e48ff25996e5833f8a679cc91867a2",
      "444762732367e5bb36766fbcf87a4b6db36b3defede6585d5bb5ee43eece9c60",
      "153ae0e62925f7bf2fb9acbd17c45ca73b9f07d357027649ab44ec54db91cbcb",
      "2f1d8e66e323e78fc434dc2d950ad6eb7a85b5d2949cbb0835e486db97348fd0",
    ].map((sha256) => ({ sha256 }));
    assert.equal(await evidenceBundleHash(files), "b47b3eca9fc519229eb8ef082426353de50ad7ea1bc11ff2e1967257741b168c");
  });

  it("is order-independent and changes when a file changes", async () => {
    const a = [{ sha256: "aa" }, { sha256: "bb" }];
    assert.equal(await evidenceBundleHash(a), await evidenceBundleHash([...a].reverse()));
    assert.notEqual(await evidenceBundleHash(a), await evidenceBundleHash([{ sha256: "aa" }, { sha256: "bc" }]));
  });
});

describe("EXIF (same parser + rules as the verifier)", () => {
  it("reads taken-at and GPS from a real site photo", async () => {
    assert.deepEqual(await readPhotoMeta(SITE_PHOTO), {
      takenAt: "2026-10-21T15:25:00.000Z",
      gps: { lat: 40.67941111111111, lng: -73.96185833333334 },
    });
  });

  it("returns {} for a file without EXIF", async () => {
    assert.deepEqual(await readPhotoMeta(new TextEncoder().encode("not a jpeg")), {});
  });

  it("parseExifDate: offset honoured, none → UTC, junk → undefined", () => {
    assert.equal(parseExifDate("2026:10:21 11:25:00", "-04:00"), "2026-10-21T15:25:00.000Z");
    assert.equal(parseExifDate("2026:10:21 15:25:00"), "2026-10-21T15:25:00.000Z");
    assert.equal(parseExifDate("yesterday"), undefined);
  });

  it("photoEvidence: real sha256 (matches the verifier fixture) + EXIF meta", async () => {
    const ev = await photoEvidence(Object.assign(new Blob([SITE_PHOTO], { type: "image/jpeg" }), { name: "site.jpg" }), "2026-10-25T10:00:00Z");
    assert.equal(ev.sha256, "9966c46196a62243c6407b9948caa1c0f93c93106a8cdf6cdec1168ed10679e0");
    assert.equal(ev.filename, "site.jpg");
    assert.equal(ev.kind, "photo");
    assert.ok(ev.meta.gps);
  });
});

describe("geofence", () => {
  it("the site photo is inside Maple St's geofence; the verifier's off-site point (~2.6 km) is outside", async () => {
    const { gps } = await readPhotoMeta(SITE_PHOTO);
    const inside = geoVerdict(MAPLE_SITE, gps);
    assert.equal(inside.state, "inside");
    assert.ok(inside.distanceM! < 30, `${inside.distanceM} m`);
    const off = geoVerdict(MAPLE_SITE, { lat: 40.7008, lng: -73.9505 });
    assert.equal(off.state, "outside");
    assert.ok(Math.abs(off.distanceM! - 2560) < 150, `${off.distanceM} m`);
    assert.equal(geoVerdict(MAPLE_SITE).state, "no_gps");
  });

  it("distanceM is ~111 km per degree of latitude", () => {
    assert.ok(Math.abs(distanceM({ lat: 40, lng: -74 }, { lat: 41, lng: -74 }) - 111_195) < 50);
  });
});

describe("draft → InspectorAudit", () => {
  const fill = (task: InspectorTask, over: Partial<AuditDraft> = {}): AuditDraft => ({
    ...emptyDraft(task),
    checklist: Object.fromEntries(task.sov.map((l) => [l.code, { status: "done" as const, note: "" }])),
    ...over,
  });

  it("blocks: unset lines, partial/not_done without a note, no photos", async () => {
    const task = await mapleM1();
    const problems = draftProblems(task, emptyDraft(task)).map((p) => p.field);
    assert.deepEqual(problems, [...task.sov.map((l) => `checklist.${l.code}`), "photos"]);

    const [first] = task.sov;
    const partial = fill(task, { checklist: { ...fill(task).checklist, [first!.code]: { status: "partial", note: "  " } } });
    assert.deepEqual(
      draftProblems(task, partial).map((p) => p.field),
      [`checklist.${first!.code}`, "photos"],
    );
  });

  it("builds an audit that parses exactly as InspectorAudit, bound to the builder's bundle, and the mock accepts it", async () => {
    const task = await mapleM1();
    const file = new Blob([SITE_PHOTO], { type: "image/jpeg" });
    const photo = await photoEvidence(file, "2026-10-25T10:00:00Z");
    const draft = fill(task, { photos: [{ file, evidence: photo }], notes: "  Walls plumb, slab cured.  " });
    draft.checklist["03-300"] = { status: "partial", note: " Slab edge not finished on the north side " };

    const audit = await buildAudit(task, ADDR.dana, draft, "2026-10-25T10:00:00Z");
    assert.deepEqual(InspectorAudit.parse(audit), audit);
    assert.equal(audit.evidenceBundleHash, await evidenceBundleHash(task.evidence));
    assert.deepEqual(
      audit.checklist.map((c) => c.sovCode),
      task.sov.map((l) => l.code),
    );
    assert.deepEqual(audit.checklist.find((c) => c.sovCode === "03-300"), { sovCode: "03-300", status: "partial", note: "Slab edge not finished on the north side" });
    assert.equal(audit.checklist.find((c) => c.sovCode === "02-100")?.note, undefined);
    assert.equal(audit.notes, "Walls plumb, slab cured.");

    const res = await api.submitAudit({ projectId: task.projectId, milestoneId: task.milestone.id, report: audit, photos: [file] });
    assert.equal(res.milestone.status, "audited");
    assert.ok(res.audit.txHash);
  });

  it("refuses to build an incomplete audit", async () => {
    const task = await mapleM1();
    await assert.rejects(buildAudit(task, ADDR.dana, emptyDraft(task), "2026-10-25T10:00:00Z"), /Audit incomplete/);
  });

  it("the mock rejects an audit bound to a different evidence bundle", async () => {
    const task = await mapleM1();
    const file = new Blob([SITE_PHOTO], { type: "image/jpeg" });
    const draft = fill(task, { photos: [{ file, evidence: await photoEvidence(file, "2026-10-25T10:00:00Z") }] });
    const audit = { ...(await buildAudit(task, ADDR.dana, draft, "2026-10-25T10:00:00Z")), evidenceBundleHash: "0".repeat(64) };
    await assert.rejects(api.submitAudit({ projectId: task.projectId, milestoneId: task.milestone.id, report: audit, photos: [file] }), /evidenceBundleHash/);
  });
});
