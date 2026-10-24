import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { PageHeader } from "@/components/ui/layout";
import { Tag } from "@/components/ui/tag";
import { api } from "@/lib/api";
import type { ProjectDetail } from "@/lib/contract";
import { MILESTONE_STATUS, PROJECT_STATUS } from "@/lib/display";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "Demo" };

const INSPECTOR_APP_URL = process.env.NEXT_PUBLIC_INSPECTOR_APP_URL ?? "http://localhost:3001";

const get = (id: string) => api.getProject(id).catch(() => undefined);

export default async function DemoPage() {
  const [session, maple, birch, cedar] = await Promise.all([getSession(), get("maple-st"), get("birch-rd"), get("cedar-ln")]);
  const platform = session.platform?.address;
  const [m1, m2, m3] = maple?.project.milestones ?? [];
  const expired = birch?.project.milestones.find((m) => m.status === "expired");

  return (
    <div className="space-y-10">
      <AutoRefresh ms={2500} />
      <PageHeader
        title="Demo control room"
        description="Scenes in the order of the 3-minute demo. Each button is one API call; the toast shows its transactions."
        action={
          <div className="flex gap-2">
            <a href={INSPECTOR_APP_URL} target="_blank" rel="noreferrer" className="inline-flex h-9 items-center rounded-control bg-band px-4 text-small font-medium hover:bg-band-2">
              Open inspector app
            </a>
            <ActionButton variant="secondary" action={{ kind: "resetDemo" }}>
              Reset demo
            </ActionButton>
          </div>
        }
      />

      <ol className="divide-y divide-line border-y border-line">
        <Scene n={1} title="Verified project" body="The builder paid to be checked; the AI verified identity, feasibility and capability; the credential is on the ledger." screen={maple && <ScreenLink href="/builder" label="Builder page" />} />
        <Scene
          n={2}
          title="Locked state"
          body="Investors funded the vault, the loan went to the project account, and each milestone sits in its own escrow."
          state={maple && <Tag tone={PROJECT_STATUS[maple.project.status].tone}>{PROJECT_STATUS[maple.project.status].label}</Tag>}
          screen={maple && <ScreenLink href="/projects/maple-st" label="Maple St" />}
        />
        <Scene
          n={3}
          title="Money shot: checks pass, escrow releases"
          body="The inspector's signed audit plus the AI's checks run on Foundation. All green, so the release service finishes the escrow."
          state={m1 && <MilestoneTag d={maple!} id={m1.id} />}
          action={maple && m1 && <ActionButton disabled={!["evidence_submitted", "audited", "failed"].includes(m1.status)} action={{ kind: "runChecks", projectId: maple.project.id, milestoneId: m1.id }}>Run checks</ActionButton>}
          screen={m1 && <ScreenLink href={`/projects/maple-st?m=${m1.id}`} label="Foundation" />}
        />
        <Scene
          n={4}
          title="Fraud held: one red check"
          body="Framing includes a photo reused from Oak Ave. No duplicate photo fails, so the money stays locked."
          state={m2 && <MilestoneTag d={maple!} id={m2.id} />}
          action={maple && m2 && <ActionButton disabled={!["evidence_submitted", "audited", "failed"].includes(m2.status)} action={{ kind: "runChecks", projectId: maple.project.id, milestoneId: m2.id }}>Run checks</ActionButton>}
          screen={m2 && <ScreenLink href={`/projects/maple-st?m=${m2.id}`} label="Framing" />}
        />
        <Scene
          n={5}
          title="Ledger says no"
          body="The platform submits a finish for Framing with a wrong fulfillment. The ledger refuses it: tecCRYPTOCONDITION_ERROR."
          action={maple && m2 && <ActionButton variant="danger" disabled={!m2.escrow || !!m2.escrow.finishTx} action={{ kind: "tryStealDemo", projectId: maple.project.id, milestoneId: m2.id }}>Platform tries to release</ActionButton>}
          screen={m2 && <ScreenLink href={`/projects/maple-st?m=${m2.id}`} label="Framing" />}
        />
        <Scene
          n={6}
          title="Stall: escrow expires, money goes back"
          body="Birch Rd's Finishes escrow passed its CancelAfter. The keeper cancels it and the project account repays the vault."
          state={birch && (expired ? <Tag tone="review">1 expired escrow</Tag> : <Tag>Nothing expired</Tag>)}
          action={<ActionButton disabled={!expired} action={{ kind: "keeperTick" }}>Keeper tick</ActionButton>}
          screen={birch && <ScreenLink href="/projects/birch-rd" label="Birch Rd" />}
        />
      </ol>

      <div className="space-y-4">
        <h2 className="text-heading">Off-script</h2>
        <ol className="divide-y divide-line border-y border-line">
          <Scene
            title="Operator decision"
            body="Roof & dry-in comes back below its confidence minimum. The platform operator approves or rejects with a reason that is attested on-chain."
            state={m3 && <MilestoneTag d={maple!} id={m3.id} />}
            action={
              maple && m3 && platform ? (
                <div className="flex gap-2">
                  <ActionButton size="sm" disabled={m3.status !== "needs_human"} action={{ kind: "decide", projectId: maple.project.id, milestoneId: m3.id, actor: platform, decision: "approve", reason: "North-side windows confirmed by the inspector's photos." }}>
                    Approve
                  </ActionButton>
                  <ActionButton size="sm" variant="danger" disabled={m3.status !== "needs_human"} action={{ kind: "decide", projectId: maple.project.id, milestoneId: m3.id, actor: platform, decision: "reject", reason: "North-side windows not shown; resubmit photos." }}>
                    Reject
                  </ActionButton>
                </div>
              ) : undefined
            }
            screen={m3 && <ScreenLink href={`/projects/maple-st?m=${m3.id}`} label="Roof & dry-in" />}
          />
          <Scene
            title="Onboard a new builder"
            body="Cedar Ln ADU: pay the fee, run verification, then lock terms to open funding."
            state={cedar && <Tag tone={PROJECT_STATUS[cedar.project.status].tone}>{PROJECT_STATUS[cedar.project.status].label}</Tag>}
            action={
              cedar && platform ? (
                <div className="flex gap-2">
                  <ActionButton size="sm" disabled={cedar.project.status !== "draft"} action={{ kind: "payFee", projectId: cedar.project.id, builder: cedar.builder.address }}>
                    Pay fee
                  </ActionButton>
                  <ActionButton size="sm" disabled={cedar.project.status !== "verifying"} action={{ kind: "verifyProject", projectId: cedar.project.id }}>
                    Verify
                  </ActionButton>
                  <ActionButton size="sm" disabled={cedar.project.status !== "verified"} action={{ kind: "lockTerms", projectId: cedar.project.id, actor: platform }}>
                    Lock terms
                  </ActionButton>
                </div>
              ) : undefined
            }
            screen={cedar && <ScreenLink href={`/projects/${cedar.project.id}`} label="Cedar Ln" />}
          />
        </ol>
      </div>
    </div>
  );
}

function Scene({ n, title, body, state, action, screen }: { n?: number; title: string; body: string; state?: React.ReactNode; action?: React.ReactNode; screen?: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 py-5">
      <span className="tabular pt-0.5 text-body text-ink-2">{n ?? ""}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-body font-semibold">{title}</h3>
          {state}
        </div>
        <p className="mt-1 max-w-[70ch] text-small text-ink-2">{body}</p>
      </div>
      <div className="flex items-center gap-4">
        {screen}
        {action}
      </div>
    </li>
  );
}

function ScreenLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-small text-link hover:underline">
      {label}
    </Link>
  );
}

function MilestoneTag({ d, id }: { d: ProjectDetail; id: string }) {
  const m = d.project.milestones.find((x) => x.id === id);
  if (!m) return null;
  const s = MILESTONE_STATUS[m.status];
  return <Tag tone={s.tone}>{s.label}</Tag>;
}
