import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import { extractEvidenceMeta, hammingDistance, parseExifDate, parseInvoiceTotal, perceptualHash } from "../src/index.ts";
import { FIXTURES_DIR, GEO, PATHS } from "../fixtures/scenarios.ts";
import { haversineM, toCents, centsToString } from "../src/util.ts";

const fixture = (rel: string) => readFile(join(FIXTURES_DIR, rel));

test("hammingDistance", () => {
  assert.equal(hammingDistance("0000000000000000", "0000000000000000"), 0);
  assert.equal(hammingDistance("0000000000000000", "ffffffffffffffff"), 64);
  assert.equal(hammingDistance("0000000000000001", "0000000000000003"), 1);
});

test("parseExifDate: naive EXIF is UTC; offset respected", () => {
  assert.equal(parseExifDate("2026:10:19 14:05:00"), "2026-10-19T14:05:00.000Z");
  assert.equal(parseExifDate("2026:10:19 14:05:00", "-04:00"), "2026-10-19T18:05:00.000Z");
  assert.equal(parseExifDate("garbage"), undefined);
  assert.equal(parseExifDate(undefined), undefined);
});

test("parseInvoiceTotal: text and JSON, last TOTAL wins, money as decimal string", () => {
  assert.equal(parseInvoiceTotal("Subtotal 10.00\nTOTAL: $24,850.00\n"), "24850.00");
  assert.equal(parseInvoiceTotal("Total due 1,200\nGrand Total: 1,250.5"), "1250.50");
  assert.equal(parseInvoiceTotal('{"vendor":"x","total":"18400"}'), "18400.00");
  assert.equal(parseInvoiceTotal("no money here"), undefined);
});

test("money helpers use integer cents", () => {
  assert.equal(toCents("25000.00"), 2_500_000n);
  assert.equal(toCents("0.1"), 10n);
  assert.equal(centsToString(toCents("1,234.567")), "1234.56");
});

test("extractEvidenceMeta reads EXIF time + GPS and computes sha256 + pHash", async () => {
  const bytes = await fixture(PATHS.foundation.wide);
  const m = await extractEvidenceMeta({ bytes, mimeType: "image/jpeg" });
  assert.match(m.sha256, /^[0-9a-f]{64}$/);
  assert.match(m.meta.perceptualHash!, /^[0-9a-f]{16}$/);
  assert.equal(m.meta.takenAt, "2026-10-19T14:05:00.000Z");
  assert.ok(m.meta.gps);
  assert.ok(haversineM(m.meta.gps!, GEO.mapleSite) < 60);
});

test("extractEvidenceMeta on a text invoice extracts the total", async () => {
  const bytes = await fixture(PATHS.foundation.invoice);
  const m = await extractEvidenceMeta({ bytes, mimeType: "text/plain", filename: "invoice-concrete.txt" });
  assert.equal(m.meta.invoiceTotal, "24850.00");
});

test("perceptual hash survives recompression/resizing but separates different scenes", async () => {
  const a = await fixture(PATHS.framing.a);
  const recompressed = await sharp(a).resize(300).jpeg({ quality: 40 }).toBuffer();
  const other = await fixture(PATHS.foundation.walls);
  const [ha, hr, ho] = await Promise.all([perceptualHash(a), perceptualHash(recompressed), perceptualHash(other)]);
  assert.ok(hammingDistance(ha, hr) <= 4, `recompressed distance ${hammingDistance(ha, hr)}`);
  assert.ok(hammingDistance(ha, ho) > 16, `different-scene distance ${hammingDistance(ha, ho)}`);
});

test("perceptual hash survives a small crop + brightness change (typical 'laundered' reuse)", async () => {
  const a = await fixture(PATHS.framing.b);
  const { width = 0, height = 0 } = await sharp(a).metadata();
  const laundered = await sharp(a)
    .extract({ left: Math.round(width * 0.03), top: Math.round(height * 0.03), width: Math.round(width * 0.94), height: Math.round(height * 0.94) })
    .modulate({ brightness: 1.1 })
    .jpeg({ quality: 55 })
    .toBuffer();
  const d = hammingDistance(await perceptualHash(a), await perceptualHash(laundered));
  assert.ok(d <= 10, `crop+brightness distance ${d}`);
});

test("the reused fixture is a near-duplicate of the Oak Ave original, with a fresh date and in-geofence GPS", async () => {
  const [orig, copy] = await Promise.all([fixture(PATHS.oak), fixture(PATHS.framing.reused)]);
  const [mo, mc] = await Promise.all([
    extractEvidenceMeta({ bytes: orig, mimeType: "image/jpeg" }),
    extractEvidenceMeta({ bytes: copy, mimeType: "image/jpeg" }),
  ]);
  assert.notEqual(mo.sha256, mc.sha256);
  assert.ok(hammingDistance(mo.meta.perceptualHash!, mc.meta.perceptualHash!) <= 6, "pHash alone must catch the copy");
  assert.ok(new Date(mc.meta.takenAt!) > new Date("2026-10-15T14:00:00Z"), "EXIF date is fresh (after the escrow): only pHash can catch it");
  assert.ok(haversineM(mc.meta.gps!, GEO.mapleSite) < 60, "GPS is inside the Maple St geofence");
  assert.doesNotMatch(PATHS.framing.reused, /reus|oak|copy/i, "neutral file name");
});

test("every distinct fixture photo is far from every other (no false pHash matches)", async () => {
  const rels = [
    PATHS.foundation.wide, PATHS.foundation.bolts, PATHS.foundation.walls,
    PATHS.framing.a, PATHS.framing.b, PATHS.framing.c, PATHS.oak,
    ...PATHS.auditPhotos.foundation, ...PATHS.auditPhotos.framing,
  ];
  const hashes = await Promise.all(rels.map(async (r) => perceptualHash(await fixture(r))));
  for (let i = 0; i < rels.length; i++) {
    for (let j = i + 1; j < rels.length; j++) {
      const d = hammingDistance(hashes[i]!, hashes[j]!);
      assert.ok(d > 16, `${rels[i]} vs ${rels[j]} distance ${d}`);
    }
  }
});
