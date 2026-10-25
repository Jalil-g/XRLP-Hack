// What the checks looked at for one milestone: the builder's evidence and the inspector's own photos.
import { fileUrl } from "@/lib/api";
import type { CheckResult, Evidence, InspectorAudit } from "@/lib/contract";
import { cn } from "@/lib/utils";

export function EvidenceStrip({ evidence, audit, results }: { evidence: Evidence[]; audit?: InspectorAudit; results: CheckResult[] }) {
  const flagged = new Set(results.filter((c) => c.result === "fail").flatMap((c) => c.evidenceIds));
  const inspector = audit?.photos ?? [];
  if (!evidence.length && !inspector.length) return null;
  return (
    <div className="flex flex-wrap gap-x-12 gap-y-6">
      {evidence.length > 0 && <Group title={`Builder evidence · ${evidence.length} files`} items={evidence} flagged={flagged} />}
      {inspector.length > 0 && <Group title={`Inspector photos · ${inspector.length}`} items={inspector} flagged={flagged} />}
    </div>
  );
}

function Group({ title, items, flagged }: { title: string; items: Evidence[]; flagged: Set<string> }) {
  return (
    <div>
      <h3 className="mb-2 text-caption text-ink-2">{title}</h3>
      <ul className="flex flex-wrap gap-2">
        {items.map((e) => (
          <li key={e.id}>
            <a
              href={fileUrl(e)}
              target="_blank"
              rel="noreferrer"
              title={`${e.filename}${flagged.has(e.id) ? " · flagged by a check" : ""}`}
              className={cn(
                "flex h-[54px] w-[72px] items-center justify-center overflow-hidden rounded-control bg-band text-caption font-medium text-ink-2 transition-opacity duration-150 hover:opacity-80",
                flagged.has(e.id) && "ring-2 ring-fail",
              )}
            >
              {e.kind === "photo" ? (
                // eslint-disable-next-line @next/next/no-img-element -- evidence served by core (/api/files) or fixture art
                <img src={fileUrl(e)} alt={e.filename} className="size-full object-cover" loading="lazy" />
              ) : (
                <span>{e.kind === "invoice" ? "Invoice" : "PDF"}</span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
