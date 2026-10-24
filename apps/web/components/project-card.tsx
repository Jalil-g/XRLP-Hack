import Link from "next/link";
import { ArrowRight, Layers, MapPin } from "lucide-react";
import { VerifiedBuilderBadge } from "@/components/chain";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { PROJECT_TYPE, RISK_TIER, projectStatus } from "@/lib/display";
import type { ProjectSummary } from "@/lib/types";
import { formatAmount, formatBps } from "@/lib/utils";

export function ProjectCard({ summary }: { summary: ProjectSummary }) {
  const { project, builder, funding } = summary;
  const status = projectStatus(project);
  const months = Math.round(project.terms.termDays / 30.4);
  return (
    <Link
      href={`/projects/${project.id}`}
      className="group flex flex-col rounded-xl border border-line bg-surface shadow-card transition-all hover:-translate-y-0.5 hover:border-line-strong hover:shadow-pop"
    >
      <div className="flex-1 p-5">
        <div className="flex items-center justify-between gap-2">
          <Badge tone={status.tone} dot>
            {status.label}
          </Badge>
          <Badge tone={RISK_TIER[builder.riskTier].tone}>{RISK_TIER[builder.riskTier].label}</Badge>
        </div>
        <h3 className="mt-4 text-[17px] font-semibold tracking-tight text-ink group-hover:text-brand">{project.name}</h3>
        <div className="mt-1 flex items-center gap-1 text-[13px] text-muted">
          <MapPin className="size-3.5" />
          {project.siteAddress.split(",").slice(1).join(",").trim() || project.siteAddress}
          <span className="text-faint">· {PROJECT_TYPE[project.type]}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
          <span className="font-medium text-ink-2">{builder.name}</span>
          {builder.verified && <VerifiedBuilderBadge />}
        </div>

        <div className="mt-5">
          <div className="flex items-baseline justify-between text-[13px]">
            <span>
              <span className="tabular font-semibold text-ink">{formatAmount(funding.raised)}</span>
              <span className="text-muted"> / {formatAmount(funding.target)} RLUSD</span>
            </span>
            <span className="tabular font-medium text-ink-2">{Math.floor(funding.pct)}%</span>
          </div>
          <Progress value={funding.pct} className="mt-2" barClassName={funding.pct >= 100 ? "bg-ok" : undefined} />
        </div>
      </div>
      <dl className="grid grid-cols-3 divide-x divide-line border-t border-line text-center">
        <Stat label="Rate" value={formatBps(project.terms.interestRateBps)} />
        <Stat label="Term" value={`${months} mo`} />
        <Stat
          label="Milestones"
          value={
            <span className="inline-flex items-center gap-1">
              <Layers className="size-3.5 text-faint" />
              {summary.milestonesReleased}/{project.milestones.length}
            </span>
          }
        />
      </dl>
      <div className="flex items-center justify-between border-t border-line px-5 py-3 text-[13px] font-medium text-brand">
        {project.status === "funding" ? "Review & invest" : "View escrows & evidence"}
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-2 py-3">
      <dt className="text-[11px] text-faint">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}
