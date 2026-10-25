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
import { SovTable } from "@/components/project/sov-table";
import { PageHeader, Properties, Section } from "@/components/ui/layout";
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

  return (
    <div className="space-y-10">
      <AutoRefresh ms={3000} />

      <div>
        <Link href="/" className="text-caption text-ink-2 hover:text-ink">
          Projects
        </Link>
        <PageHeader
          className="mt-2"
          title={p.name}
          meta={<Tag tone={status.tone}>{status.label}</Tag>}
          description={`${builder.name} · ${p.siteAddress}`}
          action={
            p.status === "funding" && session.investor ? (
              <InvestDialog
                projectId={p.id}
                projectName={p.name}
                remaining={fromCents(toCents(p.terms.principal) - raised)}
                rateBps={p.terms.interestRateBps}
                investor={session.investor}
              />
            ) : undefined
          }
        />
      </div>

      <section className="space-y-5">
        <MilestoneTabs milestones={p.milestones} selectedId={selected?.id} />
        {selected && (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 text-caption text-ink-2">
              <span>
                Pays for SoV {(selected.sovCodes ?? []).join(", ") || "n/a"}
                {selected.cancelAfter && ` · escrow expires ${formatDate(selected.cancelAfter)}, then the money can only go back`}
              </span>
              {selected.escrow && (
                <span>
                  EscrowCreate <TxLink hash={selected.escrow.createTx} />
                </span>
              )}
            </div>
            <ChecksPanel
              key={selected.id}
              milestone={selected}
              status={checks}
              audits={audits}
              attestations={d.attestations[selected.id] ?? []}
              builderName={builder.name}
              builderBalance={d.balances?.builder}
              evidence={d.evidence?.[selected.id]}
              names={names}
              run={{ projectId: p.id, pinHref: `?m=${encodeURIComponent(selected.id)}` }}
            />
            <EvidenceStrip evidence={d.evidence?.[selected.id] ?? []} audit={audits[audits.length - 1]} results={[...checks.required, ...checks.optional]} />
          </>
        )}
      </section>

      <div className="grid gap-12 border-t border-line pt-10 md:grid-cols-3">
        <Section title="Loan">
          <Properties
            labelWidth={124}
            items={[
              { label: "Principal", value: <Val main={`${formatAmount(p.terms.principal)} RLUSD`} note={`${formatBps(p.terms.interestRateBps)} a year · ${Math.round(p.terms.termDays / 30.4)} months`} /> },
              ...(d.loan
                ? [
                    { label: "Still owed", value: <Val main={`${formatAmount(d.loan.totalValueOutstanding)} RLUSD`} note={`${formatAmount(d.loan.principalOutstanding)} principal`} /> },
                    { label: "Payments", value: <Val main={`${formatAmount(d.loan.periodicPayment)} RLUSD`} note={`${d.loan.paymentRemaining} left · next ${formatDate(d.loan.nextPaymentDueDate)}`} /> },
                  ]
                : [{ label: "Status", value: <Val main="Not closed yet" note={`Closes after funding ends ${formatDate(p.terms.fundingDeadline)}`} /> }]),
            ]}
          />
        </Section>

        <Section title="Vault">
          {d.vault ? (
            <Properties
              labelWidth={124}
              items={[
                { label: "Phase", value: <Val main={VAULT_PHASE[d.vault.phase]} note={`${formatAmount(raised / 100)} RLUSD from ${new Set(d.investments.map((i) => i.investor)).size} investors`} /> },
                { label: "Share price", value: <span title="Devnet vaults are cash basis: assets stay at principal when the loan closes, and the interest in each repayment raises the share price."><Val main={`${Number(d.vault.sharePrice).toFixed(4)} RLUSD`} note="Rises as interest is repaid" /></span> },
                { label: "Available", value: <Val main={`${formatAmount(d.vault.assetsAvailable)} RLUSD`} note="Repayments and refunds land here" /> },
                { label: "Withdrawals", value: <Val main={d.vault.phase === "redemption" ? "Open" : `From ${formatDate(d.vault.redemptionDate)}`} note="Vault RedemptionDate" /> },
              ]}
            />
          ) : (
            <p className="text-small text-ink-2">Opens when the platform locks terms.</p>
          )}
        </Section>

        <Section title="Project account">
          <Properties
            labelWidth={124}
            items={[
              ...(p.chain.spv ? [{ label: "Account", value: <Val main={<Address address={p.chain.spv} />} note="Master key disabled" /> }] : []),
              { label: "Signers", value: <Val main="3 of 4 needed" note="Platform, builder, inspector, trustee" /> },
              { label: "Releases", value: <Val main="Decided by the checks" note="Escrows pay the builder or go back" /> },
              ...(d.balances ? [{ label: "Builder balance", value: <Val main={`${formatAmount(d.balances.builder)} RLUSD`} note={builder.name} /> }] : []),
            ]}
          />
        </Section>
      </div>

      {(p.sov?.length ?? 0) > 0 && (
        <Section title="Schedule of Values" aside="AIA G703 lines; each milestone escrow pays for its lines only">
          <SovTable sov={p.sov ?? []} milestones={p.milestones} selectedId={selected?.id} />
        </Section>
      )}

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Section title="Activity" aside="Every line is an XRPL transaction">
          <Activity events={d.events} who={who} milestoneTitle={title} limit={14} />
        </Section>
        <aside className="space-y-10">
          {p.chain.loanId && (
            <Section title="Where the money is">
              <Properties
                labelWidth={140}
                items={[
                  { label: "Locked in escrow", value: <span className="tabular">{formatAmount(fromCents(sum(LOCKED_MILESTONE_V2 as Milestone["status"][])))} RLUSD</span> },
                  { label: "Released", value: <span className="tabular">{formatAmount(fromCents(sum(["released"])))} RLUSD</span> },
                  { label: "Returned", value: <span className="tabular">{formatAmount(fromCents(sum(["refunded"])))} RLUSD</span> },
                ]}
              />
            </Section>
          )}
          <Section title="Builder">
            <Properties
              labelWidth={140}
              items={[
                { label: "Name", value: builder.name },
                { label: "Credential", value: builder.verified ? <Val main={<span className="text-pass">VERIFIED_BUILDER</span>} note={builder.credentialTx ? <TxLink hash={builder.credentialTx} /> : undefined} /> : "Not verified" },
                { label: "Licence", value: builder.licenseNumber },
                { label: "Track record", value: `${builder.completedProjects} completed projects` },
              ]}
            />
          </Section>
        </aside>
      </div>
    </div>
  );
}

function Val({ main, note }: { main: React.ReactNode; note?: React.ReactNode }) {
  return (
    <>
      <span className="tabular text-ink">{main}</span>
      {note && <span className="block text-caption text-ink-2">{note}</span>}
    </>
  );
}
