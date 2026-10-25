// Offline SVG stand-ins for site photos and PDFs in mock mode (data: URLs, so no file route is needed).
// In http mode evidence is served by core at /api/files/:fileId.

export type Scene = "excavation" | "foundation" | "framing" | "dry_in" | "rough_in" | "site" | "document";

const W = 640;
const H = 480;

const subject: Record<Exclude<Scene, "document">, string> = {
  site: `<rect x="60" y="300" width="520" height="40" fill="#8a7a5c"/>`,
  excavation: `<polygon points="120,300 520,300 480,380 160,380" fill="#5f513c"/>`,
  foundation: `<polygon points="100,320 540,320 580,390 60,390" fill="#bdbab4"/>${bolts()}`,
  framing: `<polygon points="100,320 540,320 580,390 60,390" fill="#bdbab4"/>${studs()}<polygon points="110,170 320,90 530,170" fill="none" stroke="#c49a5a" stroke-width="6"/>`,
  dry_in: `<rect x="110" y="170" width="420" height="150" fill="#d9d4c8"/><polygon points="90,175 320,80 550,175" fill="#4a4f57"/><rect x="170" y="210" width="60" height="50" fill="#9cc3e6"/><rect x="410" y="210" width="60" height="50" fill="#9cc3e6"/><rect x="295" y="240" width="50" height="80" fill="#6b4f35"/>`,
  rough_in: `<rect x="60" y="120" width="520" height="260" fill="#e8e1d3"/>${studs()}<path d="M120 200 C 220 160, 320 240, 520 190" stroke="#d1462f" stroke-width="5" fill="none"/><path d="M120 260 L 520 260" stroke="#3a7bd5" stroke-width="7"/>`,
};

function studs() {
  return Array.from({ length: 12 }, (_, i) => `<rect x="${120 + i * 36}" y="170" width="8" height="150" fill="#c49a5a"/>`).join("");
}

function bolts() {
  return Array.from({ length: 10 }, (_, i) => `<rect x="${130 + i * 42}" y="312" width="4" height="12" fill="#55524d"/>`).join("");
}

const svgUri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** A labelled fake site photo. `variant` shifts the sky so a gallery isn't identical tiles. */
export function photoArt(scene: Exclude<Scene, "document">, caption: string, variant = 0): string {
  const sky = ["#9cc3e6", "#a9cbe8", "#b7d3ea", "#94bde3"][variant % 4];
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="${sky}"/>` +
      `<rect y="300" width="${W}" height="${H - 300}" fill="#8f7b5f"/>${subject[scene]}` +
      `<rect y="${H - 34}" width="${W}" height="34" fill="rgba(0,0,0,.55)"/>` +
      `<text x="14" y="${H - 12}" font-family="monospace" font-size="15" fill="#fff">${caption} · MOCK</text></svg>`,
  );
}

/** A fake one-page PDF (invoice, sign-off, permit). */
export function documentArt(title: string, lines: string[]): string {
  const body = lines.map((l, i) => `<text x="70" y="${170 + i * 30}" font-family="sans-serif" font-size="17" fill="#344054">${l}</text>`);
  return svgUri(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#eef1f5"/>` +
      `<rect x="40" y="30" width="${W - 80}" height="${H - 60}" fill="#fff" stroke="#d0d5dd"/>` +
      `<text x="70" y="110" font-family="sans-serif" font-size="24" font-weight="600" fill="#0c111d">${title}</text>${body.join("")}` +
      `<text x="70" y="${H - 60}" font-family="monospace" font-size="13" fill="#98a2b3">MOCK DOCUMENT</text></svg>`,
  );
}
