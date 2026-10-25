// WEB-04 review page: every state of the checks panel, from the mock fixtures. Not linked from the app.
import { ChecksPanel, type ChecksPanelProps } from "@/components/checks/checks-panel";
import { PageHeader, Section } from "@/components/ui/layout";
import type { Attestation, ChecksStatus, Milestone, MilestoneStatus } from "@/lib/contract";
import { AI_AGENT, PLATFORM, fakeHash, seed } from "@/lib/mock/fixtures";

export const metadata = { title: "Checks panel states" };

export default function DevChecksPage() {
  const { db, script } = seed();
  const maple = db.projects.find((p) => p.id === "maple-st")!;
  const [m1, m2, m3] = maple.milestones as [Milestone, Milestone, Milestone];
  const at = "2026-10-24T18:00:00.000Z";
  const names = Object.fromEntries(db.parties.map((p) => [p.address, p.name]));
  const builderName = db.builders.find((b) => b.id === maple.builderId)!.name;

  const verdictAttestation = (mid: string): Attestation => ({
    milestoneId: mid,
    role: "ai_agent",
    kind: "verdict",
    signer: AI_AGENT.address,
    decision: "approve",
    notes: "",
    txHash: fakeHash(`dev:verdict:${mid}`),
    at,
  });
  const panel = (m: Milestone, status: MilestoneStatus, checks: ChecksStatus, opts: { audits?: boolean; decision?: string } = {}): ChecksPanelProps => {
    const milestone: Milestone = {
      ...m,
      status,
      escrow: m.escrow && { ...m.escrow, finishTx: status === "released" ? fakeHash(`dev:finish:${m.id}`) : undefined },
    };
    const attestations: Attestation[] = [...(db.attestations[m.id] ?? [])];
    if (checks.verdict) attestations.push(verdictAttestation(m.id));
    if (opts.decision) attestations.push({ ...verdictAttestation(m.id), role: "platform", kind: "decision", signer: PLATFORM.address, notes: opts.decision });
    return {
      milestone,
      status: checks,
      audits: opts.audits === false ? [] : (db.audits[m.id] ?? []),
      attestations,
      evidence: db.evidence[m.id],
      builderName,
      names,
    };
  };
  const pending = (): ChecksStatus => ({ required: [], optional: [], outcome: "pending", suite: db.checks[m1.id]?.suite });

  const states: { title: string; note: string; props: ChecksPanelProps }[] = [
    { title: "Ready to run", note: "Evidence and the inspector's signed audit are in; nothing has run.", props: panel(m1, "audited", pending()) },
    { title: "Pass → released", note: "Foundation: every check green, verdict attested, escrow finished.", props: panel(m1, "released", script.verdicts[m1.id]!(at)) },
    { title: "Fail: reused photo", note: "Framing: one red check with the flagged photo; money stays locked.", props: panel(m2, "failed", script.verdicts[m2.id]!(at)) },
    { title: "Fail: missing audit", note: "No signed audit from the assigned inspector, so the suite cannot pass.", props: panel(m3, "failed", script.missingAudit(maple, m3, at), { audits: false }) },
    { title: "Needs review", note: "Roof & dry-in: checks pass but confidence is below the milestone's minimum.", props: panel(m3, "needs_human", script.verdicts[m3.id]!(at)) },
    {
      title: "Operator approved → released",
      note: "The operator's signed reason shows in the banner.",
      props: panel(m3, "released", script.verdicts[m3.id]!(at), { decision: "North-side windows confirmed by the inspector's photos." }),
    },
    { title: "Waiting for evidence", note: "Escrow locked; the builder has not uploaded yet.", props: panel({ ...m3 }, "escrowed", pending(), { audits: false }) },
  ];

  return (
    <div className="space-y-14">
      <PageHeader title="Checks panel states" description="Every state of the milestone checks panel, rendered from the mock fixtures. For review only; not linked from the app." />
      {states.map((s) => (
        <Section key={s.title} title={s.title} aside={s.note}>
          <ChecksPanel {...s.props} />
        </Section>
      ))}
    </div>
  );
}
