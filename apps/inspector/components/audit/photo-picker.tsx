"use client";
// The inspector's own site photos. Each is hashed + EXIF-read in the browser on pick, so the inspector sees what the
// suite will see (time, distance from site) before signing. Picking the same file twice is a no-op (same sha256).
import { useEffect, useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { PhotoCaption } from "@/components/audit/evidence-gallery";
import { Button } from "@/components/ui/button";
import { photoEvidence, type DraftPhoto } from "@/lib/audit";
import type { SiteGeo } from "@/lib/types";

export function PhotoPicker({ photos, onChange, site }: { photos: DraftPhoto[]; onChange(next: DraftPhoto[]): void; site: SiteGeo }) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const previews = usePreviews(photos);

  async function add(files: FileList | null) {
    if (!files?.length) return;
    setReading(true);
    try {
      const now = new Date().toISOString();
      const picked = await Promise.all([...files].map(async (file) => ({ file, evidence: await photoEvidence(file, now) })));
      const seen = new Set(photos.map((p) => p.evidence.sha256));
      onChange([...photos, ...picked.filter((p) => !seen.has(p.evidence.sha256) && seen.add(p.evidence.sha256))]);
    } finally {
      setReading(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="space-y-3">
      {photos.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p) => (
            <li key={p.evidence.sha256} className="group relative overflow-hidden rounded-lg border border-line bg-surface">
              <div className="aspect-[4/3] bg-subtle">
                {previews.get(p.file) && <img src={previews.get(p.file)} alt={p.evidence.filename} className="size-full object-cover" />}
              </div>
              <PhotoCaption evidence={p.evidence} site={site} />
              <button
                type="button"
                onClick={() => onChange(photos.filter((x) => x !== p))}
                className="absolute top-1.5 right-1.5 rounded-md bg-surface/90 p-1 text-muted shadow-card hover:text-bad"
                aria-label={`Remove ${p.evidence.filename}`}
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => void add(e.target.files)} />
      <Button type="button" variant="secondary" onClick={() => input.current?.click()} disabled={reading}>
        <ImagePlus /> {reading ? "Reading EXIF…" : photos.length ? "Add more photos" : "Add site photos"}
      </Button>
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
