// The builder's evidence for this milestone, as the suite will see it: photos with EXIF time + distance from site,
// invoices with the extracted total, documents. Files load from core's /api/files/:id (data: URLs in mock mode).
import { Camera, FileText, MapPinOff, Receipt } from "lucide-react";
import { formatDistance } from "@/components/audit/site-map";
import { Badge } from "@/components/ui/badge";
import { geoVerdict } from "@/lib/audit";
import { api } from "@/lib/api";
import type { Evidence, SiteGeo } from "@/lib/types";
import { formatDateTime, formatRlusd } from "@/lib/utils";

export function EvidenceGallery({ evidence, site, browserExif }: { evidence: Evidence[]; site: SiteGeo; browserExif?: ReadonlySet<string> }) {
  const photos = evidence.filter((e) => e.kind === "photo");
  const files = evidence.filter((e) => e.kind !== "photo");
  if (!evidence.length) return <p className="text-sm text-muted">The builder has not uploaded evidence for this milestone.</p>;

  return (
    <div className="space-y-4">
      {photos.length > 0 && (
        <ul className="grid grid-cols-2 gap-3">
          {photos.map((p) => (
            <li key={p.id} className="overflow-hidden rounded-lg border border-line bg-surface">
              <a href={api.fileUrl(p)} target="_blank" rel="noreferrer" className="block aspect-[4/3] bg-subtle">
                <img src={api.fileUrl(p)} alt={p.filename} className="size-full object-cover" loading="lazy" />
              </a>
              <PhotoCaption evidence={p} site={site} browserRead={browserExif?.has(p.id)} />
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {files.map((f) => {
            const Icon = f.kind === "invoice" ? Receipt : FileText;
            return (
              <li key={f.id}>
                <a href={api.fileUrl(f)} target="_blank" rel="noreferrer" className="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-subtle">
                  <Icon className="size-4 shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate">{f.filename}</span>
                  {f.meta.invoiceTotal && <span className="tabular text-xs text-ink-2">{formatRlusd(f.meta.invoiceTotal)}</span>}
                  <Badge>{f.kind}</Badge>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** EXIF taken-at + GPS verdict under a photo. Shared by the builder gallery and the inspector's own photos. */
export function PhotoCaption({ evidence, site, browserRead }: { evidence: Evidence; site: SiteGeo; browserRead?: boolean }) {
  const geo = geoVerdict(site, evidence.meta.gps);
  return (
    <div className="space-y-1 px-2.5 py-2 text-[11px] leading-tight">
      <p className="truncate font-medium text-ink-2" title={evidence.filename}>
        <Camera className="mr-1 inline size-3 text-faint" />
        {evidence.filename}
      </p>
      <p className="text-muted">{evidence.meta.takenAt ? `Taken ${formatDateTime(evidence.meta.takenAt)}` : "No EXIF time"}</p>
      {geo.state === "no_gps" ? (
        <p className="flex items-center gap-1 text-warn">
          <MapPinOff className="size-3" /> No GPS in EXIF
        </p>
      ) : (
        <p className={geo.state === "inside" ? "text-ok" : "font-semibold text-bad"}>
          {formatDistance(geo.distanceM!)} from site {geo.state === "inside" ? "· on site" : "· OUTSIDE geofence"}
        </p>
      )}
      {browserRead && <p className="text-faint" title="Core's record of this file has no EXIF; read from the file in your browser with the verifier's parser.">EXIF read in your browser</p>}
    </div>
  );
}
