// Site geofence vs photo GPS pins, as a plain SVG (no map tiles: works offline and reads on a projector).
// Builder photos are grey, the inspector's are brand-coloured; pins beyond the frame are clamped to the edge with their distance.
import { offsetM } from "@/lib/audit";
import type { SiteGeo } from "@/lib/types";

export type MapPin = { id: string; label: string; gps: { lat: number; lng: number }; who: "builder" | "inspector" };

const SIZE = 240;
const PAD = 18;

export function SiteMap({ site, pins }: { site: SiteGeo; pins: MapPin[] }) {
  // Frame = 1.8× the geofence radius, so in-site pins spread out and anything outside is obviously outside.
  const halfM = site.radiusM * 1.8;
  const scale = (SIZE / 2 - PAD) / halfM;
  const c = SIZE / 2;
  const placed = pins.map((p) => {
    const { x, y } = offsetM(site, p.gps);
    const d = Math.hypot(x, y);
    const clamped = d > halfM;
    const k = clamped ? halfM / d : 1;
    return { ...p, d, clamped, px: c + x * k * scale, py: c - y * k * scale };
  });
  const scaleBarM = niceMeters(halfM / 2);

  return (
    <figure className="space-y-2">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full max-w-[280px] rounded-lg border border-line bg-subtle" role="img" aria-label="Site geofence with photo locations">
        <circle cx={c} cy={c} r={site.radiusM * scale} className="fill-brand-50 stroke-brand" strokeDasharray="4 3" />
        <line x1={c - 5} y1={c} x2={c + 5} y2={c} className="stroke-ink-2" />
        <line x1={c} y1={c - 5} x2={c} y2={c + 5} className="stroke-ink-2" />
        <text x={SIZE - 10} y={16} textAnchor="end" className="fill-faint text-[10px] font-semibold">
          N ↑
        </text>
        <line x1={10} y1={SIZE - 10} x2={10 + scaleBarM * scale} y2={SIZE - 10} className="stroke-muted" strokeWidth={2} />
        <text x={10} y={SIZE - 14} className="fill-muted text-[9px]">
          {scaleBarM} m
        </text>
        {placed.map((p) => (
          <g key={p.id}>
            <title>{`${p.who === "inspector" ? "Your photo" : "Builder photo"} ${p.label}: ${Math.round(p.d)} m from site centre`}</title>
            <circle
              cx={p.px}
              cy={p.py}
              r={p.who === "inspector" ? 5 : 4}
              className={p.clamped ? "fill-bad stroke-surface" : p.who === "inspector" ? "fill-brand stroke-surface" : "fill-muted stroke-surface"}
              strokeWidth={1.5}
            />
            {p.clamped && (
              <text x={p.px} y={p.py + (p.py > c ? -8 : 14)} textAnchor="middle" className="fill-bad text-[9px] font-semibold">
                {formatDistance(p.d)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <figcaption className="flex flex-wrap gap-3 text-caption text-muted">
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full border border-dashed border-brand bg-brand-50" /> Site ({site.radiusM} m)
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-muted" /> Builder photos
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-brand" /> Your photos
        </span>
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-full bg-bad" /> Off the map
        </span>
      </figcaption>
    </figure>
  );
}

export function formatDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function niceMeters(m: number) {
  const pow = 10 ** Math.floor(Math.log10(m));
  return [1, 2, 5, 10].map((s) => s * pow).filter((v) => v <= m).pop() ?? pow;
}
