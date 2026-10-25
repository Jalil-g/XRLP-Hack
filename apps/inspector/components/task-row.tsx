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
  audit: { label: "Audit due", action: "Start audit", tone: "neutral" },
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
    <tr className={cn("h-14 transition-colors duration-500", fresh && "bg-band")}>
      <td className="py-3 pr-4">
        <p className="flex flex-wrap items-center gap-x-2">
          {task.projectName}
          {fresh && <Badge>New</Badge>}
        </p>
        <p className="mt-1 text-caption text-ink-2">{formatAmount(taskAmount(task))} RLUSD{mine > 0 && ` · ${mine} prior audit${mine === 1 ? "" : "s"}`}</p>
      </td>
      <td className="py-3 pr-4">
          <span>
            {m ? (
              <>
                <span className="mr-1.5 tabular text-ink-3">{m.index + 1}</span>
                {m.title}
              </>
            ) : (
              "Site visit"
            )}
          </span>
      </td>
      <td className="py-3 pr-4 text-caption text-ink-2"><span className="block">{task.siteGeo.lat.toFixed(4)}, {task.siteGeo.lng.toFixed(4)}</span><span>{task.siteGeo.radiusM} m radius</span></td>
      <td className="py-3 pr-4">
          {m ?
            (short.length ? (
              <span className="font-medium text-fail">
                {short.map((k) => `${k.have}/${k.need} ${KIND[k.kind][1]}`).join(", ")}
              </span>
            ) : (
              <span className="tabular">{ev.uploaded} file{ev.uploaded === 1 ? "" : "s"}</span>
            )) : <span className="text-ink-2">Site visit required</span>}
      </td>
      <td className="py-3 pr-4 text-caption">{expiry ? <span className={cn(expiry.urgent && "text-fail")}>{expiry.text}</span> : "—"}</td>
      <td className="py-3 pr-4"><Badge tone={NEEDS[task.needs].tone}>{NEEDS[task.needs].label}</Badge></td>
      <td className="py-3 text-right">
        {href && (
          <Link href={href} className={buttonClass("secondary", "sm", "min-w-[112px]")}>
            {NEEDS[task.needs].action}
          </Link>
        )}
      </td>
    </tr>
  );
}
