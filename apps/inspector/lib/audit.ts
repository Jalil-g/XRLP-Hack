// INS-03 audit logic, free of React so it is unit-tested (test/audit.test.ts). Works in the browser and in Node:
// hashing uses Web Crypto, EXIF uses exifr (the same parser and options as packages/verifier/src/meta.ts). The lite build
// (JPEG/HEIC/TIFF, EXIF + GPS) because the full one probes for Node's fs/zlib and logs "Couldn't load fs" in the Next bundle.
import exifr from "exifr/dist/lite.esm.mjs";
import type { ChecklistStatus, Evidence, InspectorAudit, InspectorTask, SiteGeo } from "./types.ts";

// ---------------------------------------------------------------- hashing

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(data: BufferSource | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

/**
 * Binds the audit to the exact builder evidence it covers. MUST equal packages/verifier/src/audit.ts `evidenceBundleHash`:
 * sha256 over the sorted per-file sha256 values joined by "\n". A mismatch fails `inspector_audit_present`.
 * The bundle is ALL of the milestone's builder evidence (the verifier hashes every loaded file), not only the files opened.
 */
export function evidenceBundleHash(evidence: readonly Pick<Evidence, "sha256">[]): Promise<string> {
  return sha256Hex(evidence.map((e) => e.sha256).sort().join("\n"));
}

// ---------------------------------------------------------------- EXIF

/** EXIF "YYYY:MM:DD HH:MM:SS" (+ optional "+HH:MM" offset); no offset → UTC. Same rule as the verifier's parseExifDate. */
export function parseExifDate(raw: unknown, offset?: unknown): string | undefined {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? undefined : raw.toISOString();
  if (typeof raw !== "string") return undefined;
  const m = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim());
  if (!m) return undefined;
  const off = typeof offset === "string" && /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : "Z";
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${off}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export type PhotoMeta = { takenAt?: string; gps?: { lat: number; lng: number } };

/** What the suite will read from this photo. Unreadable / EXIF-less files → {} (the preview says so). */
export async function readPhotoMeta(bytes: ArrayBuffer | Uint8Array): Promise<PhotoMeta> {
  let tags: Record<string, unknown> | undefined;
  try {
    tags = await exifr.parse(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { reviveValues: false });
  } catch {
    return {};
  }
  if (!tags) return {};
  const takenAt =
    parseExifDate(tags.DateTimeOriginal, tags.OffsetTimeOriginal) ??
    parseExifDate(tags.CreateDate, tags.OffsetTimeDigitized) ??
    parseExifDate(tags.DateTime, tags.OffsetTime);
  const { latitude: lat, longitude: lng } = tags;
  const gps = typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;
  return { ...(takenAt ? { takenAt } : {}), ...(gps ? { gps } : {}) };
}

/**
 * Builder photos whose stored record has no EXIF time / GPS (core does not extract it at upload today) get it read from the
 * file bytes with the verifier's parser. Stored values always win; `browserRead` lists the photos where something was added,
 * so the UI can say it came from this browser, not from core's record. Unreadable files are left as they are.
 */
export async function withBrowserExif(
  evidence: readonly Evidence[],
  load: (e: Evidence) => Promise<ArrayBuffer>,
): Promise<{ evidence: Evidence[]; browserRead: Set<string> }> {
  const browserRead = new Set<string>();
  const out = await Promise.all(
    evidence.map(async (e) => {
      if (e.kind !== "photo" || (e.meta.takenAt && e.meta.gps)) return e;
      let read: PhotoMeta;
      try {
        read = await readPhotoMeta(await load(e));
      } catch {
        return e;
      }
      const add: PhotoMeta = {
        ...(!e.meta.takenAt && read.takenAt ? { takenAt: read.takenAt } : {}),
        ...(!e.meta.gps && read.gps ? { gps: read.gps } : {}),
      };
      if (!add.takenAt && !add.gps) return e;
      browserRead.add(e.id);
      return { ...e, meta: { ...e.meta, ...add } };
    }),
  );
  return { evidence: out, browserRead };
}

// ---------------------------------------------------------------- site geometry

const EARTH_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type GeoVerdict = { state: "inside" | "outside" | "no_gps"; distanceM?: number };

/** Inside the site geofence? (The suite adds its own slack in `gps_within_site`; this is the strict view.) */
export function geoVerdict(site: SiteGeo, gps?: { lat: number; lng: number }): GeoVerdict {
  if (!gps) return { state: "no_gps" };
  const d = distanceM(site, gps);
  return { state: d <= site.radiusM ? "inside" : "outside", distanceM: d };
}

/** Local east/north offset in metres from the site centre (equirectangular; fine at site scale) for the SVG map. */
export function offsetM(site: { lat: number; lng: number }, p: { lat: number; lng: number }): { x: number; y: number } {
  return { x: rad(p.lng - site.lng) * EARTH_M * Math.cos(rad(site.lat)), y: rad(p.lat - site.lat) * EARTH_M };
}

// ---------------------------------------------------------------- the draft → InspectorAudit

export type ChecklistDraft = Record<string /* sovCode */, { status?: ChecklistStatus; note: string }>;

export type DraftPhoto = { file: Blob; evidence: Evidence };

export type AuditDraft = { checklist: ChecklistDraft; photos: DraftPhoto[]; notes: string };

export const emptyDraft = (task: Pick<InspectorTask, "sov">): AuditDraft => ({
  checklist: Object.fromEntries(task.sov.map((l) => [l.code, { note: "" }])),
  photos: [],
  notes: "",
});

export type DraftProblem = { field: string; message: string };

/**
 * What blocks submission. Every SoV line needs a status; `partial` / `not_done` need a note (the AI's
 * `audit_matches_evidence` reads it, and a bare "not done" is useless to the builder); at least one site photo.
 */
export function draftProblems(task: Pick<InspectorTask, "sov">, draft: AuditDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  for (const line of task.sov) {
    const entry = draft.checklist[line.code];
    if (!entry?.status) problems.push({ field: `checklist.${line.code}`, message: `${line.code} ${line.title}: pick done, partial or not done` });
    else if (entry.status !== "done" && !entry.note.trim()) {
      problems.push({ field: `checklist.${line.code}`, message: `${line.code} ${line.title}: say what is ${entry.status === "partial" ? "missing" : "not done"}` });
    }
  }
  if (draft.photos.length === 0) problems.push({ field: "photos", message: "Add at least one site photo" });
  return problems;
}

/** Turn a picked file into the `Evidence` entry the audit carries (core re-derives its own on upload; mock keeps this). */
export async function photoEvidence(file: Blob & { name?: string }, uploadedAt: string): Promise<Evidence> {
  const bytes = await file.arrayBuffer();
  const [sha256, meta] = await Promise.all([sha256Hex(bytes), readPhotoMeta(bytes)]);
  return {
    id: `inspector-photo:${sha256.slice(0, 16)}`,
    kind: "photo",
    filename: file.name || `site-${sha256.slice(0, 8)}.jpg`,
    mimeType: file.type || "image/jpeg",
    uri: "",
    sha256,
    meta,
    uploadedAt,
  };
}

/** The `InspectorAudit` for route 10. `txHash` is filled in by core from the attestation tx. */
export async function buildAudit(
  task: Pick<InspectorTask, "sov" | "evidence"> & { milestone: { id: string } },
  inspector: string,
  draft: AuditDraft,
  at: string,
): Promise<InspectorAudit> {
  const problems = draftProblems(task, draft);
  if (problems.length) throw new Error(`Audit incomplete: ${problems.map((p) => p.message).join("; ")}`);
  return {
    milestoneId: task.milestone.id,
    inspector,
    evidenceBundleHash: await evidenceBundleHash(task.evidence),
    checklist: task.sov.map((l) => {
      const { status, note } = draft.checklist[l.code]!;
      return { sovCode: l.code, status: status!, ...(note.trim() ? { note: note.trim() } : {}) };
    }),
    photos: draft.photos.map((p) => p.evidence),
    notes: draft.notes.trim(),
    at,
  };
}
