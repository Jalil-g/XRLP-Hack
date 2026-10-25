import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import sharp from "sharp";
import { extractEvidenceMeta, hammingDistance, loadEvidence, parseExifDate, perceptualHash } from "../src/meta.ts";
import { SCENARIOS } from "../fixtures/scenarios.ts";

test("stripping EXIF does not resurrect caller-provided GPS, date, hash or invoice total", async () => {
  const input = await SCENARIOS[0]!.input();
  const ev = input.evidence[0]!;
  const bytes = await sharp(await readFile(new URL(`../fixtures/${ev.uri}`, import.meta.url))).jpeg().toBuffer();
  const loaded = await loadEvidence({ ...ev, sha256: "forged", meta: { ...ev.meta, invoiceTotal: "9999" } }, { files: { [ev.id]: bytes } });
  assert.equal(loaded.meta.gps, undefined);
  assert.equal(loaded.meta.takenAt, undefined);
  assert.equal(loaded.meta.invoiceTotal, undefined);
  assert.notEqual(loaded.sha256, "forged");
  assert.equal(loaded.meta.perceptualHash, await perceptualHash(bytes));
});

test("corrupt image and missing file are recorded without trusting stored metadata", async () => {
  const ev = (await SCENARIOS[0]!.input()).evidence[0]!;
  const corrupt = await loadEvidence(ev, { files: { [ev.id]: Buffer.from("not an image") } });
  assert.match(corrupt.loadError!, /decoded/);
  assert.deepEqual(corrupt.meta, {});
  const missing = await loadEvidence({ ...ev, uri: "nonexistent.jpg" }, { dataDir: "/nonexistent-fixture-root" });
  assert.ok(missing.loadError);
  assert.deepEqual(missing.meta, {});
});

test("transparent and flattened opaque images have identical pHash", async () => {
  const transparent = await sharp({ create: { width: 120, height: 90, channels: 4, background: { r: 30, g: 90, b: 150, alpha: 0.5 } } }).png().toBuffer();
  const flat = await sharp(transparent).flatten({ background: "#fff" }).png().toBuffer();
  assert.equal(await perceptualHash(transparent), await perceptualHash(flat));
});

test("invalid dates, offsets and hash lengths are rejected", () => {
  assert.equal(parseExifDate("2026:02:30 12:00:00"), undefined);
  assert.equal(parseExifDate("2026:10:20 24:00:00"), undefined);
  assert.equal(parseExifDate("2026:10:20 12:00:00", "+25:00"), undefined);
  assert.equal(parseExifDate("2026:10:20 12:00:00", "+02:00"), "2026-10-20T10:00:00.000Z");
  assert.throws(() => hammingDistance("abc", "ffffffffffffffff"), /64-bit/);
  assert.throws(() => hammingDistance("z".repeat(16), "0".repeat(16)), /64-bit/);
});

test("upload extraction reports an unreadable photo without crashing", async () => {
  const result = await extractEvidenceMeta({ bytes: Buffer.from("bad"), mimeType: "image/jpeg" });
  assert.ok(result.error);
  assert.equal(result.sha256.length, 64);
  assert.deepEqual(result.meta, {});
});
