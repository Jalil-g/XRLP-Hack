// Demo evidence: tiny SVG "photos"/documents as data: URLs (render in the browser, deterministic sha256).
// Meta stands in for what EXIF/pHash extraction would return (the verifier does this for real uploads).
import type { Rlusd } from "@xrlp/shared";
import { sha256Hex } from "../ids.ts";
import type { EvidenceFile } from "../service.ts";

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

function svgCard(title: string, subtitle: string, hue: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420"><rect width="640" height="420" fill="hsl(${hue},35%,78%)"/><rect x="40" y="250" width="560" height="130" fill="hsl(${hue},20%,55%)"/><text x="320" y="160" font-family="sans-serif" font-size="34" text-anchor="middle" fill="#1d2433">${esc(title)}</text><text x="320" y="205" font-family="sans-serif" font-size="18" text-anchor="middle" fill="#334">${esc(subtitle)}</text></svg>`;
}

const dataUrl = (mime: string, body: string) => `data:${mime};base64,${Buffer.from(body).toString("base64")}`;

function file(kind: EvidenceFile["kind"], filename: string, body: string, meta: EvidenceFile["meta"]): EvidenceFile {
  const sha256 = sha256Hex(body);
  return { kind, fileId: sha256.slice(0, 24), filename, mimeType: "image/svg+xml", uri: dataUrl("image/svg+xml", body), sha256, bytes: body.length, meta };
}

export function demoPhoto(opts: { label: string; filename: string; takenAt: Date | string; gps?: { lat: number; lng: number }; hue?: number }): EvidenceFile {
  const takenAt = new Date(opts.takenAt).toISOString();
  const body = svgCard(opts.label, `taken ${takenAt.slice(0, 16).replace("T", " ")}`, opts.hue ?? 30);
  return file("photo", opts.filename, body, { takenAt, gps: opts.gps, perceptualHash: sha256Hex(body).slice(0, 16) });
}

/** The same image bytes re-uploaded under a new name (the reused-photo fraud). */
export const reupload = (photo: EvidenceFile, filename: string): EvidenceFile => ({ ...photo, filename });

export function demoDoc(opts: { kind: "invoice" | "document"; filename: string; title: string; invoiceTotal?: Rlusd }): EvidenceFile {
  const body = svgCard(opts.title, opts.invoiceTotal ? `Total: ${opts.invoiceTotal} RLUSD` : opts.filename, 210);
  return file(opts.kind, opts.filename, body, opts.invoiceTotal ? { invoiceTotal: opts.invoiceTotal } : {});
}

/** Offsets a site geo by ~meters north (for "on site" / "off site" photos). */
export const nearby = (geo: { lat: number; lng: number }, metersNorth = 20) => ({ lat: geo.lat + metersNorth / 111_111, lng: geo.lng });
