// The project verification report (route 5 result): identity, feasibility, capability, with the fee and credential txs.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { TxLink } from "@/components/chain";
import { StatusIcon } from "@/components/checks/status-icon";
import { PageHeader } from "@/components/ui/layout";
import { Tag } from "@/components/ui/tag";
import { ApiError, api } from "@/lib/api";
import type { CheckResult, ProjectDetail } from "@/lib/contract";
import { RISK_TIER, checkLabel } from "@/lib/display";
import { formatAmount, formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Verification report" };

type Props = { params: Promise<{ id: string }> };

async function load(id: string): Promise<ProjectDetail> {
  try {
    return await api.getProject(id);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) notFound();
    throw err;
  }
}

const MOCK = /\s*\((MOCK[^)]*)\)/;

export default async function VerificationPage({ params }: Props) {
  const { id } = await params;
  const d = await load(id);
  const { project: p, builder, verification: v } = d;
  const fee = d.events.find((e) => e.kind === "verification_fee_paid");
  const issued = d.events.find((e) => e.kind === "credential_issued");
  const accepted = d.events.find((e) => e.kind === "credential_accepted");
  const decision = v ? ({ pass: { tone: "pass", label: "Verified" }, fail: { tone: "fail", label: "Rejected" }, needs_human: { tone: "review", label: "Needs an inspector visit" } } as const)[v.decision] : undefined;

  return (
    <div className="space-y-8">
      <div>
        <nav className="flex gap-2 text-caption text-ink-2">
          <Link href="/" className="hover:text-ink">
            Projects
          </Link>
          <span aria-hidden>/</span>
          <Link href={`/projects/${p.id}`} className="hover:text-ink">
            {p.name}
          </Link>
        </nav>
        <PageHeader
          className="mt-2"
          title="Verification report"
          meta={decision && <Tag tone={decision.tone}>{decision.label}</Tag>}
        />
      </div>

      <section className="finance-surface grid gap-6 sm:grid-cols-[minmax(0,1fr)_auto] sm:p-8" aria-label="Project verification summary">
        <div><h2 className="text-heading">{p.name}</h2><p className="mt-2 text-body text-ink-2">{builder.name}</p><p className="mt-5 max-w-[65ch] text-small text-ink-2">{v ? "Read the findings below before moving to the next stage. Project verification is not approval of a milestone draw." : "Verification has not run. Pay the fee, then review the identity, feasibility and capability findings here."}</p></div>
        <div className="border-t border-line pt-4 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-8"><p className="text-small text-ink-2">Requested financing</p><p className="mt-2 break-words text-[36px] leading-tight font-semibold tracking-[-0.035em] tabular-nums">{formatAmount(p.terms.principal)}</p><p className="mt-1 text-small text-ink-2">RLUSD · {decision?.label ?? "Awaiting verification"}</p></div>
        <dl className="grid gap-x-10 gap-y-5 border-t border-line pt-6 sm:col-span-2 sm:grid-cols-3">
        <Fact
          label="Verification fee"
          value={fee ? `${formatAmount(fee.amount ?? "250")} RLUSD paid by ${builder.name}` : "Not paid yet"}
          note={fee ? <TxLink hash={fee.txHash} label="Payment" /> : "250 RLUSD in the demo; scales with project size in production"}
        />
        <Fact
          label="Builder credential"
          value={builder.verified ? "VERIFIED_BUILDER" : "Not issued"}
          note={
            issued || accepted ? (
              <span className="flex gap-3">
                {issued && <TxLink hash={issued.txHash} label="CredentialCreate" />}
                {accepted && <TxLink hash={accepted.txHash} label="CredentialAccept" />}
              </span>
            ) : builder.credentialTx ? (
              <TxLink hash={builder.credentialTx} label="CredentialCreate" />
            ) : (
              "Issued on the builder's first verified project"
            )
          }
        />
        <Fact
          label="Risk tier"
          value={v ? RISK_TIER[v.riskTier] : "Set by verification"}
          note={v ? `${v.model === "mock" ? "Mock verifier" : v.model} · ${formatDateTime(v.createdAt)}` : undefined}
        />
      </dl>
      </section>

      {v?.decision === "needs_human" && (
        <p className="rounded-panel bg-review-bg px-5 py-4 text-small text-ink">
          <span className="font-semibold text-review">An inspector pre-construction visit is assigned.</span> Their signed site report goes back to the AI, which then
          finishes the verification.
        </p>
      )}

      {v ? (
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(240px,1fr)]">
          <div className="space-y-6">
          <Group title="Identity" note="Licence, insurance, entity" checks={v.identity} />
          <Group title="Feasibility" note="Schedule of Values, permits, site" checks={v.feasibility} />
          <Group title="Capability" note="Track record and workload" checks={v.capability} />
          </div>
          <aside className="space-y-4 rounded-panel bg-band p-6">
            <h2 className="text-heading">What happens next</h2>
            <p className="text-small text-ink-2">{v.decision === "pass" ? "The platform locks the project terms and assigns an inspector before funding. Every milestone will still need evidence and a signed audit." : v.decision === "fail" ? "Review the failed findings with the platform. This report does not approve the project for funding." : "The assigned inspector completes a pre-construction visit. Their signed report returns to the verifier for a final decision."}</p>
            <Link href={`/projects/${p.id}`} className="inline-flex min-h-11 items-center text-small font-medium text-link underline underline-offset-4">Return to project</Link>
            <p className="border-t border-line pt-4 text-caption text-ink-2">Registry, cost-table and KYC checks use mock sources in this prototype. A mock finding is not a real-world certification.</p>
          </aside>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-6 rounded-panel bg-band px-6 py-5">
          <p className="max-w-[60ch] text-small text-ink-2">No verification yet. The builder pays the fee, then the AI runs the report.</p>
          {p.status === "draft" && <ActionButton context={p.name} action={{ kind: "payFee", projectId: p.id, builder: builder.address }}>Pay 250 RLUSD</ActionButton>}
          {p.status === "verifying" && <ActionButton action={{ kind: "verifyProject", projectId: p.id }}>Run verification</ActionButton>}
        </div>
      )}

      <p className="text-caption text-ink-2">Registries, cost tables and KYC are mocks in this prototype and are labelled where they are used.</p>
    </div>
  );
}

function Group({ title, note, checks }: { title: string; note: string; checks: CheckResult[] }) {
  const failed = checks.filter((c) => c.result === "fail").length;
  return (
    <section className="overflow-hidden rounded-panel border border-line bg-surface">
      <header className="flex items-baseline justify-between gap-4 border-b border-line bg-band px-5 py-3">
        <h2 className="text-body font-semibold">{title}</h2>
        <span className="text-caption text-ink-2">{failed ? `${failed} failed` : `${checks.length} passed`}</span>
      </header>
      <p className="px-5 pt-3 text-caption text-ink-2">{note}</p>
      <ul className="divide-y divide-line">
        {checks.map((c) => {
          const mock = MOCK.exec(c.reason)?.[1];
          return (
            <li key={c.check} className="flex gap-3 px-5 py-3">
              <StatusIcon state={c.result} className="mt-0.5" />
              <div className="min-w-0">
                <p className="text-small font-medium text-ink">
                  {checkLabel(c)}
                  {mock && (
                    <Tag className="ml-2 h-5 px-1.5 align-middle" title={mock}>
                      Mock
                    </Tag>
                  )}
                </p>
                <p className="text-small text-ink-2">{c.reason.replace(MOCK, "").replace(/^;\s*/, "")}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Fact({ label, value, note }: { label: string; value: string; note?: React.ReactNode }) {
  return (
    <div>
      <dt className="text-caption text-ink-2">{label}</dt>
      <dd className="mt-0.5 text-small font-medium text-ink">{value}</dd>
      {note && <dd className="mt-0.5 text-caption text-ink-2">{note}</dd>}
    </div>
  );
}
