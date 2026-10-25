"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CheckCircle2, Loader2, Lock, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { StatusIcon } from "@/components/checks/status-icon";
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
  projectName,
  builderName,
  requirements,
  submitLabel = "Upload",
  fixture,
}: {
  projectId: string;
  milestoneId: string;
  milestoneTitle: string;
  projectName: string;
  builderName: string;
  requirements: EvidenceRequirement[];
  /** Verb on the submit button, e.g. "Resubmit". */
  submitLabel?: string;
  /** Demo shortcut: stage the verifier's fixture files for this milestone. */
  fixture?: { label: string; title?: string; files: { path: string; kind: EvidenceKind }[] };
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Staged[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string>();
  const [receipt, setReceipt] = useState<string>();
  const submitting = useRef(false);

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
    if (submitting.current || !reviewing || !files.length) return;
    submitting.current = true;
    setError(undefined);
    setBusy(true);
    try {
      const r = await api.submitEvidence(projectId, milestoneId, files.map((f) => ({ file: f.file, filename: f.file.name, kind: f.kind })));
      const n = `${r.evidence.length} file${r.evidence.length === 1 ? "" : "s"}`;
      toast.success(`${n} added to ${milestoneTitle}`);
      setReceipt(`${n} uploaded to ${milestoneTitle}`);
      setReviewing(false);
      setFiles([]);
      router.refresh();
    } catch (err) {
      const feedback = errorFeedback(err);
      setError(`${feedback.title}. ${errorDescription(feedback)}`);
      toast.error(feedback.title, { description: errorDescription(feedback), duration: 10_000 });
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  return (
    <div className="grid gap-x-10 gap-y-8 md:grid-cols-[minmax(0,1fr)_260px]">
      <div className="min-w-0 space-y-4">
        {receipt && (
          <p role="status" className="flex items-center gap-2 text-small font-medium text-pass">
            <CheckCircle2 className="size-4" aria-hidden />
            {receipt}
          </p>
        )}
        {error && <p role="alert" className="rounded-control bg-fail-bg px-3 py-2.5 text-small text-fail">{error}</p>}
        {reviewing ? (
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <h3 className="text-[17px] leading-6 font-semibold tracking-[-0.01em]">Review {plural(files.length, "file")}</h3>
            <p className="text-small text-ink-2">
              {milestoneTitle}, {projectName}
              <span className="sr-only">. Submitting as {builderName}.</span>
            </p>
          </div>
        ) : (
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
              "flex w-full flex-col items-center justify-center gap-2 rounded-panel border border-dashed text-center transition-colors duration-150",
              files.length ? "min-h-24 px-6 py-5" : "min-h-44 px-6 py-10",
              dragging ? "border-ink bg-band" : "border-line-2 hover:border-ink hover:bg-band/60",
            )}
          >
            <Upload className="size-5 text-ink-2" aria-hidden />
            <span className="text-body font-medium text-ink">{files.length ? "Add more files" : "Drop files here"}</span>
            <span className="text-small text-ink-2">or choose files</span>
          </button>
        )}
        <input ref={input} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files && add(e.target.files)} />

        {files.length > 0 && (
          <ul className="divide-y divide-line border-y border-line">
            {files.map((f) => (
              <li key={f.key} className="flex items-center gap-3 py-2.5">
                <span className="size-10 shrink-0 overflow-hidden rounded-control bg-band">
                  {f.preview && (
                    // eslint-disable-next-line @next/next/no-img-element -- local object URL preview
                    <img src={f.preview} alt="" className="size-full object-cover" />
                  )}
                </span>
                <span title={f.file.name} className="min-w-0 flex-1 truncate text-small">{f.file.name}</span>
                <select
                  disabled={reviewing || busy}
                  value={f.kind}
                  onChange={(e) => setFiles((prev) => prev.map((p) => (p.key === f.key ? { ...p, kind: e.target.value as EvidenceKind } : p)))}
                  className="h-11 w-[104px] shrink-0 rounded-control border border-line-2 bg-page px-2 text-caption capitalize disabled:border-transparent disabled:bg-transparent disabled:text-ink-2"
                  aria-label={`Type of ${f.file.name}`}
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                {!reviewing && (
                  <button disabled={busy} onClick={() => setFiles((prev) => prev.filter((p) => p.key !== f.key))} className="flex size-11 items-center justify-center rounded-control text-ink-2 disabled:opacity-40 hover:bg-band hover:text-ink" aria-label={`Remove ${f.file.name}`}>
                    <X className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {reviewing && <Button variant="secondary" size="lg" disabled={busy} onClick={() => setReviewing(false)}>Back to files</Button>}
          <Button size="lg" disabled={!files.length || busy || loading} title={files.length ? undefined : "Add files first"} onClick={() => reviewing ? void upload() : setReviewing(true)}>
            {busy && <Loader2 className="animate-spin" aria-hidden />}
            {busy ? "Uploading…" : reviewing ? `${submitLabel} ${plural(files.length, "file")}` : "Review evidence"}
          </Button>
          {fixture && !reviewing && (
            <Button variant="quiet" size="sm" className="text-ink-2" title={fixture.title} disabled={loading || busy} onClick={loadFixture}>
              {loading && <Loader2 className="animate-spin" aria-hidden />}
              {fixture.label}
            </Button>
          )}
        </div>
      </div>

      <aside aria-label={`Required for ${milestoneTitle}`} className="min-w-0">
        <h3 className="flex items-center gap-1.5 text-small font-semibold">
          Required
          <span title="Set by the locked schedule" aria-label="Set by the locked schedule" role="img" className="text-ink-3">
            <Lock className="size-3.5" aria-hidden />
          </span>
        </h3>
        {requirements.length ? (
          <ul className="mt-2 divide-y divide-line border-y border-line">
            {requirements.map((r) => {
              const have = Math.min(count(r.kind), r.minCount);
              return (
                <li key={`${r.kind}-${r.description}`} className="flex items-start gap-2.5 py-2.5 text-small">
                  <StatusIcon state={have >= r.minCount ? "pass" : "queued"} className="mt-px size-[18px]" />
                  <span className="min-w-0 flex-1 text-ink">{r.description}</span>
                  <span className="shrink-0 tabular-nums text-ink-2">
                    {have}/{r.minCount} <span className="sr-only">{r.kind}s staged</span>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-small text-ink-2">None listed</p>
        )}
      </aside>
    </div>
  );
}
