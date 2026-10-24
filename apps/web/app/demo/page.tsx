import Link from "next/link";
import { ArrowUpRight, Building2, Clapperboard, HardHat, Link2, Sparkles } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { DemoSteps } from "@/components/demo/demo-steps";
import { ApprovalsPanel } from "@/components/project/approvals-panel";
import { ChainTimeline } from "@/components/project/chain-timeline";
import { EscrowPipeline } from "@/components/project/escrow-pipeline";
import { EvidenceGallery } from "@/components/project/evidence-gallery";
import { MilestoneStatusIcon } from "@/components/project/milestone-status-icon";
import { VerdictCard } from "@/components/project/verdict-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StackedBar } from "@/components/ui/progress";
import { getDemoState, getProjectDetail } from "@/lib/api";
import { MILESTONE_STATUS, focusMilestoneIndex, projectStatus } from "@/lib/display";
import { cn, formatAmount, toCents } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Demo control room" };

/** One-screen story for judges: script on the left; builder | AI | inspector | ledger panes on the right. */
export default async function DemoPage() {
  const demo = await getDemoState();
  const detail = await getProjectDetail(demo.project.project.id);
  const { project, funds } = detail;
  const focus = detail.milestones[focusMilestoneIndex(detail.milestones)]!;
  const status = projectStatus(project);
  const milestoneTitles = Object.fromEntries(project.milestones.map((m) => [m.id, m.title]));
  const atBuilder = Math.max(0, toCents(funds.released) - toCents(funds.repaid));
  const money = [
    { label: "Vault (awaiting close)", value: toCents(funds.awaitingClose), className: "bg-sky-400" },
    { label: "Locked in escrow", value: toCents(funds.escrowed), className: "bg-lock" },
    { label: "Released to builder", value: atBuilder, className: "bg-ok" },
    { label: "Back in vault", value: toCents(funds.repaid) + toCents(funds.refunded), className: "bg-emerald-300" },
  ];

  return (
    <div className="space-y-5">
      <AutoRefresh ms={2500} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-lg bg-ink text-white">
            <Clapperboard className="size-4" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Demo control room</h1>
            <p className="text-[13px] text-muted">
              Steps follow docs/04-demo-script.md · acting on <span className="font-medium text-ink-2">{project.name}</span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
          <Link href={`/projects/${project.id}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
            Open project page <ArrowUpRight className="size-3.5" />
          </Link>
        </div>
      </div>

      {/* Milestone strip */}
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${detail.milestones.length}, minmax(0, 1fr))` }}>
        {detail.milestones.map((v) => (
          <div
            key={v.milestone.id}
            className={cn(
              "flex items-center gap-2.5 rounded-xl border bg-surface px-3 py-2 shadow-card",
              v.milestone.id === focus.milestone.id ? "border-brand ring-2 ring-brand/15" : "border-line",
            )}
          >
            <MilestoneStatusIcon status={v.milestone.status} className="size-7" />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold">{v.milestone.title}</div>
              <div className="text-[11.5px] text-muted">
                {formatAmount(v.milestone.amount)} · {MILESTONE_STATUS[v.milestone.status].short}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-[300px_1fr]">
        <aside>
          <DemoSteps steps={demo.steps} />
        </aside>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Builder */}
          <Pane icon={Building2} title="Builder" subtitle={`${detail.builder.name} · ${focus.milestone.title}`}>
            {focus.milestone.status === "pending" ? (
              <p className="text-[13px] text-muted">Escrows are created when the loan closes.</p>
            ) : (
              <div className="space-y-4">
                <EscrowPipeline view={focus} />
                {focus.evidence.length ? (
                  <EvidenceGallery evidence={focus.evidence} verdict={focus.verdict} compact />
                ) : (
                  <p className="text-[13px] text-muted">Waiting for the builder to upload evidence for {focus.milestone.title}.</p>
                )}
              </div>
            )}
          </Pane>

          {/* AI */}
          <div className="min-w-0">
            <PaneLabel icon={Sparkles} title="AI verifier" />
            <VerdictCard verdict={focus.verdict} />
          </div>

          {/* Inspector */}
          <div className="min-w-0">
            <PaneLabel icon={HardHat} title="Inspector & signers" />
            <ApprovalsPanel view={focus} />
          </div>

          {/* Ledger */}
          <Pane icon={Link2} title="Ledger" subtitle="XRPL devnet · live">
            <StackedBar total={Math.max(toCents(funds.target), toCents(funds.raised))} segments={money} className="h-3" />
            <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
              {money.map((m) => (
                <li key={m.label} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-muted">
                    <span className={cn("size-2 rounded-sm", m.className)} />
                    {m.label}
                  </span>
                  <span className="tabular font-medium">{formatAmount(m.value / 100)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 text-[12px] text-muted">
              Share price <span className="font-mono font-medium text-ink">{detail.vault.sharePrice}</span>
            </div>
            <div className="mt-4 max-h-[420px] overflow-y-auto border-t border-line pt-4">
              <ChainTimeline events={detail.timeline} directory={detail.directory} milestoneTitles={milestoneTitles} limit={12} />
            </div>
          </Pane>
        </div>
      </div>
    </div>
  );
}

function PaneLabel({ icon: Icon, title }: { icon: typeof Building2; title: string }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-faint uppercase">
      <Icon className="size-3.5" />
      {title}
    </div>
  );
}

function Pane({ icon, title, subtitle, children }: { icon: typeof Building2; title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <PaneLabel icon={icon} title={title} />
      <Card>
        <CardHeader className="py-3.5">
          <CardTitle>{subtitle}</CardTitle>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}
