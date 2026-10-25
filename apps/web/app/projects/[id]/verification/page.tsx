// The project verification report (route 5 result): status, the fee action, then identity, feasibility and capability
// findings as hairline rows. Mock sources carry a "Mock" tag per finding; fee and credential txs live in Proof.
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/action-button";
import { TxLink } from "@/components/chain";
import { Proof } from "@/components/checks/proof";
import { ROW_GRID, StatusIcon, type RowState } from "@/components/checks/status-icon";
import { Tag } from "@/components/ui/tag";
import { ApiError, api } from "@/lib/api";
import type { CheckResult, ProjectDetail } from "@/lib/contract";
import { RISK_TIER, checkLabel } from "@/lib/display";
import { cn, formatAmount, formatDateTime } from "@/lib/utils";

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
const ORDER: Record<CheckResult["result"], number> = { fail: 0, warn: 1, pass: 2, skipped: 3 };

/** Verification's three groups. Check names come only from a real run (they differ between the mock and the verifier). */
const GROUPS = ["Identity", "Feasibility", "Capability"] as const;

export default async function VerificationPage({ params }: Props) {
  const { id } = await params;
  const d = await load(id);
  const { project: p, builder, verification: v } = d;
  const fee = d.events.find((e) => e.kind === "verification_fee_paid");
  const issued = d.events.find((e) => e.kind === "credential_issued");
  const accepted = d.events.find((e) => e.kind === "credential_accepted");
  const findings = v ? [...v.identity, ...v.feasibility, ...v.capability] : [];
  const passed = findings.filter((c) => c.result === "pass").length;

  const banner: { icon: RowState; title: string; tone?: string } = v
    ? v.decision === "pass"
      ? { icon: "pass", title: "Verified" }
      : v.decision === "fail"
        ? { icon: "fail", title: "Rejected", tone: "bg-fail-bg" }
        : { icon: "warn", title: "Site visit assigned", tone: "bg-review-bg" }
    : { icon: "queued", title: p.status === "verifying" ? "Fee paid" : "Not verified" };
  const action = !v && (
    <>
      {p.status === "draft" && (
        <ActionButton size="lg" context={p.name} action={{ kind: "payFee", projectId: p.id, builder: builder.address }}>
          Pay 250 RLUSD
        </ActionButton>
      )}
      {p.status === "verifying" && (
        <ActionButton size="lg" action={{ kind: "verifyProject", projectId: p.id }}>
          Run verification
        </ActionButton>
      )}
    </>
  );

  const facts = [
    { label: "Requested", value: `${formatAmount(p.terms.principal)} RLUSD` },
    { label: "Builder", value: builder.name },
    ...(v ? [{ label: "Risk", value: RISK_TIER[v.riskTier] }, { label: "Passed", value: `${passed} of ${findings.length}` }] : []),
    { label: "Fee", value: fee ? `${formatAmount(fee.amount ?? "250")} paid` : "Not paid" },
  ];

  const groups = GROUPS.map((title) => ({
    title,
    checks: v ? { Identity: v.identity, Feasibility: v.feasibility, Capability: v.capability }[title] : undefined,
  }));

  return (
    <div className="space-y-10">
      <header>
        <Link href={`/projects/${p.id}`} className="text-small font-medium text-ink-3 hover:text-ink">
          {p.name}
        </Link>
        <h1 className="mt-1 text-[28px] leading-9 font-semibold tracking-[-0.025em]">Verification</h1>
      </header>

      <dl className="flex flex-wrap gap-x-12 gap-y-4">
        {facts.map((f) => (
          <div key={f.label} className="flex flex-col-reverse">
            <dt className="mt-0.5 text-caption text-ink-2">{f.label}</dt>
            <dd className="text-body font-semibold tabular-nums">{f.value}</dd>
          </div>
        ))}
      </dl>

      <section aria-label="Verification findings" className="overflow-hidden rounded-panel border border-line bg-surface">
        <div className={cn("flex min-h-[72px] flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-line px-5 py-3.5", banner.tone)}>
          <div className="flex items-center gap-3">
            <StatusIcon state={banner.icon} className="size-6" />
            <h2 className="text-[19px] leading-7 font-semibold tracking-[-0.01em] text-ink">{banner.title}</h2>
          </div>
          {action}
        </div>

        {groups.map((g) => {
          const failed = g.checks?.filter((c) => c.result === "fail").length ?? 0;
          const passedHere = g.checks?.filter((c) => c.result === "pass").length ?? 0;
          return (
            <section key={g.title} aria-label={g.title} className="border-b border-line last:border-b-0">
              <h3 className="flex items-baseline justify-between gap-4 bg-band px-5 py-2 text-small font-semibold text-ink">
                {g.title}
                <span className={cn("text-caption font-medium tabular-nums", failed ? "text-fail" : "text-ink-2")}>
                  {!g.checks ? "Not run" : failed ? `${failed} failed` : `${passedHere} of ${g.checks.length} passed`}
                </span>
              </h3>
              {g.checks && (
                <ul className="divide-y divide-line">
                  {[...g.checks]
                    .map((c, i) => ({ c, i }))
                    .sort((a, b) => ORDER[a.c.result] - ORDER[b.c.result] || a.i - b.i)
                    .map(({ c }) => <Finding key={c.check} check={c} />)}
                </ul>
              )}
            </section>
          );
        })}

        <Proof
          className="border-t border-line px-5"
          items={[
            { label: "Fee payment", value: fee && <TxLink hash={fee.txHash} /> },
            { label: "Credential", value: builder.verified ? "VERIFIED_BUILDER" : undefined },
            { label: "Issued", value: issued ? <TxLink hash={issued.txHash} /> : builder.credentialTx && <TxLink hash={builder.credentialTx} /> },
            { label: "Accepted", value: accepted && <TxLink hash={accepted.txHash} /> },
            { label: "Model", value: v && (v.model === "mock" ? "Mock verifier" : v.model) },
            { label: "Ran", value: v && formatDateTime(v.createdAt) },
          ]}
        />
      </section>
    </div>
  );
}

function Finding({ check: c }: { check: CheckResult }) {
  const mock = MOCK.exec(c.reason)?.[1];
  const reason = c.reason.replace(MOCK, "").replace(/^;\s*/, "");
  const loud = c.result === "fail" || c.result === "warn";
  return (
    <li className={cn(ROW_GRID, c.result === "fail" && "bg-fail-bg/60", c.result === "warn" && "bg-review-bg/60")}>
      <StatusIcon state={c.result} />
      <span className="text-body font-medium text-ink">{checkLabel(c)}</span>
      <span title={loud ? undefined : reason} className={cn("text-small", loud ? (c.result === "fail" ? "font-medium text-fail" : "font-medium text-review") : "truncate text-ink-3")}>
        {reason}
      </span>
      <span>
        {mock && (
          <Tag className="h-5 px-1.5 text-[11px]" title={mock}>
            Mock
          </Tag>
        )}
      </span>
    </li>
  );
}
