// One route 18 task in the queue: project, milestone, SoV line(s), amount, builder evidence status, escrow expiry.
import Link from "next/link";
import { ArrowRight, CalendarClock, Camera, FileText, History, MapPin, Receipt } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import { SectionLabel } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { evidenceStatus, taskHref, taskAmount, type EvidenceKindStatus } from "@/lib/queue";
import type { InspectorTask, TaskNeeds } from "@/lib/types";
import { cn, formatDateTime, formatRlusd } from "@/lib/utils";

export const NEEDS: Record<TaskNeeds, { label: string; tone: Tone; hint: string }> = {
  re_audit: { label: "Re-audit", tone: "warn", hint: "The suite failed on your earlier audit. Your new audit supersedes it." },
  audit: { label: "Audit due", tone: "brand", hint: "Builder evidence is in. The escrow cannot release until your signed audit is filed." },
  pre_visit: { label: "Pre-construction visit", tone: "info", hint: "The AI escalated project verification. Confirm the site before the project is listed." },
  none: { label: "Nothing due", tone: "neutral", hint: "Assigned to you, but nothing to audit yet." },
};

const KIND: Record<EvidenceKindStatus["kind"], { label: string; Icon: typeof Camera }> = {
  photo: { label: "photos", Icon: Camera },
  invoice: { label: "invoices", Icon: Receipt },
  document: { label: "docs", Icon: FileText },
};

const DAY_MS = 86_400_000;

function expiryLabel(iso: string, now: number) {
  const days = Math.ceil((Date.parse(iso) - now) / DAY_MS);
  if (days < 0) return { text: `Escrow expired ${formatDateTime(iso)}`, urgent: true };
  return { text: `Escrow expires in ${days} day${days === 1 ? "" : "s"}`, urgent: days <= 7 };
}

export function TaskRow({ task, fresh, now }: { task: InspectorTask; fresh?: boolean; now: number }) {
  const ev = evidenceStatus(task);
  const m = task.milestone;
  const expiry = m?.cancelAfter ? expiryLabel(m.cancelAfter, now) : null;
  const mine = task.priorAudits.length;
  const href = taskHref(task);
  const title = m ? `M${m.index + 1} · ${m.title}` : "Site visit before verification";

  return (
    <li className={cn("py-5 transition-colors duration-150", fresh && "bg-brand-50")}>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <SectionLabel className="flex items-center gap-2">
            {task.projectName}
            {fresh && <Badge tone="brand">New</Badge>}
          </SectionLabel>
          <p className="mt-0.5 text-small font-semibold">
            {href ? (
              <Link href={href} className="hover:text-brand hover:underline">
                {title}
              </Link>
            ) : (
              title
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="tabular text-small font-medium text-ink-2">{formatRlusd(taskAmount(task))}</span>
          <Badge tone={NEEDS[task.needs].tone} dot>
            {NEEDS[task.needs].label}
          </Badge>
          {href && (
            <Link href={href} className={buttonClass("secondary", "sm")}>
              {task.needs === "re_audit" ? "Re-audit" : task.needs === "pre_visit" ? "Visit site" : "Audit"} <ArrowRight className="size-3.5" />
            </Link>
          )}
        </div>
      </div>

      <ul className="mt-2 flex flex-wrap gap-1.5">
        {task.sov.map((l) => (
          <li key={l.code} className="rounded-md bg-subtle px-2 py-0.5 text-caption text-ink-2">
            <span className="font-mono text-faint">{l.code}</span> {l.title} <span className="tabular text-faint">· {formatRlusd(l.amount)}</span>
          </li>
        ))}
      </ul>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-caption text-muted">
        {m && (
          <span className="flex items-center gap-2">
            <span className="text-faint">Builder evidence</span>
            {ev.kinds.length === 0 ? (
              <span>{ev.uploaded} files</span>
            ) : (
              ev.kinds.map(({ kind, have, need }) => {
                const { label, Icon } = KIND[kind];
                return (
                  <span key={kind} className={cn("flex items-center gap-1 tabular", have >= need ? "text-ok" : "text-bad")}>
                    <Icon className="size-3.5" />
                    {have}/{need} {label}
                  </span>
                );
              })
            )}
          </span>
        )}
        {expiry && (
          <span className={cn("flex items-center gap-1", expiry.urgent && "font-medium text-bad")}>
            <CalendarClock className="size-3.5" /> {expiry.text}
          </span>
        )}
        {mine > 0 && (
          <span className="flex items-center gap-1">
            <History className="size-3.5" /> {mine} prior audit{mine === 1 ? "" : "s"}
          </span>
        )}
        <span className="flex items-center gap-1 text-faint">
          <MapPin className="size-3.5" /> {task.siteGeo.lat.toFixed(4)}, {task.siteGeo.lng.toFixed(4)}
        </span>
      </div>
    </li>
  );
}
