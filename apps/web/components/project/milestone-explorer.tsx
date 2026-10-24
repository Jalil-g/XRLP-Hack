"use client";

import { useState } from "react";
import { CalendarClock, FileCheck2, Image as ImageIcon, Lock, Receipt } from "lucide-react";
import { TxLink } from "@/components/chain";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, SectionLabel } from "@/components/ui/card";
import { MILESTONE_STATUS } from "@/lib/display";
import type { MilestoneView } from "@/lib/types";
import { cn, formatAmount, formatDate } from "@/lib/utils";
import { ApprovalsPanel } from "./approvals-panel";
import { EscrowPipeline } from "./escrow-pipeline";
import { EvidenceGallery } from "./evidence-gallery";
import { MilestoneStatusIcon } from "./milestone-status-icon";
import { VerdictCard } from "./verdict-card";

const KIND_ICON = { photo: ImageIcon, invoice: Receipt, document: FileCheck2 } as const;

/** Picks the milestone most worth showing: the one in flight, else the latest acted-on, else the first. */
function defaultIndex(views: MilestoneView[]) {
  const inFlight = views.findIndex((v) => ["evidence_submitted", "ai_reviewed", "inspected", "rejected"].includes(v.milestone.status));
  if (inFlight >= 0) return inFlight;
  const lastReleased = views.map((v) => v.milestone.status).lastIndexOf("released");
  if (lastReleased >= 0) return lastReleased;
  return Math.max(0, views.findIndex((v) => v.milestone.status === "escrowed"));
}

export function MilestoneExplorer({ views }: { views: MilestoneView[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = views.find((v) => v.milestone.id === selectedId) ?? views[defaultIndex(views)]!;

  return (
    <div className="space-y-4">
      {/* Stepper */}
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${views.length}, minmax(0, 1fr))` }} role="tablist">
        {views.map((v, i) => {
          const m = v.milestone;
          const active = v.milestone.id === selected.milestone.id;
          const meta = MILESTONE_STATUS[m.status];
          return (
            <button
              key={m.id}
              role="tab"
              aria-selected={active}
              onClick={() => setSelectedId(m.id)}
              className={cn(
                "relative rounded-xl border bg-surface p-3 text-left shadow-card transition-all",
                active ? "border-brand ring-2 ring-brand/15" : "border-line hover:border-line-strong",
              )}
            >
              <div className="flex items-center gap-2.5">
                <MilestoneStatusIcon status={m.status} className={cn(active && m.status !== "released" && m.status !== "refunded" && "animate-pulse-ring")} />
                <div className="min-w-0">
                  <div className="text-[11px] font-medium text-faint">Milestone {i + 1}</div>
                  <div className="truncate text-[13px] font-semibold text-ink">{m.title}</div>
                </div>
              </div>
              <div className="mt-2.5 flex items-end justify-between gap-2">
                <span className="tabular text-[13px] font-medium text-ink-2">{formatAmount(m.amount)}</span>
                <span className={cn("hidden truncate text-[11px] font-medium sm:block", toneText[meta.tone])}>{meta.short}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Selected milestone */}
      <Card>
        <CardContent className="space-y-5 py-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <SectionLabel>Milestone {selected.milestone.index + 1} escrow</SectionLabel>
              <h3 className="mt-1 text-xl font-semibold tracking-tight">{selected.milestone.title}</h3>
              <div className="mt-1.5">
                <Badge tone={MILESTONE_STATUS[selected.milestone.status].tone} dot>
                  {MILESTONE_STATUS[selected.milestone.status].label}
                </Badge>
              </div>
            </div>
            <div className="text-right">
              <div className="tabular text-2xl font-semibold tracking-tight">
                {formatAmount(selected.milestone.amount)} <span className="text-base font-medium text-muted">RLUSD</span>
              </div>
              <div className="mt-1 text-xs text-muted">
                {selected.milestone.requiredInspectors > 1 ? "2 inspectors required" : "1 inspector required"}
              </div>
            </div>
          </div>

          {selected.milestone.status === "pending" ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-line-strong px-3 py-3 text-[13px] text-muted">
              <Lock className="size-4" />
              This escrow is created on-chain the moment the loan closes. Until then, funds wait in the vault.
            </div>
          ) : (
            <EscrowPipeline view={selected} />
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <VerdictCard verdict={selected.verdict} />
            <ApprovalsPanel view={selected} />
          </div>

          {selected.evidence.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <SectionLabel>Evidence submitted ({selected.evidence.length})</SectionLabel>
                <span className="text-xs text-faint">SHA-256 fingerprinted at upload</span>
              </div>
              <EvidenceGallery evidence={selected.evidence} verdict={selected.verdict} />
            </div>
          )}

          <div className="grid gap-4 border-t border-line pt-5 md:grid-cols-2">
            <div>
              <SectionLabel className="mb-2">Required evidence (locked template)</SectionLabel>
              <ul className="space-y-1.5">
                {selected.template?.requiredEvidence.map((r) => {
                  const Icon = KIND_ICON[r.kind];
                  const have = selected.evidence.filter((e) => e.kind === r.kind).length;
                  const ok = have >= r.minCount;
                  return (
                    <li key={r.description} className="flex items-start gap-2 text-[13px]">
                      <Icon className={cn("mt-0.5 size-4 shrink-0", ok ? "text-ok" : "text-faint")} />
                      <span className="text-ink-2">
                        {r.description}
                        <span className="text-faint">
                          {" "}
                          · {Math.min(have, r.minCount)}/{r.minCount} {r.kind}
                          {r.minCount > 1 ? "s" : ""}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div>
              <SectionLabel className="mb-2">On-chain escrow</SectionLabel>
              {selected.milestone.escrow ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
                  <dt className="text-muted">Created</dt>
                  <dd>
                    <TxLink hash={selected.milestone.escrow.createTx} />
                  </dd>
                  {selected.milestone.escrow.finishTx && (
                    <>
                      <dt className="text-muted">Released</dt>
                      <dd>
                        <TxLink hash={selected.milestone.escrow.finishTx} />
                      </dd>
                    </>
                  )}
                  {selected.milestone.escrow.cancelTx && (
                    <>
                      <dt className="text-muted">Cancelled</dt>
                      <dd>
                        <TxLink hash={selected.milestone.escrow.cancelTx} />
                      </dd>
                    </>
                  )}
                  <dt className="text-muted">Condition</dt>
                  <dd className="truncate font-mono text-[12px] text-ink-2" title={selected.milestone.escrow.condition}>
                    PREIMAGE-SHA-256 · {selected.milestone.escrow.condition.slice(8, 22)}…
                  </dd>
                  <dt className="text-muted">Sequence</dt>
                  <dd className="font-mono text-[12px] text-ink-2">{selected.milestone.escrow.offerSequence}</dd>
                  {selected.milestone.cancelAfter && (
                    <>
                      <dt className="text-muted">Cancel after</dt>
                      <dd className="inline-flex items-center gap-1 text-ink-2">
                        <CalendarClock className="size-3.5 text-faint" />
                        {formatDate(selected.milestone.cancelAfter)}
                      </dd>
                    </>
                  )}
                </dl>
              ) : (
                <p className="text-[13px] text-muted">Not created yet.</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

const toneText = {
  neutral: "text-muted",
  brand: "text-brand",
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
  info: "text-info",
  lock: "text-lock",
} as const;
