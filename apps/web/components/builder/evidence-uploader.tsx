"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { CheckCircle2, Circle, FileText, Loader2, Sparkles, Trash2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import type { EvidenceKind, MilestoneTemplate, Verdict } from "@xrlp/shared";
import { Button } from "@/components/ui/button";
import { client } from "@/lib/client";
import type { EvidenceUpload } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Staged extends EvidenceUpload {
  key: string;
  sizeBytes: number;
}

const KINDS: EvidenceKind[] = ["photo", "invoice", "document"];

async function sha256Hex(buf: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Downscale an image to a small JPEG data URL so it can travel in JSON (mock mode). */
async function thumbnail(file: File, max = 480): Promise<string | undefined> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  } catch {
    return undefined;
  }
}

function guessKind(file: File): EvidenceKind {
  if (file.type.startsWith("image/")) return "photo";
  return /invoice|receipt|bill/i.test(file.name) ? "invoice" : "document";
}

type Phase = "idle" | "uploading" | "reviewing";

export function EvidenceUploader({
  projectId,
  milestoneId,
  milestoneTitle,
  template,
}: {
  projectId: string;
  milestoneId: string;
  milestoneTitle: string;
  template: MilestoneTemplate | null;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Staged[]>([]);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");

  const addFiles = useCallback(async (list: FileList | File[]) => {
    const staged = await Promise.all(
      [...list].map(async (f): Promise<Staged> => {
        const buf = await f.arrayBuffer();
        const kind = guessKind(f);
        return {
          key: `${f.name}-${f.size}-${f.lastModified}`,
          kind,
          filename: f.name,
          mimeType: f.type || "application/octet-stream",
          sha256: await sha256Hex(buf),
          uri: kind === "photo" ? await thumbnail(f) : undefined,
          sizeBytes: f.size,
          // TODO(verifier): EXIF (GPS, DateTimeOriginal) is extracted server-side by @xrlp/verifier preprocessing.
          meta: {},
        };
      }),
    );
    setFiles((prev) => [...prev, ...staged.filter((s) => !prev.some((p) => p.key === s.key))]);
  }, []);

  const counts = Object.fromEntries(KINDS.map((k) => [k, files.filter((f) => f.kind === k).length])) as Record<EvidenceKind, number>;

  const submit = async () => {
    try {
      setPhase("uploading");
      await client.submitEvidence({
        projectId,
        milestoneId,
        files: files.map(({ key: _k, sizeBytes: _s, ...f }) => f),
      });
      router.refresh();
      setPhase("reviewing");
      const [v] = await Promise.all([client.runAiReview({ projectId, milestoneId }), new Promise((r) => setTimeout(r, 1400))]);
      setFiles([]);
      setPhase("idle");
      router.refresh();
      const decision = (v as Verdict).decision;
      if (decision === "fail") toast.error(`${milestoneTitle}: AI rejected the evidence. Funds stay locked.`);
      else if (decision === "pass") toast.success(`${milestoneTitle}: AI verdict PASS — sent to the inspector.`);
      else toast.warning(`${milestoneTitle}: needs human review — sent to the inspector.`);
    } catch (err) {
      setPhase("idle");
      toast.error(err instanceof Error ? err.message : "Upload failed");
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
      <div className="space-y-3">
        <div
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void addFiles(e.dataTransfer.files);
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
            dragging ? "border-brand bg-brand-50" : "border-line-strong bg-subtle/40 hover:border-brand/50 hover:bg-brand-50/40",
          )}
        >
          <UploadCloud className={cn("size-8", dragging ? "text-brand" : "text-faint")} />
          <p className="mt-3 text-sm font-medium text-ink">Drop site photos, invoices and sign-offs</p>
          <p className="mt-1 text-[13px] text-muted">or click to browse · files are SHA-256 fingerprinted before upload</p>
          <input
            ref={input}
            type="file"
            multiple
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => e.target.files && void addFiles(e.target.files)}
          />
        </div>

        {files.length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {files.map((f) => (
              <li key={f.key} className="flex items-center gap-3 px-3 py-2">
                <div className="size-10 shrink-0 overflow-hidden rounded-md bg-subtle">
                  {f.uri ? (
                    // eslint-disable-next-line @next/next/no-img-element -- local data URL preview
                    <img src={f.uri} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <FileText className="m-2.5 size-5 text-faint" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink">{f.filename}</div>
                  <div className="truncate font-mono text-[11px] text-faint">sha256 {f.sha256.slice(0, 16)}…</div>
                </div>
                <select
                  value={f.kind}
                  onChange={(e) => setFiles((prev) => prev.map((p) => (p.key === f.key ? { ...p, kind: e.target.value as EvidenceKind } : p)))}
                  className="h-8 rounded-md border border-line bg-surface px-2 text-[13px] text-ink-2"
                  aria-label="Evidence type"
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setFiles((prev) => prev.filter((p) => p.key !== f.key))}
                  className="rounded-md p-1.5 text-faint hover:bg-subtle hover:text-bad"
                  aria-label={`Remove ${f.filename}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-4">
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="text-[13px] font-semibold text-ink">Required for {milestoneTitle}</div>
          <p className="mt-0.5 text-xs text-muted">Fixed by the locked template — not editable by the builder.</p>
          <ul className="mt-3 space-y-2.5">
            {template?.requiredEvidence.map((r) => {
              const ok = counts[r.kind] >= r.minCount;
              return (
                <li key={r.description} className="flex gap-2 text-[13px]">
                  {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" /> : <Circle className="mt-0.5 size-4 shrink-0 text-line-strong" />}
                  <span className="text-ink-2">
                    {r.description}
                    <span className="block text-xs text-faint">
                      {Math.min(counts[r.kind], r.minCount)}/{r.minCount} {r.kind}
                      {r.minCount > 1 ? "s" : ""}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <Button className="w-full" size="lg" variant="brand" disabled={!files.length || phase !== "idle"} onClick={submit}>
          {phase === "uploading" ? (
            <>
              <Loader2 className="animate-spin" /> Uploading…
            </>
          ) : phase === "reviewing" ? (
            <>
              <Sparkles className="animate-pulse" /> AI is reviewing {files.length} files…
            </>
          ) : (
            "Submit for verification"
          )}
        </Button>
      </div>
    </div>
  );
}
