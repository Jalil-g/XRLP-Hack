// The builder's evidence for this milestone, as the suite will see it: photos with EXIF time + distance from site,
// invoices with the extracted total, documents. Files load from core's /api/files/:id (data: URLs in mock mode).
import { FileText, MapPinOff, Receipt } from "lucide-react";
import { formatDistance } from "@/components/audit/site-map";
import { geoVerdict } from "@/lib/audit";
import { api, API_MODE } from "@/lib/api";
import type { Evidence, SiteGeo } from "@/lib/types";
import { formatDateTime, formatRlusd } from "@/lib/utils";

const KIND_LABEL: Record<string, string> = { invoice: "Invoice", document: "Document", photo: "Photo" };

export function EvidenceGallery({ evidence, site, browserExif }: { evidence: Evidence[]; site: SiteGeo; browserExif?: ReadonlySet<string> }) {
  const photos = evidence.filter((e) => e.kind === "photo");
  const files = evidence.filter((e) => e.kind !== "photo");
  if (!evidence.length) return <p className="text-small text-ink-2">No evidence uploaded</p>;

  return (
    <div className="space-y-6">
      {photos.length > 0 && (
        <ul className="grid min-w-0 grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
          {photos.map((p) => (
            <li key={p.id} className="min-w-0">
              <a href={api.fileUrl(p)} target="_blank" rel="noreferrer" className="relative block aspect-[4/3] overflow-hidden rounded-control bg-band">
                {/* eslint-disable-next-line @next/next/no-img-element -- evidence is served by core or fixture art */}
                <img src={api.fileUrl(p)} alt={p.filename} className="size-full object-contain" loading="lazy" />
                <SampleMark evidence={p} />
              </a>
              <PhotoCaption evidence={p} site={site} browserRead={browserExif?.has(p.id)} />
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul className="divide-y divide-line border-y border-line">
          {files.map((f) => {
            const Icon = f.kind === "invoice" ? Receipt : FileText;
            return (
              <li key={f.id}>
                <a href={api.fileUrl(f)} target="_blank" rel="noreferrer" className="flex min-h-12 items-center gap-3 py-2 text-small hover:bg-band/60">
                  <Icon className="size-4 shrink-0 text-ink-3" aria-hidden />
                  <span className="min-w-0 flex-1 font-medium break-words [overflow-wrap:anywhere]">{f.filename}</span>
                  {f.meta.invoiceTotal && <span className="tabular text-ink">{formatRlusd(f.meta.invoiceTotal)}</span>}
                  <span className="w-[68px] shrink-0 text-right text-caption text-ink-3">{KIND_LABEL[f.kind] ?? f.kind}</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Mock honesty: fixture art and sample photos are marked on the image, not in a sentence. */
export function SampleMark({ evidence }: { evidence: Evidence }) {
  if (API_MODE !== "mock") return null;
  const art = evidence.uri?.startsWith("data:image/svg+xml");
  const sample = evidence.uri?.startsWith("/fixture-files/");
  if (!art && !sample) return null;
  return (
    <span className="absolute top-2 left-2 rounded-tag bg-surface/90 px-1.5 text-[11px] leading-5 font-medium text-ink-2" title={art ? "Mock evidence illustration" : "Sample fixture photo"}>
      Sample
    </span>
  );
}

/** EXIF taken-at + GPS verdict under a photo. Shared by the builder gallery and the inspector's own photos. */
export function PhotoCaption({ evidence, site, browserRead }: { evidence: Evidence; site: SiteGeo; browserRead?: boolean }) {
  const geo = geoVerdict(site, evidence.meta.gps);
  return (
    <div className="mt-2 min-w-0 text-caption">
      <p className="truncate text-small font-medium text-ink" title={evidence.filename}>{evidence.filename}</p>
      <p className="mt-0.5 flex flex-wrap gap-x-3 text-ink-2">
        <span className="tabular" title={browserRead ? "Core's record of this file has no EXIF; read from the file in your browser with the verifier's parser." : undefined}>
          {evidence.meta.takenAt ? formatDateTime(evidence.meta.takenAt) : "No EXIF time"}
          {browserRead && <span className="ml-1 text-ink-3">(read here)</span>}
        </span>
        {geo.state === "no_gps" ? (
          <span className="flex items-center gap-1 font-medium text-review">
            <MapPinOff className="size-3" aria-hidden /> No GPS
          </span>
        ) : geo.state === "inside" ? (
          <span className="tabular text-pass">{formatDistance(geo.distanceM!)} from site</span>
        ) : (
          <span className="tabular font-semibold text-fail">{formatDistance(geo.distanceM!)} away, off site</span>
        )}
      </p>
    </div>
  );
}
