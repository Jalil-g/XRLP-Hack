"use client";
// INS-01 landing: who you are + what is assigned to you (proves routes 18a/18b end to end). INS-02 turns this into the queue.
import { useEffect, useState } from "react";
import { HardHat, MapPin } from "lucide-react";
import { useIdentity } from "@/components/identity";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, SectionLabel } from "@/components/ui/card";
import { VerifiedInspectorBadge } from "@/components/verified-badge";
import { api } from "@/lib/api";
import type { InspectorTask, TaskNeeds } from "@/lib/types";
import { BRAND, explorerAccountUrl, formatRlusd, shortAddress } from "@/lib/utils";

const NEEDS: Record<TaskNeeds, { label: string; tone: Tone }> = {
  pre_visit: { label: "Pre-construction visit", tone: "info" },
  audit: { label: "Audit due", tone: "brand" },
  re_audit: { label: "Re-audit", tone: "warn" },
  none: { label: "Nothing due", tone: "neutral" },
};

export default function Home() {
  const { status, error, inspector } = useIdentity();
  const [tasks, setTasks] = useState<InspectorTask[] | null>(null);
  const [queueError, setQueueError] = useState<string>();

  useEffect(() => {
    if (!inspector) return;
    let live = true;
    setTasks(null);
    setQueueError(undefined);
    api
      .getQueue(inspector.address)
      .then((t) => live && setTasks(t))
      .catch((err: Error) => live && setQueueError(err.message));
    return () => {
      live = false;
    };
  }, [inspector]);

  if (status === "error") return <p className="text-sm text-bad">Could not load the inspector panel: {error}</p>;
  if (!inspector) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Assigned audits</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">{BRAND.tagline}</p>
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-4">
          <span className="flex size-11 items-center justify-center rounded-full bg-amber-50 text-amber-700">
            <HardHat className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{inspector.name}</span>
              <VerifiedInspectorBadge inspector={inspector} />
            </div>
            <p className="text-[13px] text-muted">
              {inspector.licenseNumber} · {inspector.trades.join(", ")}
            </p>
          </div>
          <a href={explorerAccountUrl(inspector.address)} target="_blank" rel="noreferrer" className="ml-auto font-mono text-xs text-muted hover:text-brand">
            {shortAddress(inspector.address, 8, 6)}
          </a>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your work</CardTitle>
          {tasks && (
            <div className="flex gap-1.5">
              {(["pre_visit", "audit", "re_audit"] as const).map((n) => (
                <Badge key={n} tone={NEEDS[n].tone}>
                  {tasks.filter((t) => t.needs === n).length} {NEEDS[n].label.toLowerCase()}
                </Badge>
              ))}
            </div>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {queueError ? (
            <p className="px-5 py-4 text-sm text-bad">{queueError}</p>
          ) : !tasks ? (
            <p className="px-5 py-4 text-sm text-muted">Loading queue…</p>
          ) : tasks.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted">No projects assigned to you yet. The AI assigns inspectors at lock-terms.</p>
          ) : (
            <ul className="divide-y divide-line">
              {tasks.map((t) => (
                <li key={`${t.projectId}:${t.milestone?.id ?? "pre"}`} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <SectionLabel>{t.projectName}</SectionLabel>
                    <p className="text-sm font-medium">
                      {t.milestone ? `M${t.milestone.index + 1} · ${t.milestone.title}` : "Site visit before verification"}
                      <span className="ml-2 text-muted">
                        {t.sov.length} SoV line{t.sov.length === 1 ? "" : "s"} · {t.evidence.length} evidence file{t.evidence.length === 1 ? "" : "s"}
                      </span>
                    </p>
                  </div>
                  <span className="ml-auto flex items-center gap-3">
                    <span className="hidden items-center gap-1 text-xs text-faint sm:flex">
                      <MapPin className="size-3.5" /> {t.siteGeo.lat.toFixed(4)}, {t.siteGeo.lng.toFixed(4)}
                    </span>
                    {t.milestone && <span className="tabular text-sm text-ink-2">{formatRlusd(t.milestone.amount)}</span>}
                    <Badge tone={NEEDS[t.needs].tone} dot>
                      {NEEDS[t.needs].label}
                    </Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
