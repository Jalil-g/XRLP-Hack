import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, MapPin } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { AddressLink, VerifiedBuilderBadge } from "@/components/chain";
import { ChainTimeline } from "@/components/project/chain-timeline";
import { EscrowGuarantee } from "@/components/project/escrow-guarantee";
import { FundingCard } from "@/components/project/funding-card";
import { InvestDialog } from "@/components/project/invest-dialog";
import { MilestoneExplorer } from "@/components/project/milestone-explorer";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, SectionLabel } from "@/components/ui/card";
import { ApiError, getProjectDetail } from "@/lib/api";
import { PROJECT_TYPE, RISK_TIER, projectStatus } from "@/lib/display";
import { getSession } from "@/lib/session";
import type { ProjectDetail } from "@/lib/types";
import { formatAmount, formatBps, fromCents, shortHash, toCents } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ invest?: string }> };

async function load(id: string): Promise<ProjectDetail> {
  try {
    return await getProjectDetail(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  try {
    return { title: (await getProjectDetail(id)).project.name };
  } catch {
    return { title: "Project" };
  }
}

export default async function ProjectPage({ params, searchParams }: Props) {
  const [{ id }, sp, session] = await Promise.all([params, searchParams, getSession()]);
  const detail = await load(id);
  const { project, builder } = detail;
  const status = projectStatus(project);
  const remaining = fromCents(toCents(project.terms.principal) - toCents(detail.funding.raised));
  const milestoneTitles = Object.fromEntries(project.milestones.map((m) => [m.id, m.title]));

  return (
    <div className="space-y-6">
      <AutoRefresh />

      {/* Header */}
      <div>
        <nav className="flex items-center gap-1 text-[13px] text-muted">
          <Link href="/" className="hover:text-ink">
            Marketplace
          </Link>
          <ChevronRight className="size-3.5" />
          <span className="text-ink-2">{project.name}</span>
        </nav>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[28px] leading-tight font-semibold tracking-tight">{project.name}</h1>
              <Badge tone={status.tone} dot>
                {status.label}
              </Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-muted">
              <span className="font-medium text-ink-2">{builder.name}</span>
              {builder.verified && <VerifiedBuilderBadge />}
              <span className="inline-flex items-center gap-1">
                <MapPin className="size-3.5" />
                {project.siteAddress}
              </span>
              <span>{PROJECT_TYPE[project.type]}</span>
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-2">{project.description}</p>
          </div>
          {project.status === "funding" && (
            <InvestDialog
              projectId={project.id}
              projectName={project.name}
              sharePrice={detail.vault.sharePrice}
              remaining={remaining}
              rateBps={project.terms.interestRateBps}
              investor={session.investor}
              defaultOpen={sp.invest === "1"}
            />
          )}
        </div>
      </div>

      {/* Terms */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Term label="Principal" value={`${formatAmount(project.terms.principal)}`} unit="RLUSD" />
        <Term label="Interest rate" value={formatBps(project.terms.interestRateBps)} unit="APR" />
        <Term label="Term" value={`${Math.round(project.terms.termDays / 30.4)}`} unit={`months · paid every ${project.terms.paymentIntervalDays}d`} />
        <Term label="Builder risk" value={RISK_TIER[builder.riskTier].label} unit={`${builder.completedProjects} projects completed`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <FundingCard detail={detail} />
        </div>
        <EscrowGuarantee builderName={builder.name} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-3 lg:col-span-2">
          <div className="flex items-end justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Milestones</h2>
              <p className="text-[13px] text-muted">Each stage is its own escrow. Money moves only when the stage is proven.</p>
            </div>
          </div>
          <MilestoneExplorer views={detail.milestones} />
        </section>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <div>
                <CardTitle>On-chain activity</CardTitle>
                <CardDescription>Every action is an XRPL devnet transaction.</CardDescription>
              </div>
              <span className="relative mt-1.5 flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
            </CardHeader>
            <CardContent className="max-h-[720px] overflow-y-auto">
              <ChainTimeline events={detail.timeline} directory={detail.directory} milestoneTitles={milestoneTitles} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Project accounts</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-[13px]">
                {project.chain.spv && (
                  <AccountRow label="Project account (SPV)" hint="Master key disabled · multisig only">
                    <AddressLink address={project.chain.spv} />
                  </AccountRow>
                )}
                <AccountRow label="Builder payout address" hint={`License ${builder.licenseNumber}`}>
                  <AddressLink address={builder.address} />
                </AccountRow>
                {project.chain.vaultId && (
                  <AccountRow label="Vault">
                    <span className="font-mono text-[12px] text-muted">{shortHash(project.chain.vaultId)}</span>
                  </AccountRow>
                )}
                {project.chain.loanId && (
                  <AccountRow label="Loan">
                    <span className="font-mono text-[12px] text-muted">{shortHash(project.chain.loanId)}</span>
                  </AccountRow>
                )}
              </dl>
              <div className="mt-4 border-t border-line pt-3">
                <SectionLabel className="mb-2">SPV signer list · quorum 3</SectionLabel>
                <ul className="space-y-1 text-[13px] text-ink-2">
                  <li className="flex justify-between">
                    <span>Inspector A / Inspector B</span>
                    <span className="text-muted">weight 2 each</span>
                  </li>
                  <li className="flex justify-between">
                    <span>AI verifier</span>
                    <span className="text-muted">weight 1</span>
                  </li>
                  <li className="flex justify-between">
                    <span>Platform</span>
                    <span className="text-muted">weight 1</span>
                  </li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Term({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tracking-tight">{value}</div>
      <div className="truncate text-xs text-faint">{unit}</div>
    </div>
  );
}

function AccountRow({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <dt className="text-ink-2">{label}</dt>
        {hint && <div className="text-[11.5px] text-faint">{hint}</div>}
      </div>
      <dd className="pt-0.5">{children}</dd>
    </div>
  );
}
