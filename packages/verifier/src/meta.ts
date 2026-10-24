// Evidence preprocessing: sha256, perceptual hash (dHash), EXIF time + GPS, invoice totals.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import exifr from "exifr";
import sharp from "sharp";
import type { Evidence } from "@xrlp/shared";
import { resolveDataDir } from "./config.ts";
import { centsToString, toCents } from "./util.ts";
import type { LoadedEvidence } from "./types.ts";

export interface EvidenceFile {
  bytes: Uint8Array;
  mimeType: string;
  filename?: string;
}

export interface ExtractedMeta {
  sha256: string;
  meta: {
    takenAt?: string;
    gps?: { lat: number; lng: number };
    perceptualHash?: string;
    invoiceTotal?: string;
  };
  /** Decoded text for text/JSON documents (not part of Evidence; handy for callers/LLM). */
  text?: string;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function isImage(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export function isTextLike(mimeType: string, filename = ""): boolean {
  return (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    /\.(txt|json|md|csv)$/i.test(filename)
  );
}

/**
 * dHash ("difference hash"): grayscale 9x8, compare horizontal neighbours -> 64 bits -> 16 hex chars.
 * Robust to re-compression, resizing, small crops and brightness changes — exactly what a reused photo looks like.
 */
export async function perceptualHash(bytes: Uint8Array): Promise<string> {
  const px = await sharp(bytes)
    .rotate() // respect EXIF orientation
    .greyscale()
    .resize(9, 8, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer();
  let bits = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const left = px[y * 9 + x]!;
      const right = px[y * 9 + x + 1]!;
      bits = (bits << 1n) | (left > right ? 1n : 0n);
    }
  }
  return bits.toString(16).padStart(16, "0");
}

/** Hamming distance between two 64-bit hex hashes (0 = identical, 64 = opposite). */
export function hammingDistance(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

/** EXIF "YYYY:MM:DD HH:MM:SS" (+ optional "+HH:MM" offset). No offset => treated as UTC (documented). */
export function parseExifDate(raw: unknown, offset?: unknown): string | undefined {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? undefined : raw.toISOString();
  if (typeof raw !== "string") return undefined;
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim());
  if (!m) return undefined;
  const off = typeof offset === "string" && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : "Z";
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${off}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export async function readExif(bytes: Uint8Array): Promise<{ takenAt?: string; gps?: { lat: number; lng: number } }> {
  let tags: Record<string, unknown> | undefined;
  try {
    tags = await exifr.parse(Buffer.from(bytes), { reviveValues: false });
  } catch {
    return {};
  }
  if (!tags) return {};
  const takenAt =
    parseExifDate(tags.DateTimeOriginal, tags.OffsetTimeOriginal) ??
    parseExifDate(tags.CreateDate, tags.OffsetTimeDigitized) ??
    parseExifDate(tags.DateTime, tags.OffsetTime);
  const lat = tags.latitude;
  const lng = tags.longitude;
  const gps =
    typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng)
      ? { lat, lng }
      : undefined;
  return { ...(takenAt ? { takenAt } : {}), ...(gps ? { gps } : {}) };
}

/** Pull a total out of a text or JSON invoice. Returns an Rlusd decimal string or undefined. */
export function parseInvoiceTotal(text: string): string | undefined {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const j = JSON.parse(trimmed) as Record<string, unknown>;
      for (const k of ["total", "amountDue", "amount_due", "grandTotal", "grand_total"]) {
        const v = j[k];
        if (typeof v === "number" || typeof v === "string") return centsToString(toCents(String(v)));
      }
    } catch {
      /* fall through to text */
    }
  }
  const re = /^\s*(?:grand\s+)?total(?:\s+(?:due|amount))?\s*[:=\-]?\s*(?:RLUSD|USD|US\$|\$)?\s*([\d,]+(?:\.\d{1,6})?)/gim;
  let last: string | undefined;
  for (const m of trimmed.matchAll(re)) last = m[1];
  return last ? centsToString(toCents(last)) : undefined;
}

/**
 * Compute everything the verifier needs from one uploaded file.
 * Call this at upload time and store the result on Evidence (sha256 + meta) so later
 * submissions anywhere on the platform can be checked for photo reuse.
 */
export async function extractEvidenceMeta(file: EvidenceFile): Promise<ExtractedMeta> {
  const sha256 = sha256Hex(file.bytes);
  const meta: ExtractedMeta["meta"] = {};
  let text: string | undefined;
  if (isImage(file.mimeType)) {
    Object.assign(meta, await readExif(file.bytes));
    try {
      meta.perceptualHash = await perceptualHash(file.bytes);
    } catch {
      /* undecodable image: leave hash empty; duplicate check will fall back to sha256 */
    }
  } else if (isTextLike(file.mimeType, file.filename)) {
    text = Buffer.from(file.bytes).toString("utf8");
    const total = parseInvoiceTotal(text);
    if (total) meta.invoiceTotal = total;
  }
  return { sha256, meta, ...(text !== undefined ? { text } : {}) };
}

/** Resolve evidence bytes: explicit map > data: URL > absolute path > path relative to dataDir. */
export async function loadEvidenceBytes(
  ev: Evidence,
  opts: { files?: Record<string, Uint8Array>; dataDir?: string } = {},
): Promise<Uint8Array> {
  const given = opts.files?.[ev.id];
  if (given) return given;
  if (ev.uri.startsWith("data:")) {
    const comma = ev.uri.indexOf(",");
    const header = ev.uri.slice(5, comma);
    const body = ev.uri.slice(comma + 1);
    return header.endsWith(";base64") ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body), "utf8");
  }
  const path = isAbsolute(ev.uri) ? ev.uri : join(resolveDataDir(opts.dataDir), ev.uri);
  return readFile(path);
}

/** Load bytes and fill any missing meta. Never throws: load errors are recorded on the result. */
export async function loadEvidence(
  ev: Evidence,
  opts: { files?: Record<string, Uint8Array>; dataDir?: string } = {},
): Promise<LoadedEvidence> {
  let bytes: Uint8Array;
  try {
    bytes = await loadEvidenceBytes(ev, opts);
  } catch (e) {
    return { evidence: ev, bytes: null, sha256: null, meta: ev.meta ?? {}, text: null, loadError: String(e) };
  }
  const extracted = await extractEvidenceMeta({ bytes, mimeType: ev.mimeType, filename: ev.filename });
  // Bytes are ground truth: recomputed values win; stored meta only fills gaps
  // (e.g. an invoiceTotal keyed in by core for a PDF we can't parse deterministically).
  const meta = { ...stripUndefined(ev.meta ?? {}), ...extracted.meta };
  return { evidence: ev, bytes, sha256: extracted.sha256, meta, text: extracted.text ?? null };
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
