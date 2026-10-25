// /demo control room for the driver: the scenes of docs/04-demo-script.md in order, each with its one action, its live
// state, and a link to the screen the audience should be looking at. Targets are found from data, not hard-coded ids.
// The script itself lives in docs/04-demo-script.md; this page carries titles, buttons and state only.
import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { TxLink } from "@/components/chain";
import { CloseLoanButton } from "@/components/demo/close-loan-button";
import { DecisionForm } from "@/components/demo/decision-form";
import { buttonClass } from "@/components/ui/button";
import type { Tone } from "@/components/ui/tag";
import { ApiError, api } from "@/lib/api";
import type { Milestone, ProjectDetail } from "@/lib/contract";
import { failedChecks, findStall } from "@/lib/demo-scenes";
import { MILESTONE_STATUS, PROJECT_STATUS, checkName } from "@/lib/display";
import { getSession } from "@/lib/session";
import { cn, formatAmount, fromCents, toCents } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Demo" };

const INSPECTOR_APP_URL = process.env.NEXT_PUBLIC_INSPECTOR_APP_URL ?? "http://localhost:3001";
const RUNNABLE: Milestone["status"][] = ["evidence_submitted", "audited", "failed"];
const ONBOARDING_ORDER = ["verifying", "verified", "draft", "funded", "funding"];

// WEB-12: only a missing project is "not seeded yet"; a service failure must reach the error boundary.
const get = (id: string) => api.getProject(id).catch((error: unknown) => {
  if (error instanceof ApiError && error.status === 404) return undefined;
  throw error;
});

export default async function DemoPage() {
  const session = await getSession();
  const summaries = await api.listProjects();
  const all = (await Promise.all(summaries.map((s) => get(s.id)))).filter((d): d is ProjectDetail => !!d);

  const a = all.find((d) => /maple/i.test(d.project.name)) ?? all.find((d) => d.project.status === "escrowed");
  const stall = findStall(all, a, Date.now());
  const b = stall?.d;
  const onboard = all
    .filter((d) => d !== a && ONBOARDING_ORDER.includes(d.project.status))
    .sort(
      (x, y) =>
        ONBOARDING_ORDER.indexOf(x.project.status) - ONBOARDING_ORDER.indexOf(y.project.status) ||
        Date.parse(x.vault?.subscriptionDate ?? x.project.terms.fundingDeadline) - Date.parse(y.vault?.subscriptionDate ?? y.project.terms.fundingDeadline),
    )[0];
  const review = all.flatMap((d) => d.project.milestones.filter((m) => m.status === "needs_human").map((m) => ({ d, m })))[0];

  const platform = session.platform?.address;
  const investor = session.investors.find((i) => i.kyc);
  const [m1, m2, m3] = a?.project.milestones ?? [];
  const refused = a?.events.find((e) => e.kind === "release_refused");
  const { failed: m2Failed, headline: failedCheck } = failedChecks(m2 && a?.checks[m2.id]);
  const bExpired = stall?.overdue;
  const bRefunded = stall?.refunded;
  const nextScene = !a ? undefined : !a.builder.verified ? 1 : !m1?.escrow ? 2 : m1.status !== "released" ? 3 : 4;

  const done = [!!a?.builder.verified, !!m1?.escrow, m1?.status === "released", m2?.status === "failed" || m2?.status === "released"];
  const progress = (n: number) => (done[n - 1] ? "done" : nextScene === n ? "current" : "todo") as Progress;

  return (
    <div className="space-y-7">
      <AutoRefresh ms={2500} />
      <header className="flex flex-wrap items-center justify-between gap-x-8 gap-y-4 rounded-md border border-line bg-white p-5 md:p-6">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h1 className="text-[30px] leading-10 font-medium tracking-tight">Demo control room</h1>
          {a && <span className="text-body text-ink-2">{a.project.name}</span>}
        </div>
        <a href={INSPECTOR_APP_URL} target="_blank" rel="noreferrer" className={buttonClass("secondary")}>
          Open inspector
        </a>
      </header>

      {!a && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-panel bg-band px-5 py-4">
          <p className="text-body font-medium">No demo project</p>
          <ActionButton variant="secondary" action={{ kind: "resetDemo" }}>Reset demo</ActionButton>
        </div>
      )}

      <ol className="overflow-hidden rounded-md border border-line bg-white px-5 md:px-6" aria-label="Recording sequence">
        <Scene
          n={1}
          progress={progress(1)}
          title="Verified project"
          status={a && <State tone={a.builder.verified ? "pass" : "neutral"}>{a.builder.verified ? "Verified" : "Not verified"}</State>}
          screen={<ScreenLink href="/builder" label="builder" />}
        />
        <Scene
          n={2}
          progress={progress(2)}
          title="Locked state"
          status={a && <State tone={PROJECT_STATUS[a.project.status].tone}>{PROJECT_STATUS[a.project.status].label}</State>}
          facts={a?.vault ? [`${a.project.milestones.filter((m) => m.escrow).length} escrows`, `Vault ${formatAmount(a.vault.assetsTotal)}`, `Share price ${Number(a.vault.sharePrice).toFixed(4)}`] : undefined}
          screen={a && <ScreenLink href={`/projects/${a.project.id}`} label="project" />}
        />
        <Scene
          n={3}
          progress={progress(3)}
          title="Release"
          status={m1 && <MilestoneState m={m1} />}
          facts={[m1 && `${m1.title} ${formatAmount(m1.amount)}`, m1?.status === "released" && a?.balances ? `Builder balance ${formatAmount(a.balances.builder)}` : undefined]}
          action={a && m1 && RUNNABLE.includes(m1.status) && <ActionButton action={{ kind: "runChecks", projectId: a.project.id, milestoneId: m1.id }}>Run checks</ActionButton>}
          screen={a && m1 && <ScreenLink href={`/projects/${a.project.id}?m=${m1.id}`} label="milestone" />}
        />
        <Scene
          n={4}
          progress={progress(4)}
          title="Failed check: funds stay locked"
          status={m2 && <MilestoneState m={m2} />}
          facts={[
            m2 && `${m2.title} ${formatAmount(m2.amount)}`,
            failedCheck
              ? `${checkName(failedCheck.check)}: ${failedCheck.reason}${m2Failed.length > 1 ? ` (+${m2Failed.length - 1} more failed check${m2Failed.length === 2 ? "" : "s"})` : ""}`
              : undefined,
          ]}
          action={a && m2 && RUNNABLE.includes(m2.status) && m2.status !== "failed" && <ActionButton action={{ kind: "runChecks", projectId: a.project.id, milestoneId: m2.id }}>Run checks</ActionButton>}
          screen={a && m2 && <ScreenLink href={`/projects/${a.project.id}?m=${m2.id}`} label="milestone" />}
        />
      </ol>

      <details className="proof">
        <summary className="inline-flex min-h-11 items-center gap-1 text-small font-medium text-ink-2 hover:text-ink">
          <ChevronRight className="proof-chevron size-4 transition-transform duration-150" aria-hidden />
          Extended walkthrough and engineering checks (outside the timed pitch)
        </summary>
        <ol className="border-t border-line">
          <Scene
            title="Ledger says no (tests the escrow condition, not the AI checks)"
            status={refused && <State tone="fail">Refused</State>}
            facts={refused ? [refused.result ?? "tecCRYPTOCONDITION_ERROR", <TxLink key="tx" hash={refused.txHash} />] : undefined}
            action={
              a &&
              m2?.escrow &&
              !m2.escrow.finishTx &&
              !m2.escrow.cancelTx && (
                <ActionButton variant="danger" action={{ kind: "tryStealDemo", projectId: a.project.id, milestoneId: m2.id }}>
                  {refused ? "Try again" : "Platform tries to release"}
                </ActionButton>
              )
            }
            screen={a && m2 && <ScreenLink href={`/projects/${a.project.id}?m=${m2.id}`} label="milestone" />}
          />
          <Scene
            title="Stall: escrow expires, money goes back"
            status={b && (bExpired ? <State tone="review">{bExpired.status === "expired" ? "Expired" : "Past CancelAfter"}, not cancelled yet</State> : bRefunded ? <State tone="neutral">Returned to the vault</State> : <State tone="neutral">Nothing expired</State>)}
            facts={b?.vault ? [b.project.name, `Available ${formatAmount(b.vault.assetsAvailable)}`] : undefined}
            action={bExpired && <ActionButton action={{ kind: "keeperTick" }}>Run keeper tick</ActionButton>}
            screen={b && <ScreenLink href={`/projects/${b.project.id}`} label="project" />}
          />
          <Scene
            title="Operator decision"
            status={review ? <MilestoneState m={review.m} /> : m3 && <MilestoneState m={m3} />}
            facts={review ? [review.m.title, review.d.project.name] : m3 ? [m3.title] : undefined}
            action={
              review && platform ? (
                <DecisionForm projectId={review.d.project.id} milestoneId={review.m.id} actor={platform} />
              ) : (
                a &&
                m3 &&
                RUNNABLE.includes(m3.status) && (
                  <ActionButton size="sm" variant="secondary" action={{ kind: "runChecks", projectId: a.project.id, milestoneId: m3.id }}>
                    Run checks
                  </ActionButton>
                )
              )
            }
            screen={(review ?? (a && m3 && { d: a, m: m3 })) && <ScreenLink href={`/projects/${(review?.d ?? a)!.project.id}?m=${(review?.m ?? m3)!.id}`} label="milestone" />}
          />
          <Scene
            title="Loan repayment"
            facts={a?.loan && a.vault ? [`Share price ${Number(a.vault.sharePrice).toFixed(4)}`, `${a.loan.paymentRemaining} payments left`] : undefined}
            action={a?.loan && <ActionButton size="sm" variant="secondary" disabled={toCents(a.loan.totalValueOutstanding) <= 0} context={a.project.name} action={{ kind: "repay", projectId: a.project.id, amount: a.loan.periodicPayment }}>Repay {formatAmount(a.loan.periodicPayment)} RLUSD</ActionButton>}
            screen={a && <ScreenLink href={`/projects/${a.project.id}`} label="project" />}
          />
          {onboard && <OnboardScene d={onboard} platform={platform} investor={investor?.address} />}
          <li className="flex items-center justify-between gap-4 py-4">
            <span className="text-body font-semibold">Reset</span>
            <ActionButton variant="secondary" action={{ kind: "resetDemo" }}>Reset demo</ActionButton>
          </li>
        </ol>
      </details>
    </div>
  );
}

function OnboardScene({ d, platform, investor }: { d: ProjectDetail; platform?: string; investor?: string }) {
  const p = d.project;
  const st = p.status;
  const raised = d.investments.reduce((acc, i) => acc + toCents(i.amount), 0);
  const remaining = toCents(p.terms.principal) - raised;
  return (
    <Scene
      title="Onboard project"
      status={<State tone={PROJECT_STATUS[st].tone}>{PROJECT_STATUS[st].label}</State>}
      facts={[p.name, st === "funding" || st === "funded" ? `Raised ${formatAmount(raised / 100)} of ${formatAmount(p.terms.principal)}` : undefined]}
      action={
        st === "draft" ? (
          <ActionButton size="sm" context={p.name} action={{ kind: "payFee", projectId: p.id, builder: d.builder.address }}>
            Pay verification fee
          </ActionButton>
        ) : st === "verifying" ? (
          <ActionButton size="sm" action={{ kind: "verifyProject", projectId: p.id }}>
            Run verification
          </ActionButton>
        ) : st === "verified" && platform ? (
          <ActionButton size="sm" action={{ kind: "lockTerms", projectId: p.id, actor: platform }}>
            Lock terms
          </ActionButton>
        ) : st === "funding" && investor && remaining > 0 ? (
          <ActionButton size="sm" context={p.name} action={{ kind: "invest", projectId: p.id, investor, amount: fromCents(remaining) }}>
            Fill vault
          </ActionButton>
        ) : st === "funded" && platform ? (
          <CloseLoanButton projectId={p.id} actor={platform} opensAt={d.vault?.subscriptionDate} />
        ) : undefined
      }
      screen={<ScreenLink href={`/projects/${p.id}`} label="project" />}
    />
  );
}

type Progress = "done" | "current" | "todo";

/** Same language as the milestone rail: lime disc once done, ink ring for the next scene, grey ring before. */
function Marker({ progress }: { progress: Progress }) {
  const base = "flex size-[22px] shrink-0 items-center justify-center rounded-full [&_svg]:size-3.5 [&_svg]:stroke-[3]";
  if (progress === "done") return <span className={cn(base, "bg-accent text-ink ring-1 ring-black/10")}><Check aria-hidden /><span className="sr-only">Done</span></span>;
  if (progress === "current") return <span className={cn(base, "border-2 border-ink")}><span className="size-2 rounded-full bg-ink" /><span className="sr-only">Next</span></span>;
  return <span className={cn(base, "border-2 border-line-2")} />;
}

const STATE_TEXT: Record<Tone, string> = { neutral: "text-ink-3", info: "text-ink-2", pass: "text-pass", fail: "text-fail", review: "text-review" };

function State({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return <span className={cn("text-small font-medium", STATE_TEXT[tone])}>{children}</span>;
}

function MilestoneState({ m }: { m: Milestone }) {
  const s = MILESTONE_STATUS[m.status];
  return <State tone={s.tone}>{s.label}</State>;
}

function Scene({
  n,
  progress,
  title,
  status,
  facts,
  action,
  screen,
}: {
  n?: number;
  progress?: Progress;
  title: string;
  status?: React.ReactNode;
  facts?: React.ReactNode[];
  action?: React.ReactNode;
  screen?: React.ReactNode;
}) {
  const shown = facts?.filter((f) => f !== undefined && f !== false && f !== "");
  return (
    <li aria-current={progress === "current" ? "step" : undefined} className="border-b border-line">
    <div className={cn("-mx-3 grid items-center gap-x-4 gap-y-2 rounded-[12px] px-3 py-4 md:grid-cols-[minmax(0,1fr)_auto]", progress === "current" && "bg-band")}>
      <div className="flex min-w-0 items-start gap-4">
        {progress ? <span className="mt-0.5 flex w-[22px] shrink-0 justify-center"><Marker progress={progress} /></span> : null}
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3">
            {n !== undefined && <span className="text-body tabular-nums text-ink-3">{n}</span>}
            <h3 className="text-[19px] leading-7 font-semibold tracking-[-0.01em]">{title}</h3>
            {status}
          </div>
          {shown && shown.length > 0 && (
            <p className="mt-0.5 flex flex-wrap gap-x-5 text-small text-ink-2 tabular-nums">
              {shown.map((f, i) => <span key={i}>{f}</span>)}
            </p>
          )}
        </div>
      </div>
      {(action || screen) && (
        <div className={cn("flex flex-wrap items-center gap-2 md:justify-end", progress ? "pl-[38px] md:pl-0" : "")}>
          {action}
          {screen}
        </div>
      )}
    </div>
    </li>
  );
}

function ScreenLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center px-1 text-small font-medium text-ink-2 underline decoration-line-2 underline-offset-4 hover:text-ink hover:decoration-ink">
      Show {label}
    </Link>
  );
}
