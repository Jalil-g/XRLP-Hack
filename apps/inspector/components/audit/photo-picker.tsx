"use client";
// The inspector's own site photos. Each is hashed + EXIF-read in the browser on pick, so the inspector sees what the
// suite will see (time, distance from site) before signing. Picking the same file twice is a no-op (same sha256).
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { PhotoCaption } from "@/components/audit/evidence-gallery";
import { Button } from "@/components/ui/button";
import { photoEvidence, type DraftPhoto } from "@/lib/audit";
import type { SiteGeo } from "@/lib/types";
import { cn } from "@/lib/utils";

export function PhotoPicker({ photos, onChange, site, invalid }: { photos: DraftPhoto[]; onChange(next: DraftPhoto[]): void; site: SiteGeo; invalid?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string>();
  const previews = usePreviews(photos);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setReading(true);
    setError(undefined);
    try {
      const now = new Date().toISOString();
      const picked = await Promise.all([...files].map(async (file) => ({ file, evidence: await photoEvidence(file, now) })));
      const seen = new Set(photos.map((p) => p.evidence.sha256));
      onChange([...photos, ...picked.filter((p) => !seen.has(p.evidence.sha256) && seen.add(p.evidence.sha256))]);
    } catch {
      setError("Could not read photos. Use JPEG or PNG.");
    } finally {
      setReading(false);
      if (input.current) input.current.value = "";
    }
  }

  const pick = () => input.current?.click();
  return (
    <div className="space-y-4">
      {photos.length > 0 ? (
        <ul className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2">
          {photos.map((p) => (
            <li key={p.evidence.sha256} className="relative min-w-0">
              <div className="aspect-[4/3] overflow-hidden rounded-control bg-band">
                {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
                {previews.get(p.file) && <img src={previews.get(p.file)} alt={p.evidence.filename} className="size-full object-contain" />}
              </div>
              <PhotoCaption evidence={p.evidence} site={site} />
              <button
                type="button"
                onClick={() => onChange(photos.filter((x) => x !== p))}
                className="absolute top-1.5 right-1.5 flex size-11 items-center justify-center rounded-full bg-surface/90 text-ink-2 hover:text-fail"
                aria-label={`Remove ${p.evidence.filename}`}
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <button type="button" onClick={pick} disabled={reading}
          className={cn("flex min-h-[88px] w-full items-center justify-center gap-2 rounded-control border border-dashed bg-band/40 text-small font-semibold text-ink transition-colors hover:bg-band disabled:opacity-60 [&_svg]:size-5", invalid ? "border-fail" : "border-line-2")}>
          <ImagePlus className="text-ink-2" aria-hidden /> {reading ? "Reading EXIF…" : "Add site photos"}
        </button>
      )}
      {error && <p role="alert" className="text-small text-fail">{error}</p>}
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => void add(e.target.files)} />
      {photos.length > 0 && (
        <Button type="button" variant="secondary" onClick={pick} disabled={reading}>
          <ImagePlus /> {reading ? "Reading EXIF…" : "Add more photos"}
        </Button>
      )}
    </div>
  );
}

/** Object URLs for thumbnails; each set is revoked when the photo list changes or the picker unmounts. */
function usePreviews(photos: DraftPhoto[]): Map<Blob, string> {
  const [urls, setUrls] = useState(() => new Map<Blob, string>());
  useEffect(() => {
    const next = new Map(photos.map((p) => [p.file, URL.createObjectURL(p.file)] as const));
    setUrls(next);
    return () => next.forEach((url) => URL.revokeObjectURL(url));
  }, [photos]);
  return urls;
}
