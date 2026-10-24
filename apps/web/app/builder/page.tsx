import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { EvidenceUploader } from "@/components/builder/evidence-uploader";
import { TxLink } from "@/components/chain";
import { ChecksPanel } from "@/components/checks/checks-panel";
import { Empty, PageHeader, Section } from "@/components/ui/layout";
import { Tag } from "@/components/ui/tag";
import { api } from "@/lib/api";
import type { CheckResult, ProjectDetail } from "@/lib/contract";
import { PROJECT_STATUS, checkLabel } from "@/lib/display";
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

      {current && (
        <div className="space-y-8">
          <h3 className="text-body font-semibold">
            Milestone {current.index + 1}: {current.title} · {formatAmount(current.amount)} RLUSD
          </h3>
          {["escrowed", "evidence_submitted", "failed"].includes(current.status) && (
            <EvidenceUploader
              projectId={p.id}
              milestoneId={current.id}
              milestoneTitle={current.title}
              requirements={p.sov.filter((l) => current.sovCodes.includes(l.code)).flatMap((l) => l.evidence)}
            />
          )}
          <ChecksPanel
            milestone={current}
            status={d.checks[current.id] ?? { required: [], optional: [], outcome: "pending" }}
            audits={d.audits[current.id] ?? []}
            attestations={d.attestations[current.id] ?? []}
            builderName={builder.name}
            action={
              ["evidence_submitted", "audited", "failed"].includes(current.status) ? (
                <ActionButton action={{ kind: "runChecks", projectId: p.id, milestoneId: current.id }}>Run checks</ActionButton>
              ) : undefined
            }
          />
        </div>
      )}
    </Section>
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
