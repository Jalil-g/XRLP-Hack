import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { EvidenceUploader } from "@/components/builder/evidence-uploader";
import { TxLink } from "@/components/chain";
import { ChecksPanel } from "@/components/checks/checks-panel";
import { Empty, PageHeader, Section } from "@/components/ui/layout";
import { Tag } from "@/components/ui/tag";
import { api } from "@/lib/api";
import type { CheckResult, Milestone, ProjectDetail } from "@/lib/contract";
import { PROJECT_STATUS, checkLabel, sovLinesFor } from "@/lib/display";
import { MAPLE_FIXTURE_SETS } from "@/lib/fixture-files";
import { getSession } from "@/lib/session";
import { formatAmount, toCents } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Builder" };

export default async function BuilderPage() {
  const session = await getSession();
  const builder = session.builder;
  if (!builder) return <Empty title="No builder accounts">Core did not return any builders.</Empty>;
  const summaries = (await api.listProjects()).filter((s) => (s.builderId ? s.builderId === builder.id : s.builderName === builder.name));
  const details = await Promise.all(summaries.map((s) => api.getProject(s.id)));

  return (
    <div className="space-y-14">
      <AutoRefresh ms={4000} />
      <PageHeader
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

      {details.length === 0 && <Empty title="No projects yet">Submit a project with its Schedule of Values to get it verified and listed.</Empty>}

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
      {p.status === "draft" && (
        <NextStep
          title="Pay the verification fee"
          body="250 RLUSD pays for the AI review of your identity, the project's feasibility and your capability, plus an inspector visit if one is needed. In production the fee scales with project size."
          action={<ActionButton action={{ kind: "payFee", projectId: p.id, builder: builder.address }}>Pay 250 RLUSD</ActionButton>}
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

      {d.verification && ["verifying", "verified", "rejected"].includes(p.status) && <VerificationReport v={d.verification} />}

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
    <div className="space-y-6">
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

function VerificationReport({ v }: { v: NonNullable<ProjectDetail["verification"]> }) {
  const groups: [string, CheckResult[]][] = [
    ["Identity", v.identity],
    ["Feasibility", v.feasibility],
    ["Capability", v.capability],
  ];
  return (
    <div className="mt-6 grid gap-8 md:grid-cols-3">
      {groups.map(([name, checks]) => (
        <div key={name}>
          <h4 className="text-small font-semibold">{name}</h4>
          <ul className="mt-2 space-y-2">
            {checks.map((c) => (
              <li key={c.check} className="text-small">
                <span className={c.result === "pass" ? "text-pass" : c.result === "fail" ? "text-fail" : "text-review"}>{c.result === "pass" ? "Pass" : c.result === "fail" ? "Fail" : "Review"}</span>{" "}
                <span className="font-medium">{checkLabel(c)}</span>
                <span className="block text-caption text-ink-2">{c.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
