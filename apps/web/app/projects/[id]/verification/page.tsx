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
    <div className="space-y-7">
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
          description={v ? v.summary : `${builder.name} pays a verification fee, then the AI checks identity, feasibility and capability.`}
        />
      </div>

      <dl className="surface surface-pad grid gap-x-8 gap-y-5 sm:grid-cols-3">
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

      {v?.decision === "needs_human" && (
        <p className="rounded-panel bg-review-bg px-5 py-4 text-small text-ink">
          <span className="font-semibold text-review">An inspector pre-construction visit is assigned.</span> Their signed site report goes back to the AI, which then
          finishes the verification.
        </p>
      )}

      {v ? (
        <div className="space-y-3">
          <Group title="Identity" note="Licence, insurance, entity" checks={v.identity} />
          <Group title="Feasibility" note="Schedule of Values, permits, site" checks={v.feasibility} />
          <Group title="Capability" note="Track record and workload" checks={v.capability} />
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
    <details className="disclosure" open={failed > 0 ? true : undefined}>
      <summary>
        <div><h2 className="text-small font-semibold">{title}</h2><p className="mt-1 text-caption font-normal text-ink-2">{note}</p></div>
        <span className="text-caption text-ink-2">{failed ? `${failed} failed` : `${checks.filter((c) => c.result === "pass").length} passed`}</span>
      </summary>
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
                    <Tag className="ml-2 h-5 px-1.5 align-middle text-[11px]" title={mock}>
                      MOCK
                    </Tag>
                  )}
                </p>
                <p className="text-small text-ink-2">{c.reason.replace(MOCK, "").replace(/^;\s*/, "")}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </details>
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
