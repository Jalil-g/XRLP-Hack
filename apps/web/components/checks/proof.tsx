// Plumbing on demand: hashes, signers and explorer links live behind one "Proof" disclosure, one click away.
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type ProofItem = { label: string; value: React.ReactNode };

export function Proof({ items, className, label = "Proof" }: { items: ProofItem[]; className?: string; label?: string }) {
  const shown = items.filter((i) => i.value !== undefined && i.value !== null && i.value !== false && i.value !== "");
  if (!shown.length) return null;
  return (
    <details className={cn("proof group", className)}>
      <summary className="inline-flex min-h-11 items-center gap-1 text-small font-medium text-ink-2 hover:text-ink">
        <ChevronRight className="proof-chevron size-4 transition-transform duration-150" aria-hidden />
        {label}
      </summary>
      <dl className="grid grid-cols-[minmax(0,max-content)_minmax(0,1fr)] gap-x-6 gap-y-2 pb-4 pl-5 text-small">
        {shown.map((i) => (
          <div key={i.label} className="contents">
            <dt className="text-ink-2">{i.label}</dt>
            <dd className="min-w-0 break-words text-ink">{i.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
