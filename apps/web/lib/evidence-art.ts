// Offline SVG "site photos" for mock evidence, served by app/evidence/[file]/route.ts.
// Real evidence (core / uploads) uses real image URIs; this only exists so the demo has no network deps.

type Scene = (v: number) => string;

const W = 640;
const H = 480;

function sky(v: number) {
  const tops = ["#9cc3e6", "#a9cbe8", "#b7d3ea", "#94bde3", "#bcd5e9"];
  return `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tops[v % tops.length]}"/><stop offset="1" stop-color="#eef3f7"/></linearGradient>
  <linearGradient id="ground" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a08a6c"/><stop offset="1" stop-color="#7d6a52"/></linearGradient>
  <linearGradient id="concrete" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c9c7c2"/><stop offset="1" stop-color="#a9a7a1"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <g fill="#4b6447" opacity=".85">${Array.from({ length: 14 }, (_, i) => `<ellipse cx="${i * 52 - 10 + (v * 13) % 40}" cy="${232 + ((i * 7 + v) % 5) * 3}" rx="${38 + ((i + v) % 3) * 8}" ry="${34 + ((i * 3) % 4) * 6}"/>`).join("")}</g>
  <rect y="250" width="${W}" height="${H - 250}" fill="url(#ground)"/>`;
}

function frame(v: number, body: string) {
  const s = 1 + (v % 3) * 0.06;
  const tx = -((v % 4) * 18);
  const ty = -((v % 2) * 10);
  return `<g transform="translate(${tx} ${ty}) scale(${s})">${body}</g>`;
}

const slab = `<polygon points="90,330 560,330 610,410 40,410" fill="url(#concrete)"/><polygon points="40,410 610,410 610,428 40,428" fill="#8d8b86"/>`;

const scenes: Record<string, Scene> = {
  foundation: (v) =>
    sky(v) +
    frame(
      v,
      `${slab}${Array.from({ length: 12 }, (_, i) => `<rect x="${110 + i * 38}" y="${322}" width="4" height="12" fill="#5d5a55"/>`).join("")}
      <rect x="40" y="404" width="570" height="6" fill="#6f6a60" opacity=".5"/>
      ${Array.from({ length: 6 }, (_, i) => `<rect x="${30 + i * 110}" y="440" width="90" height="10" rx="2" fill="#c8a675"/>`).join("")}`,
    ),
  framing: (v) =>
    sky(v) +
    frame(
      v,
      `${slab}<g fill="#e3c28f" stroke="#b8925a" stroke-width="1">${Array.from({ length: 22 }, (_, i) => `<rect x="${100 + i * 21}" y="190" width="6" height="140"/>`).join("")}
      <rect x="96" y="184" width="460" height="8"/><rect x="96" y="326" width="460" height="6"/></g>
      <g fill="none" stroke="#c9a46d" stroke-width="6">${Array.from({ length: 7 }, (_, i) => `<polyline points="${100 + i * 76},184 ${138 + i * 76},120 ${176 + i * 76},184"/>`).join("")}</g>
      <rect x="100" y="200" width="150" height="128" fill="#d9c8a6" opacity=".55"/>`,
    ),
  dry_in: (v) =>
    sky(v) +
    frame(
      v,
      `${slab}<rect x="100" y="190" width="450" height="140" fill="#e9ecef"/>
      ${Array.from({ length: 6 }, (_, i) => `<line x1="100" y1="${205 + i * 22}" x2="550" y2="${205 + i * 22}" stroke="#c7d0d9" stroke-width="2"/>`).join("")}
      <polygon points="80,192 325,96 570,192" fill="#3d434b"/><polygon points="80,192 570,192 560,200 90,200" fill="#2b3036"/>
      ${[140, 230, 400, 480].map((x) => `<rect x="${x}" y="225" width="46" height="58" fill="#2f4a66" stroke="#f4f4f4" stroke-width="4"/>`).join("")}
      <rect x="300" y="240" width="50" height="90" fill="#6b4f3a" stroke="#f4f4f4" stroke-width="4"/>`,
    ),
  finish: (v) =>
    `<rect width="${W}" height="${H}" fill="#f1ede6"/>` +
    frame(
      v,
      `<rect y="330" width="${W}" height="150" fill="#b98d5e"/>${Array.from({ length: 9 }, (_, i) => `<line x1="${i * 80}" y1="330" x2="${i * 80 - 60}" y2="480" stroke="#a37a4f" stroke-width="2"/>`).join("")}
      <rect x="380" y="90" width="170" height="190" fill="#cfe2f1" stroke="#ffffff" stroke-width="10"/><line x1="465" y1="90" x2="465" y2="280" stroke="#fff" stroke-width="6"/>
      <rect x="60" y="250" width="260" height="80" fill="#e7e2da"/><rect x="50" y="240" width="280" height="14" fill="#5d6670"/>
      <line x1="190" y1="0" x2="190" y2="120" stroke="#333" stroke-width="2"/><ellipse cx="190" cy="128" rx="26" ry="14" fill="#2e3338"/>
      <rect x="600" y="0" width="40" height="330" fill="#e6e0d6"/>`,
    ),
  demo_rough: (v) =>
    `<rect width="${W}" height="${H}" fill="#d8cbb6"/>` +
    frame(
      v,
      `<rect y="360" width="${W}" height="120" fill="#8f8577"/><g fill="#d9b680" stroke="#ad8853">${Array.from({ length: 16 }, (_, i) => `<rect x="${i * 42}" y="40" width="10" height="320"/>`).join("")}</g>
      <polyline points="0,150 180,150 180,260 420,260 420,120 640,120" fill="none" stroke="#e8902b" stroke-width="5"/>
      <polyline points="0,300 300,300 300,200 640,200" fill="none" stroke="#c7d6e0" stroke-width="9"/>
      ${[120, 330, 540].map((x) => `<rect x="${x}" y="230" width="18" height="28" fill="#2f6fb1"/>`).join("")}`,
    ),
  site_foundation: (v) =>
    sky(v) +
    frame(
      v,
      `<polygon points="60,320 600,320 640,430 20,430" fill="#8b7559"/>${slab}
      <g stroke="#6b4b2c" stroke-width="2">${Array.from({ length: 14 }, (_, i) => `<line x1="${100 + i * 34}" y1="334" x2="${70 + i * 40}" y2="408"/>`).join("")}${Array.from({ length: 4 }, (_, i) => `<line x1="${80 - i * 10}" y1="${345 + i * 18}" x2="${570 + i * 10}" y2="${345 + i * 18}"/>`).join("")}</g>`,
    ),
  structure: (v) =>
    sky(v) +
    frame(
      v,
      `${slab}<g fill="#4a5361">${Array.from({ length: 7 }, (_, i) => `<rect x="${110 + i * 70}" y="80" width="10" height="250"/>`).join("")}${[80, 160, 240].map((y) => `<rect x="105" y="${y}" width="440" height="9"/>`).join("")}</g>
      <rect x="110" y="250" width="280" height="80" fill="#8fa9bf" opacity=".7"/>`,
    ),
  fitout: (v) =>
    `<rect width="${W}" height="${H}" fill="#eceef0"/>` +
    frame(
      v,
      `<rect y="340" width="${W}" height="140" fill="#cfd3d6"/><rect x="40" y="70" width="560" height="270" fill="#bcd7ea" stroke="#59636d" stroke-width="8"/>
      ${[180, 320, 460].map((x) => `<line x1="${x}" y1="70" x2="${x}" y2="340" stroke="#59636d" stroke-width="6"/>`).join("")}
      ${Array.from({ length: 6 }, (_, i) => `<rect x="${60 + i * 95}" y="20" width="60" height="8" rx="3" fill="#fbfbf5"/>`).join("")}`,
    ),
  invoice: () =>
    `<rect width="${W}" height="${H}" fill="#e5e7eb"/><rect x="150" y="24" width="340" height="440" fill="#fff" stroke="#d1d5db"/>
    <rect x="150" y="24" width="340" height="52" fill="#1f2a37"/><text x="170" y="58" font-family="Helvetica,Arial" font-size="20" font-weight="700" fill="#fff">INVOICE</text>
    ${Array.from({ length: 9 }, (_, i) => `<rect x="170" y="${110 + i * 30}" width="${180 - (i % 3) * 30}" height="9" fill="#cbd5e1"/><rect x="${410}" y="${110 + i * 30}" width="60" height="9" fill="#cbd5e1"/>`).join("")}
    <line x1="170" y1="392" x2="470" y2="392" stroke="#94a3b8"/><rect x="170" y="408" width="90" height="12" fill="#334155"/><rect x="390" y="404" width="80" height="18" fill="#0f766e"/>`,
  document: () =>
    `<rect width="${W}" height="${H}" fill="#e5e7eb"/><rect x="150" y="24" width="340" height="440" fill="#fffdf7" stroke="#d6d3c4"/>
    <text x="320" y="78" text-anchor="middle" font-family="Georgia,serif" font-size="18" fill="#3f3f46">INSPECTION REPORT</text>
    ${Array.from({ length: 8 }, (_, i) => `<rect x="180" y="${110 + i * 28}" width="${280 - (i % 4) * 40}" height="8" fill="#d6d3d1"/>`).join("")}
    <circle cx="410" cy="400" r="34" fill="none" stroke="#b91c1c" stroke-width="4"/><circle cx="410" cy="400" r="24" fill="none" stroke="#b91c1c" stroke-width="2"/>
    <path d="M180 410 q20 -24 40 0 t40 0 t40 -6" fill="none" stroke="#1e3a8a" stroke-width="3"/>`,
};

/** Parse "framing-3.svg" → SVG markup, or null if unknown. */
export function renderEvidenceSvg(file: string): string | null {
  const m = /^([a-z_]+)-(\d+)\.svg$/.exec(file);
  if (!m) return null;
  const scene = scenes[m[1]!];
  if (!scene) return null;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">${scene(Number(m[2]))}</svg>`;
}

export const evidenceArtUri = (scene: string, variant: number) => `/evidence/${scene}-${variant}.svg`;
