// Generates synthetic demo fixtures (no third-party photos => no licensing questions).
//   pnpm --filter @xrlp/verifier fixtures
// Photos are stylised SVG scenes rendered to JPEG by sharp, with EXIF time/GPS written by piexifjs.
// Re-running is deterministic. Also exports stampExif() for re-dating photos on demo day.
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import piexif from "piexifjs";
import sharp from "sharp";
import { FIX, GEO } from "../fixtures/scenarios.ts";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "..", "fixtures");
const W = 384;
const H = 256;

// ---------------------------------------------------------------------------- EXIF
/** Write EXIF capture time (UTC, no offset tag) and optional GPS into a JPEG. */
export function stampExif(jpeg: Buffer, opts: { takenAt?: string; gps?: { lat: number; lng: number } }): Buffer {
  const zeroth: Record<number, unknown> = { [piexif.ImageIFD.Make!]: "XRLP", [piexif.ImageIFD.Model!]: "SyntheticCam (demo fixture)" };
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

// ---------------------------------------------------------------------------- scenes
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function speckle(r: () => number, n: number, y0: number, y1: number, colors: string[]) {
  let out = "";
  for (let i = 0; i < n; i++) {
    const c = colors[Math.floor(r() * colors.length)];
    out += `<circle cx="${(r() * W).toFixed(1)}" cy="${(y0 + r() * (y1 - y0)).toFixed(1)}" r="${(0.6 + r() * 1.6).toFixed(1)}" fill="${c}"/>`;
  }
  return out;
}

const sky = (top: string, bottom: string, horizon: number) =>
  `<defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs>` +
  `<rect width="${W}" height="${horizon}" fill="url(#s)"/>`;
const ground = (horizon: number, color = "#7a5c3e") => `<rect y="${horizon}" width="${W}" height="${H - horizon}" fill="${color}"/>`;

function bolts(x0: number, x1: number, y: number, n: number, h: number) {
  let s = "";
  for (let i = 0; i < n; i++) {
    const x = x0 + ((x1 - x0) * i) / (n - 1);
    s += `<rect x="${x - 1.5}" y="${y - h}" width="3" height="${h}" fill="#2b2b2b"/><rect x="${x - 4}" y="${y - 3}" width="8" height="3" fill="#555"/>`;
  }
  return s;
}

function studs(x0: number, x1: number, yTop: number, yBot: number, spacing: number, color = "#d9b77e") {
  let s = `<rect x="${x0}" y="${yTop - 6}" width="${x1 - x0}" height="6" fill="${color}"/><rect x="${x0}" y="${yBot}" width="${x1 - x0}" height="5" fill="${color}"/>`;
  for (let x = x0; x <= x1 - 4; x += spacing) s += `<rect x="${x}" y="${yTop}" width="5" height="${yBot - yTop}" fill="${color}"/>`;
  return s;
}

function trusses(x0: number, x1: number, y: number, peak: number, n: number, color = "#c9a46a") {
  let s = "";
  const mid = (x0 + x1) / 2;
  for (let i = 0; i < n; i++) {
    const dx = i * 7;
    s += `<polyline points="${x0 + dx},${y} ${mid + dx},${y - peak} ${x1 + dx},${y}" fill="none" stroke="${color}" stroke-width="4"/>`;
  }
  return s;
}

type SceneKey = "foundation_wide" | "foundation_bolts" | "foundation_closeup" | "framing_wide" | "framing_corner" | "framing_wall" | "oak_framing";

function scene(key: SceneKey, seed: number): string {
  const r = rng(seed);
  const dirt = speckle(r, 260, 150, H, ["#5e452e", "#8d6c4b", "#6b4f35"]);
  let body = "";
  switch (key) {
    case "foundation_wide":
      body = sky("#6fa8dc", "#cfe2f3", 120) + ground(120) + dirt +
        `<ellipse cx="60" cy="150" rx="70" ry="22" fill="#5b4330"/>` +
        `<polygon points="90,215 330,215 300,150 120,150" fill="#a9a9a9"/>` +
        `<polygon points="90,215 330,215 330,224 90,224" fill="#8a8a8a"/>` + bolts(130, 295, 156, 7, 9) +
        `<rect x="330" y="120" width="40" height="26" fill="#f1c232"/><rect x="345" y="104" width="18" height="18" fill="#f1c232"/>`;
      break;
    case "foundation_bolts":
      body = sky("#7bb3e0", "#dbe9f6", 70) + ground(70, "#6e5238") +
        `<polygon points="0,256 384,256 384,120 0,140" fill="#b3b3b3"/>` + speckle(r, 400, 140, H, ["#9a9a9a", "#c4c4c4"]) +
        bolts(30, 360, 150, 6, 30) + `<rect x="0" y="134" width="384" height="8" fill="#6b6b6b"/>`;
      break;
    case "foundation_closeup":
      body = `<rect width="${W}" height="${H}" fill="#9e9e9e"/>` + speckle(r, 900, 0, H, ["#8a8a8a", "#b0b0b0", "#7a7a7a"]) +
        `<rect x="170" y="40" width="14" height="140" fill="#262626"/><rect x="150" y="170" width="54" height="12" fill="#4a4a4a"/>` +
        `<rect x="0" y="210" width="384" height="46" fill="#6b5039"/>` + `<rect x="250" y="60" width="110" height="18" fill="#f1c232"/>`;
      break;
    case "framing_wide":
      body = sky("#6fa8dc", "#cfe2f3", 120) + ground(120) + dirt +
        `<polygon points="70,222 320,222 320,212 70,212" fill="#a9a9a9"/>` + studs(80, 310, 130, 207, 14) + trusses(80, 310, 124, 60, 1);
      break;
    case "framing_corner":
      body = sky("#86bde8", "#e3eef8", 90) + ground(90, "#6e5238") +
        studs(0, 230, 40, 220, 18) + `<polygon points="230,40 384,70 384,230 230,220" fill="#e8d2a4"/>` +
        studs(240, 384, 75, 225, 22, "#cfa970") + `<rect x="0" y="225" width="384" height="31" fill="#a3a3a3"/>`;
      break;
    case "framing_wall":
      body = sky("#5d9bd1", "#c3dbf0", 60) + ground(60) +
        studs(10, 374, 30, 210, 24) + `<rect x="130" y="90" width="110" height="70" fill="#5d9bd1"/>` +
        `<rect x="126" y="84" width="118" height="8" fill="#b88f55"/><rect x="0" y="215" width="384" height="41" fill="#a3a3a3"/>`;
      break;
    case "oak_framing": // another project's two-storey frame, overcast
      body = sky("#9aa5ad", "#d6dadd", 140) + ground(140, "#6a6157") + speckle(r, 200, 150, H, ["#57504a", "#7b7268"]) +
        studs(40, 250, 40, 110, 12, "#cfae78") + studs(40, 250, 115, 200, 12, "#cfae78") + trusses(40, 250, 36, 26, 3, "#b99a66") +
        `<rect x="280" y="150" width="70" height="40" fill="#c0392b"/>`;
      break;
  }
  // Off-centre light falloff (sun + lens vignette). Real photos have this; without it, flat synthetic
  // regions make dHash bits unstable under recompression.
  const cx = (0.2 + r() * 0.6).toFixed(2);
  const vignette =
    `<defs><radialGradient id="v" cx="${cx}" cy="0.3" r="0.9"><stop offset="0" stop-color="#fff" stop-opacity="0.12"/>` +
    `<stop offset="0.55" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.22"/></radialGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="url(#v)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${body}${vignette}</svg>`;
}

async function render(key: SceneKey, seed: number): Promise<Buffer> {
  return sharp(Buffer.from(scene(key, seed))).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
}

/** The "fraud": someone else's photo re-sent through a messaging app — downscaled, brightened, recompressed, EXIF GPS lost. */
async function launder(jpeg: Buffer): Promise<Buffer> {
  return sharp(jpeg)
    .resize(Math.round(W * 0.85), Math.round(H * 0.85))
    .modulate({ brightness: 1.07 })
    .jpeg({ quality: 60 })
    .toBuffer();
}

// ---------------------------------------------------------------------------- main
async function main() {
  await mkdir(join(OUT, "photos"), { recursive: true });
  await mkdir(join(OUT, "docs"), { recursive: true });
  const site = GEO.mapleSite;
  const T = FIX.times;
  const write = async (rel: string, buf: Buffer | string) => {
    await writeFile(join(OUT, rel), buf);
    console.log(`  ${rel.padEnd(40)} ${(Buffer.byteLength(buf) / 1024).toFixed(1)} KB`);
  };

  // Maple St, milestone 1 (Foundation) — legit, on site, after escrow
  const fWide = await render("foundation_wide", 11);
  const fBolts = await render("foundation_bolts", 12);
  const fClose = await render("foundation_closeup", 13);
  await write("photos/foundation-01-wide.jpg", stampExif(fWide, { takenAt: T.m1Photos[0], gps: offsetM(site, 22, -15) }));
  await write("photos/foundation-02-bolts.jpg", stampExif(fBolts, { takenAt: T.m1Photos[1], gps: offsetM(site, -18, 30) }));
  await write("photos/foundation-03-closeup.jpg", stampExif(fClose, { takenAt: T.m1Photos[2], gps: offsetM(site, 5, 8) }));
  // Scenario C: same close-up but geotagged ~2.4 km away
  await write("photos/foundation-03-offsite.jpg", stampExif(fClose, { takenAt: T.m1Photos[2], gps: GEO.offsite }));

  // Oak Ave (another project, last year) — this is the photo that gets reused
  const oak = await render("oak_framing", 21);
  await write("photos/oak-ave-framing.jpg", stampExif(oak, { takenAt: T.oakPhoto, gps: GEO.oakSite }));

  // Maple St, milestone 2 (Framing): 3 legit + 1 laundered copy of the Oak Ave photo (old date, GPS stripped)
  await write("photos/framing-01-wide.jpg", stampExif(await render("framing_wide", 31), { takenAt: T.m2Photos[0], gps: offsetM(site, 12, -20) }));
  await write("photos/framing-02-corner.jpg", stampExif(await render("framing_corner", 32), { takenAt: T.m2Photos[1], gps: offsetM(site, -25, 10) }));
  await write("photos/framing-03-wall.jpg", stampExif(await render("framing_wall", 33), { takenAt: T.m2Photos[2], gps: offsetM(site, 3, 26) }));
  await write("photos/framing-04-reused.jpg", stampExif(await launder(oak), { takenAt: T.oakPhoto }));

  for (const [rel, text] of Object.entries(FIX.docs)) await write(`docs/${rel}`, text);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
