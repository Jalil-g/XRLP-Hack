import { Clock, FileText, MapPin, MapPinOff, Receipt } from "lucide-react";
import type { Evidence, Verdict } from "@xrlp/shared";
import { cn, formatAmount } from "@/lib/utils";

const fmtTaken = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC" });

export function EvidenceGallery({ evidence, verdict, compact }: { evidence: Evidence[]; verdict: Verdict | null; compact?: boolean }) {
  const flagged = new Set(verdict?.checks.filter((c) => c.result === "fail").flatMap((c) => c.evidenceIds) ?? []);
  const warned = new Set(verdict?.checks.filter((c) => c.result === "warn").flatMap((c) => c.evidenceIds) ?? []);
  if (!evidence.length) return null;

  return (
    <ul className={cn("grid gap-3", compact ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4")}>
      {evidence.map((e) => {
        const isFlagged = flagged.has(e.id);
        const isWarned = !isFlagged && warned.has(e.id);
        return (
          <li
            key={e.id}
            className={cn(
              "group overflow-hidden rounded-lg border bg-surface",
              isFlagged ? "border-bad ring-2 ring-bad/25" : isWarned ? "border-warn-line" : "border-line",
            )}
          >
            <div className="relative aspect-[4/3] bg-subtle">
              {e.uri ? (
                // eslint-disable-next-line @next/next/no-img-element -- data: URLs and generated SVGs
                <img src={e.uri} alt={e.filename} className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <div className="flex h-full items-center justify-center text-faint">
                  <FileText className="size-6" />
                </div>
              )}
              <span className="absolute top-1.5 left-1.5 rounded bg-ink/70 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-white uppercase">
                {e.kind}
              </span>
              {isFlagged && (
                <span className="absolute top-1.5 right-1.5 rounded bg-bad px-1.5 py-0.5 text-[10px] font-semibold text-white uppercase">Flagged</span>
              )}
            </div>
            {!compact && (
              <div className="space-y-0.5 px-2.5 py-2">
                <div className="truncate font-mono text-[11px] text-ink-2" title={`${e.filename} · sha256 ${e.sha256}`}>
                  {e.filename}
                </div>
                {e.kind === "photo" ? (
                  <div className="flex flex-col gap-0.5 text-[11px] text-muted">
                    <span className={cn("inline-flex items-center gap-1", !e.meta.gps && "text-warn")}>
                      {e.meta.gps ? <MapPin className="size-3" /> : <MapPinOff className="size-3" />}
                      {e.meta.gps ? `${e.meta.gps.lat.toFixed(4)}, ${e.meta.gps.lng.toFixed(4)}` : "No GPS"}
                    </span>
                    {e.meta.takenAt && (
                      <span className={cn("inline-flex items-center gap-1", isFlagged && "text-bad")}>
                        <Clock className="size-3" />
                        {fmtTaken.format(new Date(e.meta.takenAt))}
                      </span>
                    )}
                  </div>
                ) : e.meta.invoiceTotal ? (
                  <div className="inline-flex items-center gap-1 text-[11px] text-muted">
                    <Receipt className="size-3" />
                    {formatAmount(e.meta.invoiceTotal)} RLUSD
                  </div>
                ) : (
                  <div className="text-[11px] text-muted">sha256 {e.sha256.slice(0, 10)}…</div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
