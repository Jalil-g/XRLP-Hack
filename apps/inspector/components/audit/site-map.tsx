// Site geofence vs photo GPS pins, as a plain SVG (no map tiles: works offline and reads on a projector).
// Builder photos are grey, the inspector's are ink; pins beyond the frame are clamped to the edge with their distance.
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
  const off = placed.some((p) => p.clamped);
  const mine = placed.some((p) => p.who === "inspector");
  const theirs = placed.some((p) => p.who === "builder");

  return (
    <figure className="flex flex-wrap items-end gap-x-8 gap-y-3">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full max-w-[240px] rounded-control bg-band" role="img" aria-label="Site geofence with photo locations">
        <circle cx={c} cy={c} r={site.radiusM * scale} className="fill-surface stroke-line-2" strokeDasharray="4 3" />
        <line x1={c - 5} y1={c} x2={c + 5} y2={c} className="stroke-ink-3" />
        <line x1={c} y1={c - 5} x2={c} y2={c + 5} className="stroke-ink-3" />
        <text x={SIZE - 10} y={18} textAnchor="end" className="fill-ink-3 text-[10px] font-semibold">
          N
        </text>
        <line x1={10} y1={SIZE - 10} x2={10 + scaleBarM * scale} y2={SIZE - 10} className="stroke-ink-3" strokeWidth={2} />
        <text x={10} y={SIZE - 14} className="fill-ink-3 text-[9px]">
          {scaleBarM} m
        </text>
        {placed.map((p) => (
          <g key={p.id}>
            <title>{`${p.who === "inspector" ? "Your photo" : "Builder photo"} ${p.label}: ${Math.round(p.d)} m from site centre`}</title>
            <circle
              cx={p.px}
              cy={p.py}
              r={p.who === "inspector" ? 5 : 4}
              className={p.clamped ? "fill-fail stroke-surface" : p.who === "inspector" ? "fill-ink stroke-surface" : "fill-ink-3 stroke-surface"}
              strokeWidth={1.5}
            />
            {p.clamped && (
              <text x={p.px} y={p.py + (p.py > c ? -8 : 14)} textAnchor="middle" className="fill-fail text-[9px] font-semibold">
                {formatDistance(p.d)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <figcaption className="space-y-1.5 text-caption text-ink-2">
        <span className="flex items-center gap-2">
          <span className="size-2.5 rounded-full border border-dashed border-line-2 bg-surface" /> Site, {site.radiusM} m
        </span>
        {theirs && (
          <span className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-ink-3" /> Builder photos
          </span>
        )}
        {mine && (
          <span className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-ink" /> Your photos
          </span>
        )}
        {off && (
          <span className="flex items-center gap-2 text-fail">
            <span className="size-2.5 rounded-full bg-fail" /> Off the map
          </span>
        )}
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
