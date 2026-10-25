"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { errorDescription, errorFeedback } from "@/lib/error-feedback";
import type { EvidenceKind, EvidenceRequirement } from "@/lib/contract";
import { cn } from "@/lib/utils";

type Staged = { key: string; file: File; kind: EvidenceKind; preview?: string };
const KINDS: EvidenceKind[] = ["photo", "invoice", "document"];

const guessKind = (f: File): EvidenceKind => (f.type.startsWith("image/") ? "photo" : /invoice|receipt|bill/i.test(f.name) ? "invoice" : "document");

/** Route 9: the builder's evidence for one milestone. What is required comes from the locked SoV and is read-only. */
export function EvidenceUploader({
  projectId,
  milestoneId,
  milestoneTitle,
  requirements,
  submitLabel = "Upload",
  fixture,
}: {
  projectId: string;
  milestoneId: string;
  milestoneTitle: string;
  requirements: EvidenceRequirement[];
  /** Verb on the submit button, e.g. "Resubmit". */
  submitLabel?: string;
  /** Demo shortcut: stage the verifier's fixture files for this milestone. */
  fixture?: { label: string; files: { path: string; kind: EvidenceKind }[] };
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Staged[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const add = (list: FileList | File[]) =>
    setFiles((prev) => [
      ...prev,
      ...[...list]
        .filter((f) => !prev.some((p) => p.key === `${f.name}-${f.size}`))
        .map((f) => ({ key: `${f.name}-${f.size}`, file: f, kind: guessKind(f), preview: f.type.startsWith("image/") ? URL.createObjectURL(f) : undefined })),
    ]);

  const count = (k: EvidenceKind) => files.filter((f) => f.kind === k).length;
  const [loading, setLoading] = useState(false);

  const loadFixture = async () => {
    if (!fixture) return;
    setLoading(true);
    try {
      const loaded = await Promise.all(
        fixture.files.map(async (f) => {
          const res = await fetch(`/fixture-files/${f.path}`);
          if (!res.ok) throw new Error(`Fixture file missing: ${f.path}`);
          const blob = await res.blob();
          return { file: new File([blob], f.path.split("/").pop()!, { type: blob.type }), kind: f.kind };
        }),
      );
      setFiles((prev) => [
        ...prev,
        ...loaded
          .filter(({ file }) => !prev.some((p) => p.key === `${file.name}-${file.size}`))
          .map(({ file, kind }) => ({ key: `${file.name}-${file.size}`, file, kind, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined })),
      ]);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not load the fixture");
    } finally {
      setLoading(false);
    }
  };

  const upload = async () => {
    setBusy(true);
    try {
      const r = await api.submitEvidence(projectId, milestoneId, files.map((f) => ({ file: f.file, filename: f.file.name, kind: f.kind })));
      toast.success(`${r.evidence.length} file${r.evidence.length === 1 ? "" : "s"} added to ${milestoneTitle}`, { description: "Next: the inspector audits the site, then run the checks." });
      setFiles([]);
      router.refresh();
    } catch (err) {
      const feedback = errorFeedback(err);
      toast.error(feedback.title, { description: errorDescription(feedback), duration: 10_000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            add(e.dataTransfer.files);
          }}
          className={cn(
            "flex w-full flex-col items-center justify-center rounded-panel border border-dashed px-6 py-10 text-center transition-colors duration-150",
            dragging ? "border-action bg-info-bg" : "border-line-2 hover:border-ink-3 hover:bg-band/60",
          )}
        >
          <span className="text-body font-medium text-ink">Drop photos, invoices and sign-offs</span>
          <span className="mt-1 text-small text-ink-2">or click to choose files</span>
        </button>
        <input ref={input} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files && add(e.target.files)} />

        {files.length > 0 && (
          <ul className="divide-y divide-line border-y border-line">
            {files.map((f) => (
              <li key={f.key} className="flex items-center gap-3 py-2">
                <span className="size-10 shrink-0 overflow-hidden rounded-control bg-band">
                  {f.preview && (
                    // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
                    <img src={f.preview} alt="" className="size-full object-cover" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-small">{f.file.name}</span>
                <select
                  value={f.kind}
                  onChange={(e) => setFiles((prev) => prev.map((p) => (p.key === f.key ? { ...p, kind: e.target.value as EvidenceKind } : p)))}
                  className="h-8 rounded-control border border-line-2 bg-page px-2 text-caption"
                  aria-label={`Type of ${f.file.name}`}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <button onClick={() => setFiles((prev) => prev.filter((p) => p.key !== f.key))} className="rounded-control p-1.5 text-ink-3 hover:bg-band hover:text-ink" aria-label={`Remove ${f.file.name}`}>
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!files.length || busy} onClick={upload}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            {submitLabel} {files.length ? `${files.length} file${files.length === 1 ? "" : "s"}` : "evidence"}
          </Button>
          {fixture && (
            <Button variant="quiet" disabled={loading || busy} onClick={loadFixture}>
              {loading && <Loader2 className="animate-spin" aria-hidden />}
              {fixture.label}
            </Button>
          )}
        </div>
      </div>

      <div>
        <h3 className="text-small font-semibold">Required for {milestoneTitle}</h3>
        <p className="mt-0.5 text-caption text-ink-2">Set by the locked Schedule of Values. Not editable.</p>
        <ul className="mt-3 space-y-2">
          {requirements.map((r) => (
            <li key={`${r.kind}-${r.description}`} className="text-small">
              <span className="text-ink">{r.description}</span>
              <span className="block text-caption text-ink-2">
                {Math.min(count(r.kind), r.minCount)} of {r.minCount} {r.kind}
                {r.minCount > 1 ? "s" : ""} staged
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
