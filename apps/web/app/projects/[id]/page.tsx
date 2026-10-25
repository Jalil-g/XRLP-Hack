import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { Address, TxLink } from "@/components/chain";
import { ChecksPanel } from "@/components/checks/checks-panel";
import { Activity } from "@/components/project/activity";
import { EvidenceStrip } from "@/components/project/evidence-strip";
import { InvestDialog } from "@/components/project/invest-dialog";
import { MilestoneTabs } from "@/components/project/milestone-tabs";
import { ProjectHero } from "@/components/project/project-hero";
import { ReleaseStage } from "@/components/project/release-stage";
import { SovTable } from "@/components/project/sov-table";
import { Proof } from "@/components/checks/proof";
import { Properties, Section } from "@/components/ui/layout";
import { Tag } from "@/components/ui/tag";
import { ApiError, api } from "@/lib/api";
import { LOCKED_MILESTONE_V2 } from "@xrlp/shared";
import type { Milestone, ProjectDetail } from "@/lib/contract";
import { PROJECT_STATUS, VAULT_PHASE, focusMilestone, namer } from "@/lib/display";
import { getSession } from "@/lib/session";
import { formatAmount, formatBps, formatDate, fromCents, toCents } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ m?: string }> };

async function load(id: string): Promise<ProjectDetail> {
  try {
    return await api.getProject(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  try {
    return { title: (await api.getProject(id)).project.name };
  } catch {
    return { title: "Project" };
  }
}

export default async function ProjectPage({ params, searchParams }: Props) {
  const [{ id }, { m: selectedId }, session] = await Promise.all([params, searchParams, getSession()]);
  const d = await load(id);
  const { project: p, builder } = d;
  const who = namer(session.parties);
  const names = Object.fromEntries([...session.parties, ...d.inspectors].map((x) => [x.address, x.name]));
  const title = (mid?: string) => p.milestones.find((m) => m.id === mid)?.title ?? "a milestone";
  const selected = p.milestones.find((m) => m.id === selectedId) ?? focusMilestone(p.milestones);
  const raised = d.investments.reduce((a, i) => a + toCents(i.amount), 0);
  const sum = (statuses: Milestone["status"][]) => p.milestones.filter((m) => statuses.includes(m.status)).reduce((a, m) => a + toCents(m.amount), 0);
  const status = PROJECT_STATUS[p.status];
  const checks = (selected && d.checks[selected.id]) ?? { required: [], optional: [], outcome: "pending" as const };
  const audits = (selected && d.audits[selected.id]) ?? [];

  const loanFacts = [
    { label: "Rate", value: formatBps(p.terms.interestRateBps) },
    { label: "Term", value: `${Math.round(p.terms.termDays / 30.4)} months` },
    ...(p.status === "funding"
      ? [{ label: "Closes", value: formatDate(p.terms.fundingDeadline) }]
      : [{ label: "Released", value: `${p.milestones.filter((m) => m.status === "released").length} of ${p.milestones.length}` }]),
    { label: "Builder", value: builder.name },
  ];

  return (
    <div>
      <AutoRefresh ms={3000} />

      <ReleaseStage>
        <div className="space-y-8">
          <header>
            <Link href="/" className="text-small font-medium text-ink-3 hover:text-ink">
              Projects
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <h1 className="text-[28px] leading-9 font-semibold tracking-[-0.025em]">{p.name}</h1>
              <Tag tone={status.tone}>{status.label}</Tag>
            </div>
          </header>

          <ProjectHero
            money={
              p.status === "funding"
                ? { mode: "funding", raisedCents: raised, targetCents: toCents(p.terms.principal) }
                : {
                    mode: "loan",
                    principalCents: toCents(p.terms.principal),
                    releasedCents: sum(["released"]),
                    escrowCents: sum([...LOCKED_MILESTONE_V2]),
                    returnedCents: sum(["refunded"]),
                    pendingCents: sum(["pending"]),
                  }
            }
            facts={loanFacts}
            action={
              p.status === "funding" && session.investor ? (
                <InvestDialog
                  projectId={p.id}
                  projectName={p.name}
                  remaining={fromCents(toCents(p.terms.principal) - raised)}
                  rateBps={p.terms.interestRateBps}
                  investor={session.investor}
                  redemptionDate={d.vault?.redemptionDate}
                />
              ) : undefined
            }
          />

          <section className="space-y-4" aria-label="Milestone checks">
            <MilestoneTabs milestones={p.milestones} selectedId={selected?.id} />
            {selected && (
              <div className="space-y-6">
                <ChecksPanel
                  key={selected.id}
                  milestone={selected}
                  status={checks}
                  audits={audits}
                  attestations={d.attestations[selected.id] ?? []}
                  builderName={builder.name}
                  evidence={d.evidence?.[selected.id]}
                  names={names}
                  run={{ projectId: p.id, pinHref: `?m=${encodeURIComponent(selected.id)}` }}
                />
                <EvidenceStrip evidence={d.evidence?.[selected.id] ?? []} audit={audits[audits.length - 1]} results={[...checks.required, ...checks.optional]} />
              </div>
            )}
          </section>
        </div>
      </ReleaseStage>

      <div className="mt-20 grid gap-x-14 gap-y-12 md:grid-cols-3">
        <Section title="Loan">
          <Properties
            labelWidth={120}
            items={
              d.loan
                ? [
                    { label: "Still owed", value: <Num>{formatAmount(d.loan.totalValueOutstanding)}</Num> },
                    { label: "Principal left", value: <Num>{formatAmount(d.loan.principalOutstanding)}</Num> },
                    { label: "Next payment", value: <Num>{formatAmount(d.loan.periodicPayment)}</Num> },
                    { label: "Due", value: formatDate(d.loan.nextPaymentDueDate) },
                    { label: "Payments left", value: <Num>{d.loan.paymentRemaining}</Num> },
                  ]
                : [
                    { label: "Principal", value: <Num>{formatAmount(p.terms.principal)}</Num> },
                    { label: "Status", value: "Not closed" },
                    { label: "Closes", value: formatDate(p.terms.fundingDeadline) },
                  ]
            }
          />
        </Section>

        <Section title="Vault">
          {d.vault ? (
            <Properties
              labelWidth={120}
              items={[
                { label: "Phase", value: VAULT_PHASE[d.vault.phase] },
                { label: "Investors", value: <Num>{new Set(d.investments.map((i) => i.investor)).size}</Num> },
                { label: "Share price", value: <Num>{Number(d.vault.sharePrice).toFixed(4)}</Num> },
                { label: "Available", value: <Num>{formatAmount(d.vault.assetsAvailable)}</Num> },
                { label: "Withdrawals", value: d.vault.phase === "redemption" ? "Open" : `From ${formatDate(d.vault.redemptionDate)}` },
              ]}
            />
          ) : (
            <p className="text-small text-ink-2">Opens when terms lock.</p>
          )}
        </Section>

        <Section title="Project account">
          <Properties
            labelWidth={120}
            items={[
              { label: "Signers", value: "3 of 4" },
              { label: "Inspector", value: d.inspectors.length ? d.inspectors.map((i) => i.name).join(", ") : "Not assigned" },
              { label: "Holds", value: <Num>{formatAmount(d.balances?.spv ?? "0")}</Num> },
            ]}
          />
          <Proof
            className="mt-1"
            items={[
              { label: "Account", value: p.chain.spv && <Address address={p.chain.spv} /> },
              { label: "Master key", value: p.chain.spv && "Disabled" },
              { label: "Signer set", value: "Platform, builder, inspector, trustee" },
              { label: "Loan", value: p.chain.loanId && <span className="font-mono text-[12px] break-all">{p.chain.loanId}</span> },
            ]}
          />
        </Section>
      </div>

      {(p.sov?.length ?? 0) > 0 && (
        <Section title="Schedule of Values" className="mt-16">
          <SovTable sov={p.sov ?? []} milestones={p.milestones} selectedId={selected?.id} />
        </Section>
      )}

      <div className="mt-16 grid gap-x-14 gap-y-12 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Section title="Activity">
          <Activity events={d.events} who={who} builderName={builder.name} milestoneTitle={title} limit={10} />
        </Section>
        <Section title="Builder">
          <Properties
            labelWidth={120}
            items={[
              { label: "Name", value: builder.name },
              { label: "Status", value: builder.verified ? <span className="font-medium text-pass">Verified</span> : "Not verified" },
              { label: "Licence", value: builder.licenseNumber },
              { label: "Completed", value: <Num>{`${builder.completedProjects} projects`}</Num> },
              {
                label: "Report",
                value: d.verification ? (
                  <Link href={`/projects/${p.id}/verification`} className="font-medium text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink">
                    {d.verification.decision === "pass" ? "Verified" : d.verification.decision === "fail" ? "Rejected" : "Needs a visit"}
                  </Link>
                ) : (
                  "Not verified"
                ),
              },
            ]}
          />
          <Proof className="mt-1" items={[{ label: "Credential", value: builder.credentialTx && <TxLink hash={builder.credentialTx} /> }]} />
        </Section>
      </div>
    </div>
  );
}

function Num({ children }: { children: React.ReactNode }) {
  return <span className="tabular-nums">{children}</span>;
}
