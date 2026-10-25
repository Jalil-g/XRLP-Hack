// Builds the demo fixtures (evidence photos, audits, manifest) from real CC0 / public-domain source photos.
//   pnpm --filter @xrlp/verifier fixtures
// Sources live in fixtures/source (see fixtures/SOURCES.txt for authors + licences). Every photo is
// re-stamped with fixture EXIF (capture time, GPS) via stampExif(); company / invoice / audit documents
// are synthetic. Re-running is deterministic. stampExif() is also used to re-date photos on demo day.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import piexif from "piexifjs";
import sharp from "sharp";
import { evidenceBundleHash, type InspectorAudit } from "../src/audit.ts";
import { FIX, fixtureEvidence, GEO, PATHS, SCENARIOS } from "../fixtures/scenarios.ts";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "fixtures");

// ---------------------------------------------------------------------------- EXIF
/** Write EXIF capture time (UTC, no offset tag) and optional GPS into a JPEG. */
export function stampExif(jpeg: Buffer, opts: { takenAt?: string; gps?: { lat: number; lng: number } }): Buffer {
  const zeroth: Record<number, unknown> = { [piexif.ImageIFD.Make!]: "XRLP", [piexif.ImageIFD.Model!]: "Fixture (demo)" };
  const exif: Record<number, unknown> = {};
  if (opts.takenAt) {
    const d = new Date(opts.takenAt).toISOString(); // 2026-10-19T14:05:00.000Z
    exif[piexif.ExifIFD.DateTimeOriginal!] = `${d.slice(0, 10).replace(/-/g, ":")} ${d.slice(11, 19)}`;
  }
  const gps: Record<number, unknown> = {};
  if (opts.gps) {
    gps[piexif.GPSIFD.GPSLatitudeRef!] = opts.gps.lat >= 0 ? "N" : "S";
    gps[piexif.GPSIFD.GPSLatitude!] = piexif.GPSHelper.degToDmsRational(opts.gps.lat);
    gps[piexif.GPSIFD.GPSLongitudeRef!] = opts.gps.lng >= 0 ? "E" : "W";
    gps[piexif.GPSIFD.GPSLongitude!] = piexif.GPSHelper.degToDmsRational(opts.gps.lng);
  }
  const bytes = piexif.dump({ "0th": zeroth, Exif: exif, GPS: gps });
  return Buffer.from(piexif.insert(bytes, jpeg.toString("binary")), "binary");
}

/** Offset a lat/lng by metres north/east. */
export function offsetM(p: { lat: number; lng: number }, northM: number, eastM: number) {
  return { lat: p.lat + northM / 111_320, lng: p.lng + eastM / (111_320 * Math.cos((p.lat * Math.PI) / 180)) };
}

/** The "fraud": someone else's photo re-sent through a messaging app: trimmed 3%, resized, brightened, recompressed. */
export async function launder(jpeg: Buffer): Promise<Buffer> {
  const { width = 1280, height = 760 } = await sharp(jpeg).metadata();
  const dx = Math.round(width * 0.03);
  const dy = Math.round(height * 0.03);
  return sharp(jpeg)
    .extract({ left: dx, top: dy, width: width - 2 * dx, height: height - 2 * dy })
    .resize(Math.round(width * 0.92))
    .modulate({ brightness: 1.05 })
    .jpeg({ quality: 70 })
    .toBuffer();
}

// ---------------------------------------------------------------------------- main
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

async function main() {
  const site = GEO.mapleSite;
  const T = FIX.times;
  const src = (name: string) => readFile(join(OUT, "source", `${name}.jpg`));
  const write = async (rel: string, buf: Buffer | string) => {
    await mkdir(dirname(join(OUT, rel)), { recursive: true });
    await writeFile(join(OUT, rel), buf);
    console.log(`  ${rel.padEnd(70)} ${(Buffer.byteLength(buf) / 1024).toFixed(1)} KB`);
  };
  const P = PATHS;
  const photo = async (rel: string, source: string, takenAt: string, gps: { lat: number; lng: number } | undefined) =>
    write(rel, stampExif(await src(source), { takenAt, gps }));

  // Oak Ave (a different project, last year): the photo that gets reused
  await photo(P.oak, "oak_ave_roof_framing", T.oakPhoto, GEO.oakSite);

  // Maple St, milestone 1 (Foundation): on site, after escrow
  await photo(P.foundation.wide, "foundation_wide", T.m1Photos[0]!, offsetM(site, 22, -15));
  await photo(P.foundation.bolts, "foundation_anchor_bolt", T.m1Photos[1]!, offsetM(site, -18, 30));
  await photo(P.foundation.walls, "foundation_walls_closeup", T.m1Photos[2]!, offsetM(site, 5, 8));
  await photo(P.foundation.wallsOffsite, "foundation_walls_closeup", T.m1Photos[2]!, GEO.offsite); // scenario C: ~2.6 km away

  // Maple St, milestone 2 (Framing): three genuine + one copy of the Oak Ave photo (fresh date, in-geofence GPS, neutral name)
  await photo(P.framing.a, "framing_a", T.m2Photos[0]!, offsetM(site, 12, -20));
  await photo(P.framing.b, "framing_b", T.m2Photos[1]!, offsetM(site, -25, 10));
  await photo(P.framing.c, "framing_c", T.m2Photos[2]!, offsetM(site, 3, 26));
  await write(
    P.framing.reused,
    stampExif(await launder(await src("oak_ave_roof_framing")), { takenAt: "2026-10-23T16:25:00Z", gps: offsetM(site, -6, 12) }),
  );

  // Inspector photos (taken on the day of each audit)
  const auditAt = { foundation: "2026-10-21T15:30:00Z", framing: "2026-10-24T14:30:00Z" };
  await photo(P.auditPhotos.foundation[0]!, "foundation_rebar", "2026-10-21T15:10:00Z", offsetM(site, 4, -6));
  await photo(P.auditPhotos.foundation[1]!, "foundation_site_east", "2026-10-21T15:25:00Z", offsetM(site, -10, 12));
  await photo(P.auditPhotos.framing[0]!, "framing_detail", "2026-10-24T14:10:00Z", offsetM(site, 6, 4));

  // Documents (synthetic) + a note that milestone 3 has no evidence yet
  for (const [rel, text] of Object.entries(FIX.docs)) await write(rel, text);
  await write(P.dryInNote, "Milestone 3 (Roof & Dry-in) is escrowed but no evidence has been submitted yet, and no inspector audit exists.\n");

  // Inspector audits, each bound to the exact builder bundle it covers
  const mkAudit = async (
    auditPath: string,
    scenarioKey: string,
    inspector: string,
    milestoneId: string,
    at: string,
    photos: string[],
    checklist: InspectorAudit["checklist"],
    notes: string,
  ) => {
    const scenario = SCENARIOS.find((s) => s.key === scenarioKey)!;
    const bundle = await Promise.all(scenario.evidencePaths.map((p) => fixtureEvidence(p, p.endsWith(".jpg") ? "photo" : "document")));
    const audit: InspectorAudit = {
      milestoneId,
      inspector,
      evidenceBundleHash: evidenceBundleHash(bundle),
      checklist,
      photos: await Promise.all(photos.map((p) => fixtureEvidence(p, "photo", at))),
      notes,
      txHash: sha(`MOCK audit attestation ${auditPath}`).toUpperCase(),
      at,
    };
    await write(auditPath, JSON.stringify(audit, null, 2) + "\n");
  };
  const RIVERA = "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh";
  const CHEN = "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY";
  const foundationLines: InspectorAudit["checklist"] = [
    { sovCode: "F-01", status: "done", note: "Footings and stem walls match the approved plans." },
    { sovCode: "F-02", status: "done", note: "Slab cured, hairline shrinkage cracks only." },
    { sovCode: "F-03", status: "done", note: "Anchor bolts present at plan spacing." },
  ];
  const foundationNotes = "Foundation walls and slab complete per plans. I walked the site and took the attached photos.";
  await mkAudit(P.audits.foundation, "A", RIVERA, "ms_maple_1", auditAt.foundation, P.auditPhotos.foundation, foundationLines, foundationNotes);
  await mkAudit(P.audits.foundationOffsite, "C", RIVERA, "ms_maple_1", auditAt.foundation, P.auditPhotos.foundation, foundationLines, foundationNotes);
  await mkAudit(P.audits.foundationShortInvoice, "D", RIVERA, "ms_maple_1", auditAt.foundation, P.auditPhotos.foundation, foundationLines, foundationNotes);
  await mkAudit(
    P.audits.framing,
    "B",
    CHEN,
    "ms_maple_2",
    auditAt.framing,
    P.auditPhotos.framing,
    [
      { sovCode: "FR-01", status: "done", note: "Exterior walls framed on all four sides." },
      { sovCode: "FR-02", status: "done", note: "Roof trusses set at 24 in. on centre." },
      { sovCode: "FR-03", status: "partial", note: "Sheathing on three of four walls; north wall still open." },
    ],
    "Framing is nearly complete. Sheathing is not finished on the north wall.",
  );

  // manifest.json: expected outcome + failing checks per scenario
  const manifest = {
    version: 1,
    note: "Ground truth for the verifier eval harness (VER-10) and tests. `failingChecks` must come back `fail`, `warnChecks` must come back `warn`. Audit checks are produced from VER-03 onward. Photos: see SOURCES.txt.",
    scenarios: SCENARIOS.map((s) => ({
      key: s.key,
      title: s.title,
      milestoneId: s.milestoneIndex === 0 ? "ms_maple_1" : "ms_maple_2",
      evidence: s.evidencePaths,
      audit: s.auditPath,
      expect: s.expect,
      failingChecks: s.failingChecks,
      warnChecks: s.warnChecks,
      ...(s.pending ? { pending: s.pending } : {}),
    })),
  };
  await write("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
