import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { EvidenceUploader } from "@/components/builder/evidence-uploader";
import { EvidenceReceipt } from "@/components/builder/evidence-receipt";
import { TxLink } from "@/components/chain";
import { ChecksPanel } from "@/components/checks/checks-panel";
import { MilestoneTabs } from "@/components/project/milestone-tabs";
import { buttonClass } from "@/components/ui/button";
import { Empty, PageHeader, Section } from "@/components/ui/layout";
import { Tag } from "@/components/ui/tag";
import { api } from "@/lib/api";
import type { Milestone, ProjectDetail } from "@/lib/contract";
import { PROJECT_STATUS, sovLinesFor } from "@/lib/display";
import { MAPLE_FIXTURE_SETS } from "@/lib/fixture-files";
import { getSession } from "@/lib/session";
import { formatAmount, toCents } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Builder" };

export default async function BuilderPage() {
  const session = await getSession();
  const builder = session.builder;
  if (session.directoryUnavailable) throw new Error("Builder accounts are temporarily unavailable. Try loading the workspace again.");
  if (!builder) return <Empty title="No builder accounts">Core did not return any builders.</Empty>;
  const summaries = (await api.listProjects()).filter((s) => (s.builderId ? s.builderId === builder.id : s.builderName === builder.name));
  const details = await Promise.all(summaries.map((s) => api.getProject(s.id)));

  return (
    <div className="space-y-8">
      <AutoRefresh ms={4000} />
      <PageHeader
        action={
          <Link href="/builder/new" className={buttonClass("secondary")}>
            New project
          </Link>
        }
        title={builder.name}
        meta={builder.verified ? <Tag tone="pass">Verified builder</Tag> : <Tag>Not verified yet</Tag>}
        description={
          <>
            Licence {builder.licenseNumber} · {builder.completedProjects} completed projects
            {builder.credentialTx && (
              <>
                {" "}
                · credential <TxLink hash={builder.credentialTx} />
              </>
            )}
          </>
        }
      />

      {details.length === 0 && <Empty title="Your next project starts here" action={<Link href="/builder/new" className={buttonClass()}>Create a project</Link>}>Submit a Schedule of Values, verify the project, then collect evidence for each construction draw.</Empty>}

      {details.map((d) => (
        <BuilderProject key={d.project.id} d={d} />
      ))}
    </div>
  );
}

function BuilderProject({ d }: { d: ProjectDetail }) {
  const { project: p, builder } = d;
  const status = PROJECT_STATUS[p.status];
  const current = p.milestones.find((m) => !["released", "refunded", "pending"].includes(m.status));
  const raised = d.investments.reduce((a, i) => a + toCents(i.amount), 0);

  return (
    <Section
      title={
        <span className="flex flex-wrap items-center gap-3">
          {p.name} <Tag tone={status.tone}>{status.label}</Tag>
        </span>
      }
      aside={
        <Link href={`/projects/${p.id}`} className="text-link hover:underline">
          Project page
        </Link>
      }
    >
      <div className="mb-6 grid gap-6 rounded-[20px] bg-capital p-6 text-capital-text sm:grid-cols-[minmax(0,1fr)_auto] sm:p-8">
        <div className="min-w-0">
          <p className="text-small text-capital-muted">{current ? `${current.title} · scheduled draw` : "Project principal"}</p>
          <p className="mt-2 break-words text-[36px] leading-[1.1] font-semibold tracking-[-0.035em] tabular-nums sm:text-[52px]">{formatAmount(current?.amount ?? p.terms.principal, { cents: true })} <span className="text-body font-medium tracking-normal text-capital-muted">RLUSD</span></p>
          <p className="mt-3 max-w-[65ch] text-small text-capital-muted">{current ? STEP[current.status] ?? (current.status === "failed" ? "A check failed. Review the flagged evidence and resubmit; funds remain locked." : "Follow the milestone below for the next action.") : "Verification comes before funding. Each construction draw has its own evidence requirements."}</p>
        </div>
        <dl className="space-y-3 border-t border-capital-muted/30 pt-4 text-small sm:border-t-0 sm:border-l sm:pt-0 sm:pl-6">
          {p.status === "funding" || p.status === "funded" ? (
            <div><dt className="text-capital-muted">Raised from investors</dt><dd className="mt-1 font-medium tabular-nums">{formatAmount(raised / 100, { cents: true })} RLUSD</dd></div>
          ) : (
            <div><dt className="text-capital-muted">Paid to you</dt><dd className="mt-1 font-medium tabular-nums">{formatAmount(p.milestones.filter((m) => m.status === "released").reduce((a, m) => a + toCents(m.amount), 0) / 100, { cents: true })} RLUSD</dd></div>
          )}
          {current && <div><dt className="text-capital-muted">Project principal</dt><dd className="mt-1 tabular-nums">{formatAmount(p.terms.principal, { cents: true })} RLUSD</dd></div>}
        </dl>
      </div>
      <div className="mb-8">
        <MilestoneTabs milestones={p.milestones} selectedId={current?.id} linked={false} label={`${p.name} milestone schedule`} />
      </div>
      <EvidenceReceipt detail={d} />
      {p.status === "draft" && (
        <NextStep
          title="Pay the verification fee"
          body="250 RLUSD pays for the AI review of your identity, the project's feasibility and your capability, plus an inspector visit if one is needed. In production the fee scales with project size."
          action={<ActionButton context={p.name} action={{ kind: "payFee", projectId: p.id, builder: builder.address }}>Pay 250 RLUSD</ActionButton>}
        />
      )}
      {p.status === "verifying" && (
        <NextStep
          title="Run verification"
          body="The AI checks your licence, insurance and entity (mock registries), whether the Schedule of Values adds up and is priced in range, and your track record."
          action={<ActionButton action={{ kind: "verifyProject", projectId: p.id }}>Run verification</ActionButton>}
        />
      )}
      {(p.status === "funding" || p.status === "funded") && (
        <p className="text-body text-ink-2">
          Raised <span className="tabular text-ink">{formatAmount(raised / 100)}</span> of {formatAmount(p.terms.principal)} RLUSD. Escrows are created when the loan closes.
        </p>
      )}
      {p.status === "verified" && <p className="text-body text-ink-2">Verified. The platform locks terms and assigns your inspector next.</p>}

      {d.verification && (
        <p className="mb-6 flex flex-wrap items-center gap-3 text-small">
          <Tag tone={d.verification.decision === "pass" ? "pass" : d.verification.decision === "fail" ? "fail" : "review"}>
            {d.verification.decision === "pass" ? "Verified" : d.verification.decision === "fail" ? "Rejected" : "Needs an inspector visit"}
          </Tag>
          <span className="text-ink-2">Identity, feasibility and capability checked</span>
          <Link href={`/projects/${p.id}/verification`} className="text-link hover:underline">
            Verification report
          </Link>
        </p>
      )}

      {current && <CurrentMilestone d={d} m={current} />}
      <Payouts d={d} />
    </Section>
  );
}

function Payouts({ d }: { d: ProjectDetail }) {
  const paid = d.project.milestones.filter((m) => m.status === "released");
  if (!paid.length) return null;
  return (
    <div className="mt-8">
      <h4 className="mb-2 text-small font-semibold">Paid to you</h4>
      <ul className="divide-y divide-line border-y border-line">
        {paid.map((m) => (
          <li key={m.id} className="flex items-center justify-between gap-4 py-2.5 text-small">
            <span>
              {m.index + 1}. {m.title}
            </span>
            <span className="flex items-center gap-4">
              <span className="tabular font-medium text-pass">+{formatAmount(m.amount)} RLUSD</span>
              {m.escrow?.finishTx && <TxLink hash={m.escrow.finishTx} label="EscrowFinish" />}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STEP: Partial<Record<Milestone["status"], string>> = {
  escrowed: "Upload the evidence below. Next, the assigned inspector audits the site, then the checks run.",
  evidence_submitted: "Evidence received. The assigned inspector audits it and signs; then run the checks. Without a signed audit the inspector check fails.",
  audited: "The inspector signed the audit. Run the checks: if every one passes, the escrow pays you in seconds.",
  needs_human: "The checks passed below the confidence this milestone needs. The platform operator is reviewing.",
  verified: "All checks passed. The release service is finishing the escrow.",
  expired: "This escrow expired. The money goes back to the project account and is repaid to the vault.",
};

function CurrentMilestone({ d, m }: { d: ProjectDetail; m: Milestone }) {
  const { project: p, builder } = d;
  const checks = d.checks[m.id] ?? { required: [], optional: [], outcome: "pending" as const };
  const failed = [...checks.required, ...checks.optional].filter((c) => c.result === "fail");
  const flaggedNames = new Set((d.evidence?.[m.id] ?? []).filter((e) => failed.some((c) => c.evidenceIds.includes(e.id))).map((e) => e.filename));
  const set = /maple/i.test(p.name) ? MAPLE_FIXTURE_SETS[m.index] : undefined;
  const fixture = set && {
    label: m.status === "failed" ? "Load Maple St fixture without the flagged photo" : "Load Maple St fixture",
    files: set.filter((f) => !flaggedNames.has(f.path.split("/").pop()!)),
  };
  const uploader = ["escrowed", "evidence_submitted", "failed"].includes(m.status) && (
    <EvidenceUploader
      projectId={p.id}
      milestoneId={m.id}
      milestoneTitle={m.title}
      projectName={p.name}
      builderName={builder.name}
      requirements={sovLinesFor(p, m).flatMap((l) => l.evidence)}
      submitLabel={m.status === "failed" ? "Resubmit" : "Upload"}
      fixture={fixture}
    />
  );
  const panel = (
    <ChecksPanel
      key={m.id}
      milestone={m}
      status={checks}
      audits={d.audits[m.id] ?? []}
      attestations={d.attestations[m.id] ?? []}
      builderName={builder.name}
      builderBalance={d.balances?.builder}
      evidence={d.evidence?.[m.id]}
      names={Object.fromEntries(d.inspectors.map((i) => [i.address, i.name]))}
      run={{ projectId: p.id }}
    />
  );
  return (
    <div className="space-y-6 rounded-panel border border-line bg-surface p-4 sm:p-6">
      <div>
        <h3 className="text-body font-semibold">
          Milestone {m.index + 1}: {m.title} · {formatAmount(m.amount)} RLUSD
        </h3>
        <p className="mt-1 max-w-[72ch] text-small text-ink-2">
          {m.status === "failed"
            ? `${failed.length === 1 ? "A check" : `${failed.length} checks`} failed, so the money stays locked. Fix what the red row says, then resubmit: the checks run again on the new evidence.`
            : STEP[m.status]}
        </p>
      </div>
      {m.status === "failed" ? (
        <>
          {panel}
          <h4 className="pt-2 text-body font-semibold">Resubmit evidence</h4>
          {uploader}
        </>
      ) : (
        <>
          {uploader}
          {panel}
        </>
      )}
    </div>
  );
}

function NextStep({ title, body, action }: { title: string; body: string; action: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-6 rounded-panel bg-band px-6 py-5">
      <div className="max-w-[60ch]">
        <p className="text-body font-semibold">{title}</p>
        <p className="mt-1 text-small text-ink-2">{body}</p>
      </div>
      {action}
    </div>
  );
}
