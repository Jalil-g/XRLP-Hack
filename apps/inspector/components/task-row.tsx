// One route 18 task in the queue: project, milestone, amount, and the one thing to press. Evidence, expiry and prior audits
// sit in one quiet line; they turn red only when something is short or the escrow is close to expiring.
import Link from "next/link";
import { Badge, type Tone } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { evidenceStatus, taskHref, taskAmount, type EvidenceKindStatus } from "@/lib/queue";
import type { InspectorTask, TaskNeeds } from "@/lib/types";
import { cn, formatAmount, formatDate } from "@/lib/utils";

export const NEEDS: Record<TaskNeeds, { label: string; action: string; tone: Tone }> = {
  re_audit: { label: "Re-audit", action: "Re-audit", tone: "warn" },
  audit: { label: "Audit due", action: "Audit", tone: "neutral" },
  pre_visit: { label: "Site visit", action: "Visit site", tone: "info" },
  none: { label: "Nothing due", action: "", tone: "neutral" },
};

const KIND: Record<EvidenceKindStatus["kind"], [string, string]> = {
  photo: ["photo", "photos"],
  invoice: ["invoice", "invoices"],
  document: ["doc", "docs"],
};

const DAY_MS = 86_400_000;

function expiryLabel(iso: string, now: number) {
  const days = Math.ceil((Date.parse(iso) - now) / DAY_MS);
  if (days < 0) return { text: `Expired ${formatDate(iso)}`, urgent: true };
  return { text: `Expires in ${days} day${days === 1 ? "" : "s"}`, urgent: days <= 7 };
}

export function TaskRow({ task, fresh, now }: { task: InspectorTask; fresh?: boolean; now: number }) {
  const ev = evidenceStatus(task);
  const m = task.milestone;
  const expiry = m?.cancelAfter ? expiryLabel(m.cancelAfter, now) : null;
  const mine = task.priorAudits.length;
  const href = taskHref(task);
  const short = ev.kinds.filter((k) => k.have < k.need);

  return (
    <li className={cn("grid items-center gap-x-8 gap-y-3 py-4 transition-[background-color,box-shadow] duration-500 sm:grid-cols-[minmax(0,1fr)_auto]", fresh && "bg-band shadow-[-12px_0_0_var(--color-band),12px_0_0_var(--color-band)]")}>
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2 text-body font-semibold">
          {task.projectName}
          {fresh && <Badge>New</Badge>}
        </p>
        <p className="mt-0.5 flex flex-wrap gap-x-5 gap-y-0.5 text-small text-ink-2">
          <span className="text-ink">
            {m ? (
              <>
                <span className="mr-1.5 tabular text-ink-3">{m.index + 1}</span>
                {m.title}
              </>
            ) : (
              "Site visit"
            )}
          </span>
          {m &&
            (short.length ? (
              <span className="font-medium text-fail">
                {short.map((k) => `${k.have}/${k.need} ${KIND[k.kind][1]}`).join(", ")}
              </span>
            ) : (
              <span className="tabular">{ev.uploaded} file{ev.uploaded === 1 ? "" : "s"}</span>
            ))}
          {expiry && <span className={cn("tabular", expiry.urgent && "font-medium text-fail")}>{expiry.text}</span>}
          {mine > 0 && <span>{mine} prior audit{mine === 1 ? "" : "s"}</span>}
        </p>
      </div>
      <div className="flex items-center justify-between gap-6 sm:justify-end">
        <p className="tabular sm:min-w-[120px] sm:text-right">
          <span className="text-body font-semibold">{formatAmount(taskAmount(task))}</span>
          <span className="ml-1 text-caption text-ink-2">RLUSD</span>
        </p>
        {href && (
          <Link href={href} className={buttonClass("primary", "md", "min-w-[112px]")}>
            {NEEDS[task.needs].action}
          </Link>
        )}
      </div>
    </li>
  );
}
