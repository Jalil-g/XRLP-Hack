import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AutoRefresh } from "@/components/auto-refresh";
import { Address, TxLink } from "@/components/chain";
import { ChecksPanel } from "@/components/checks/checks-panel";
import { Activity } from "@/components/project/activity";
import { InvestDialog } from "@/components/project/invest-dialog";
import { MilestoneTabs } from "@/components/project/milestone-tabs";
import { PageHeader, Properties, Section } from "@/components/ui/layout";
import { Tag } from "@/components/ui/tag";
import { ApiError, api } from "@/lib/api";
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

const LOCKED: Milestone["status"][] = ["escrowed", "evidence_submitted", "audited", "verified", "failed", "needs_human", "expired"];

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
                SoV {(selected.sovCodes ?? []).join(", ") || "n/a"}
                {selected.cancelAfter && ` · escrow expires ${formatDate(selected.cancelAfter)}`}
              </span>
              {selected.escrow && (
                <span>
                  Escrow <TxLink hash={selected.escrow.createTx} />
                </span>
              )}
            </div>
            <ChecksPanel
              milestone={selected}
              status={d.checks[selected.id] ?? { required: [], optional: [], outcome: "pending" }}
              audits={d.audits[selected.id] ?? []}
              attestations={d.attestations[selected.id] ?? []}
              builderName={builder.name}
              evidence={d.evidence?.[selected.id]}
              names={names}
              run={{ projectId: p.id, pinHref: `?m=${encodeURIComponent(selected.id)}` }}
            />
          </>
        )}
      </section>

      <dl className="flex flex-wrap gap-x-10 gap-y-3 border-y border-line py-4">
        <Fact label="Principal" value={`${formatAmount(p.terms.principal)} RLUSD`} />
        <Fact label="Rate" value={`${formatBps(p.terms.interestRateBps)} a year`} />
        <Fact label="Term" value={`${Math.round(p.terms.termDays / 30.4)} months`} />
        <Fact label="Inspector" value={d.inspectors.map((i) => i.name).join(", ") || "Assigned when terms lock"} />
        {d.vault && (
          <Fact
            label="Vault share price"
            value={`${Number(d.vault.sharePrice).toFixed(4)} RLUSD`}
            title="Booked when the loan closes (LoanSet): contracted interest, net of fees. Repayments add liquidity, not value."
          />
        )}
        {d.balances && p.chain.loanId && <Fact label="Builder balance" value={`${formatAmount(d.balances.builder)} RLUSD`} />}
      </dl>

      <div className="grid gap-12 pt-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Section title="Activity" aside="Every line is an XRPL transaction">
          <Activity events={d.events} who={who} milestoneTitle={title} limit={12} />
        </Section>

        <aside className="space-y-10">
          {p.chain.loanId && (
            <Section title="Where the money is">
              <Properties
                labelWidth={140}
                items={[
                  { label: "Locked in escrow", value: <span className="tabular">{formatAmount(fromCents(sum(LOCKED)))} RLUSD</span> },
                  { label: "Released", value: <span className="tabular">{formatAmount(fromCents(sum(["released"])))} RLUSD</span> },
                  { label: "Returned", value: <span className="tabular">{formatAmount(fromCents(sum(["refunded"])))} RLUSD</span> },
                  ...(d.vault ? [{ label: "Vault available", value: <span className="tabular">{formatAmount(d.vault.assetsAvailable)} RLUSD</span> }] : []),
                ]}
              />
            </Section>
          )}
          <Section title="Accounts">
            <Properties
              labelWidth={140}
              items={[
                {
                  label: "Builder",
                  value: (
                    <>
                      {builder.name}
                      {builder.verified && <span className="block text-caption text-pass">Verified builder</span>}
                      {builder.credentialTx && <TxLink hash={builder.credentialTx} />}
                    </>
                  ),
                },
                ...(p.chain.spv ? [{ label: "Project account", value: <><Address address={p.chain.spv} /><span className="block text-caption text-ink-2">3 of 4 signers; master key off</span></> }] : []),
                ...(d.vault ? [{ label: "Vault", value: <>{VAULT_PHASE[d.vault.phase]}<span className="block text-caption text-ink-2">Withdrawals from {formatDate(d.vault.redemptionDate)}</span></> }] : []),
              ]}
            />
          </Section>
        </aside>
      </div>
    </div>
  );
}

function Fact({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div title={title}>
      <dt className="text-caption text-ink-2">{label}</dt>
      <dd className="tabular mt-0.5 text-small font-medium text-ink">{value}</dd>
    </div>
  );
}
