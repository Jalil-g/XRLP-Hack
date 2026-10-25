// Builder workspace: per project, one number, the milestone rail, and the current milestone's one next action.
// State shows through the rail, the checks suite and the button; plumbing (credential, release txs) sits in Proof.
import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { BuilderHero, type HeroFigure } from "@/components/builder/builder-hero";
import { EvidenceReceipt } from "@/components/builder/evidence-receipt";
import { EvidenceUploader } from "@/components/builder/evidence-uploader";
import { TxLink } from "@/components/chain";
import { ChecksPanel } from "@/components/checks/checks-panel";
import { Proof } from "@/components/checks/proof";
import { StatusIcon, type RowState } from "@/components/checks/status-icon";
import { MilestoneTabs } from "@/components/project/milestone-tabs";
import { ReleaseStage } from "@/components/project/release-stage";
import { buttonClass } from "@/components/ui/button";
import { Empty, PageHeader } from "@/components/ui/layout";
import { Tag } from "@/components/ui/tag";
import { api } from "@/lib/api";
import type { Milestone, ProjectDetail, ProjectStatus } from "@/lib/contract";
import { PROJECT_STATUS, checkName, sovLinesFor } from "@/lib/display";
import { MAPLE_FIXTURE_SETS } from "@/lib/fixture-files";
import { getSession } from "@/lib/session";
import { cn, formatDate, toCents } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Builder" };

type Props = { searchParams: Promise<{ m?: string }> };

const PRE_FUNDING: ProjectStatus[] = ["draft", "verifying", "verified", "rejected", "terms_locked"];
const FUNDING: ProjectStatus[] = ["funding", "funded"];

export default async function BuilderPage({ searchParams }: Props) {
  const [{ m: pin }, session] = await Promise.all([searchParams, getSession()]);
  const builder = session.builder;
  if (session.directoryUnavailable) throw new Error("Builder accounts are temporarily unavailable. Try loading the workspace again.");
  if (!builder) return <Empty title="No builder accounts" />;
  const summaries = (await api.listProjects()).filter((s) => (s.builderId ? s.builderId === builder.id : s.builderName === builder.name));
  const details = await Promise.all(summaries.map((s) => api.getProject(s.id)));

  return (
    <div className="space-y-14">
      <AutoRefresh ms={4000} />
      <PageHeader
        title={builder.name}
        meta={builder.verified ? <Tag tone="pass">Verified</Tag> : <Tag>Not verified</Tag>}
        action={
          <Link href="/builder/new" className={buttonClass("secondary")}>
            New project
          </Link>
        }
      />

      {details.length === 0 && (
        <Empty
          title="No projects yet"
          action={
            <Link href="/builder/new" className={buttonClass()}>
              Create project
            </Link>
          }
        />
      )}

      {details.map((d, i) => (
        <BuilderProject key={d.project.id} d={d} lead={i === 0} pin={pin} />
      ))}

      <Proof
        label="Builder proof"
        className="border-t border-line pt-2"
        items={[
          { label: "Licence", value: builder.licenseNumber },
          { label: "Completed", value: `${builder.completedProjects} projects` },
          { label: "Credential", value: builder.credentialTx && <TxLink hash={builder.credentialTx} /> },
        ]}
      />
    </div>
  );
}

function BuilderProject({ d, lead, pin }: { d: ProjectDetail; lead: boolean; pin?: string }) {
  const { project: p } = d;
  const status = PROJECT_STATUS[p.status];
  const current = p.milestones.find((m) => !["released", "refunded", "pending"].includes(m.status));
  // ?m= pins the milestone whose checks just ran, so its release plays out here instead of jumping to the next draw.
  const shown = p.milestones.find((m) => m.id === pin) ?? current;
  const released = p.milestones.filter((m) => m.status === "released");
  const paidCents = released.reduce((a, m) => a + toCents(m.amount), 0);
  const raised = d.investments.reduce((a, i) => a + toCents(i.amount), 0);
  const principal: HeroFigure = { label: "Principal", cents: toCents(p.terms.principal) };
  const paid: HeroFigure = { label: "Paid to you", cents: paidCents, paid: true };
  const next = shown && shown.id !== current?.id && current;

  const hero = FUNDING.includes(p.status) ? (
    <BuilderHero lead={lead} label="Raised" cents={raised} ofCents={toCents(p.terms.principal)} figures={[{ label: "Closes", text: formatDate(p.terms.fundingDeadline) }]} />
  ) : PRE_FUNDING.includes(p.status) ? (
    <BuilderHero lead={lead} label="Principal" cents={toCents(p.terms.principal)} figures={[]} />
  ) : shown ? (
    <BuilderHero
      lead={lead}
      label={`${shown.title} draw`}
      cents={toCents(shown.amount)}
      figures={[paid, principal]}
      action={
        next && (
          <Link href="/builder" scroll={false} className={buttonClass("primary", "lg")}>
            Open {next.title}
          </Link>
        )
      }
    />
  ) : (
    <BuilderHero lead={lead} label="Paid to you" cents={paidCents} figures={[principal]} />
  );

  return (
    <ReleaseStage>
      <section aria-labelledby={`project-${p.id}`} className="space-y-7">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id={`project-${p.id}`} className="text-heading">
              {p.name}
            </h2>
            <Tag tone={status.tone}>{status.label}</Tag>
          </div>
          <nav aria-label={`${p.name} links`} className="flex gap-5 text-small font-medium">
            {d.verification && (
              <Link href={`/projects/${p.id}/verification`} className="text-ink-2 hover:text-ink">
                Verification
              </Link>
            )}
            <Link href={`/projects/${p.id}`} className="text-ink-2 hover:text-ink">
              Project page
            </Link>
          </nav>
        </header>

        {hero}

        {PRE_FUNDING.includes(p.status) ? (
          <Onboarding d={d} />
        ) : (
          <MilestoneTabs milestones={p.milestones} selectedId={shown?.id} linked={false} label={`${p.name} milestones`} />
        )}

        <div className="space-y-3">
          {shown && !PRE_FUNDING.includes(p.status) && !FUNDING.includes(p.status) && <CurrentMilestone d={d} m={shown} />}
          <div>
            <EvidenceReceipt detail={d} />
            <Proof
              label="Payouts"
              items={released.map((m) => ({ label: `${m.title} paid`, value: m.escrow?.finishTx && <TxLink hash={m.escrow.finishTx} /> }))}
            />
          </div>
        </div>
      </section>
    </ReleaseStage>
  );
}

/** What fixes each failed check, in a few words. */
const FIX: Record<string, string> = {
  required_evidence_present: "Add the missing files",
  gps_within_site: "Retake the photos on site",
  photo_fresh: "Upload new photos",
  no_duplicate_photo: "Replace the reused photo",
  invoice_matches_budget: "Upload the matching invoice",
  inspector_audit_present: "Ask the inspector to sign",
  audit_checklist_complete: "Finish the work, then re-audit",
  stage_visually_consistent: "Photograph the finished stage",
  audit_matches_evidence: "Upload photos that match the audit",
  document_consistency: "Fix the mismatched documents",
  lien_waiver_matches_invoices: "Upload matching lien waivers",
};

function CurrentMilestone({ d, m }: { d: ProjectDetail; m: Milestone }) {
  const { project: p, builder } = d;
  const checks = d.checks[m.id] ?? { required: [], optional: [], outcome: "pending" as const };
  const failed = [...checks.required, ...checks.optional].filter((c) => c.result === "fail");
  const flaggedNames = new Set((d.evidence?.[m.id] ?? []).filter((e) => failed.some((c) => c.evidenceIds.includes(e.id))).map((e) => e.filename));
  const set = /maple/i.test(p.name) ? MAPLE_FIXTURE_SETS[m.index] : undefined;
  const fixture = set && {
    label: "Use demo files",
    title: flaggedNames.size ? "Demo fixture files, without the flagged photo" : "Demo fixture files",
    files: set.filter((f) => !flaggedNames.has(f.path.split("/").pop()!)),
  };
  const uploader = (submitLabel: string) => (
    <EvidenceUploader
      projectId={p.id}
      milestoneId={m.id}
      milestoneTitle={m.title}
      projectName={p.name}
      builderName={builder.name}
      requirements={sovLinesFor(p, m).flatMap((l) => l.evidence)}
      submitLabel={submitLabel}
      fixture={fixture}
    />
  );

  if (m.status === "escrowed") return uploader("Upload");

  const first = failed[0];
  return (
    <div className="space-y-6">
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
        run={{ projectId: p.id, pinHref: `?m=${encodeURIComponent(m.id)}` }}
      />
      {m.status === "failed" && (
        <div className="space-y-4 pt-2">
          {first && (
            <p className="flex items-center gap-2.5 text-body">
              <StatusIcon state="fail" />
              <span>
                <span className="font-semibold text-ink">{checkName(first.check)}</span>
                <span className="text-ink-2">{failed.length > 1 ? ` and ${failed.length - 1} more. ` : ". "}</span>
                <span className="font-medium text-fail">{FIX[first.check] ?? "Fix the flagged evidence"}.</span>
              </span>
            </p>
          )}
          {uploader("Resubmit")}
        </div>
      )}
      {m.status === "evidence_submitted" && (
        <details className="proof">
          <summary className={buttonClass("secondary")}>Add files</summary>
          <div className="pt-5">{uploader("Upload")}</div>
        </details>
      )}
    </div>
  );
}

/** Before funding: a short checklist with the one live step's button. */
function Onboarding({ d }: { d: ProjectDetail }) {
  const { project: p, builder, verification: v } = d;
  const s = p.status;
  const verifyState: StepState = v?.decision === "pass" ? "done" : v?.decision === "fail" || s === "rejected" ? "fail" : v?.decision === "needs_human" ? "warn" : s === "verifying" ? "now" : "todo";
  const steps: { label: string; state: StepState; action?: React.ReactNode }[] = [
    {
      label: "Pay fee",
      state: s === "draft" ? "now" : "done",
      action: s === "draft" && (
        <ActionButton context={p.name} action={{ kind: "payFee", projectId: p.id, builder: builder.address }}>
          Pay 250 RLUSD
        </ActionButton>
      ),
    },
    {
      label: verifyState === "warn" ? "Site visit" : "Verify project",
      state: verifyState,
      action:
        s === "verifying" ? (
          <ActionButton action={{ kind: "verifyProject", projectId: p.id }}>Run verification</ActionButton>
        ) : verifyState === "fail" || verifyState === "warn" ? (
          <Link href={`/projects/${p.id}/verification`} className={buttonClass("secondary")}>
            Open report
          </Link>
        ) : undefined,
    },
    { label: "Lock terms", state: s === "terms_locked" ? "done" : s === "verified" ? "now" : "todo", action: s === "verified" && <span className="text-small text-ink-2">Platform</span> },
    { label: "Raise funds", state: s === "terms_locked" ? "now" : "todo" },
  ];
  return (
    <ol aria-label={`${p.name} onboarding`} className="max-w-[640px] divide-y divide-line border-y border-line">
      {steps.map((step, i) => (
        <li key={step.label} className="flex min-h-16 items-center gap-3.5 py-3">
          <StepMarker state={step.state} />
          <span className={cn("flex-1 text-body", step.state === "todo" ? "text-ink-2" : "font-medium text-ink")}>
            <span className="mr-2 tabular-nums text-ink-3">{i + 1}</span>
            {step.label}
          </span>
          {step.action}
        </li>
      ))}
    </ol>
  );
}

type StepState = "done" | "now" | "todo" | "fail" | "warn";
const STEP_ICON: Partial<Record<StepState, RowState>> = { done: "pass", fail: "fail", warn: "warn", todo: "queued" };

function StepMarker({ state }: { state: StepState }) {
  if (state === "now")
    return (
      <span aria-label="Next" role="img" className="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-ink">
        <span className="size-1.5 rounded-full bg-ink" />
      </span>
    );
  return <StatusIcon state={STEP_ICON[state]!} />;
}
