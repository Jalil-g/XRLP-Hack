import Link from "next/link";
import { ArrowRight, BadgeCheck, Clock, Lock, Unlock, Wallet } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { TxLink, VerifiedBuilderBadge } from "@/components/chain";
import { EvidenceUploader } from "@/components/builder/evidence-uploader";
import { ApprovalsPanel } from "@/components/project/approvals-panel";
import { EscrowPipeline } from "@/components/project/escrow-pipeline";
import { VerdictCard } from "@/components/project/verdict-card";
import { StatTile } from "@/components/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getBuilderDashboard } from "@/lib/api";
import { MILESTONE_STATUS, projectStatus } from "@/lib/display";
import { getSession } from "@/lib/session";
import { formatAmount, formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Builder" };

export default async function BuilderPage() {
  const session = await getSession();
  const dash = await getBuilderDashboard(session.builder.id);
  const { builder } = dash;

  return (
    <div className="space-y-8">
      <AutoRefresh ms={5000} />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-[13px] text-muted">Builder workspace</div>
          <h1 className="mt-1 flex flex-wrap items-center gap-2 text-[28px] font-semibold tracking-tight">
            {builder.name} {builder.verified && <VerifiedBuilderBadge />}
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            License {builder.licenseNumber} · {builder.insurancePolicy} · {builder.completedProjects} completed projects
            {builder.credentialTx && (
              <>
                {" "}
                · credential <TxLink hash={builder.credentialTx} />
              </>
            )}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label="Raised across projects" value={formatAmount(dash.totals.raised)} unit="RLUSD" icon={Wallet} />
        <StatTile label="Waiting in escrow" value={formatAmount(dash.totals.escrowed)} unit="RLUSD" icon={Lock} hint="Released stage by stage on proof" />
        <StatTile label="Paid out to you" value={formatAmount(dash.totals.released)} unit="RLUSD" icon={Unlock} hint={`${dash.payouts.length} escrow releases`} />
      </div>

      {dash.projects.map(({ summary, current }) => {
        const p = summary.project;
        const status = projectStatus(p);
        const canUpload = current && ["escrowed", "rejected"].includes(current.milestone.status);
        return (
          <Card key={p.id}>
            <CardHeader>
              <div>
                <div className="flex items-center gap-2">
                  <CardTitle className="text-[17px]">{p.name}</CardTitle>
                  <Badge tone={status.tone} dot>
                    {status.label}
                  </Badge>
                </div>
                <CardDescription>
                  {summary.milestonesReleased}/{p.milestones.length} milestones released · {formatAmount(summary.funding.raised)} of{" "}
                  {formatAmount(summary.funding.target)} RLUSD raised
                </CardDescription>
              </div>
              <Link href={`/projects/${p.id}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
                Public project page <ArrowRight className="size-3.5" />
              </Link>
            </CardHeader>
            <CardContent className="space-y-5 py-5">
              {!current ? (
                <p className="flex items-center gap-2 text-[13px] text-muted">
                  <Clock className="size-4" />
                  {p.chain.loanId ? "No milestone is awaiting evidence." : "Evidence upload unlocks once the project is funded and the loan closes (escrows created)."}
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-xs text-muted">Current milestone</div>
                      <div className="text-[15px] font-semibold">
                        {current.milestone.title} · {formatAmount(current.milestone.amount)} RLUSD
                      </div>
                    </div>
                    <Badge tone={MILESTONE_STATUS[current.milestone.status].tone} dot>
                      {MILESTONE_STATUS[current.milestone.status].label}
                    </Badge>
                  </div>
                  <EscrowPipeline view={current} />
                  {current.milestone.status === "rejected" && current.verdict && <VerdictCard verdict={current.verdict} />}
                  {canUpload ? (
                    <EvidenceUploader
                      projectId={p.id}
                      milestoneId={current.milestone.id}
                      milestoneTitle={current.milestone.title}
                      template={current.template}
                    />
                  ) : (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <VerdictCard verdict={current.verdict} />
                      <ApprovalsPanel view={current} />
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        );
      })}

      <Card>
        <CardHeader>
          <CardTitle>Payouts</CardTitle>
          <BadgeCheck className="size-4 text-faint" />
        </CardHeader>
        <CardContent>
          {dash.payouts.length ? (
            <ul className="divide-y divide-line">
              {dash.payouts.map((e) => (
                <li key={e.txHash} className="flex items-center justify-between py-2.5 text-[13px]">
                  <span className="text-ink-2">
                    {dash.projects.find((x) => x.summary.project.id === e.projectId)?.summary.project.name} ·{" "}
                    {dash.projects.flatMap((x) => x.summary.project.milestones).find((m) => m.id === e.milestoneId)?.title}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="text-faint">{formatDateTime(e.at)}</span>
                    <span className="tabular font-semibold text-ok">+{formatAmount(e.amount ?? "0")} RLUSD</span>
                    <TxLink hash={e.txHash} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">No releases yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
