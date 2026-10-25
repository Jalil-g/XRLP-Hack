// /demo control room for the driver: the scenes of docs/04-demo-script.md in order, each with its one action, its live
// state, and a link to the screen the audience should be looking at. Targets are found from data, not hard-coded ids.
import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { TxLink } from "@/components/chain";
import { CloseLoanButton } from "@/components/demo/close-loan-button";
import { DecisionForm } from "@/components/demo/decision-form";
import { buttonClass } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/layout";
import { Tag } from "@/components/ui/tag";
import { ApiError, api } from "@/lib/api";
import type { Milestone, ProjectDetail } from "@/lib/contract";
import { MILESTONE_STATUS, PROJECT_STATUS, checkName } from "@/lib/display";
import { getSession } from "@/lib/session";
import { formatAmount, fromCents, toCents } from "@/lib/utils";

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
  const b = all.find((d) => d !== a && d.project.milestones.some((m) => m.status === "expired")) ?? all.find((d) => d !== a && d.project.status === "stalled");
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
  const failedCheck = m2 && a?.checks[m2.id]?.required.find((c) => c.result === "fail");
  const bExpired = b?.project.milestones.find((m) => m.status === "expired");
  const bRefunded = b?.project.milestones.find((m) => m.status === "refunded");
  const nextScene = !a ? undefined : !a.builder.verified ? 1 : !m1?.escrow ? 2 : m1.status !== "released" ? 3 : 4;

  return (
    <div className="space-y-8">
      <AutoRefresh ms={2500} />
      <PageHeader
        title="Demo control room"
        description="Prepare the 100-second recording: show the project, review the evidence, release one milestone, and hold a failed milestone."
        action={
          <div className="flex gap-2">
            <a href={INSPECTOR_APP_URL} target="_blank" rel="noreferrer" className={buttonClass("secondary")}>
              Open inspector app
            </a>
          </div>
        }
      />

      <section className="rounded-[20px] bg-capital p-6 text-capital-text sm:p-8" aria-label="Current demo scene">
        <div className="grid items-start gap-6 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div><h2 className="text-heading">{a?.project.name ?? "Prepare the demo project"}</h2><p className="mt-2 max-w-[65ch] text-small text-capital-muted">{!a ? "Reset or pre-stage the demo before recording." : m2?.status === "failed" && m1?.status === "released" ? "Release and hold are both visible. Open the project to show the proof and financial outcome." : `Next scene: ${nextScene === 1 ? "verify the builder" : nextScene === 2 ? "show the locked escrows" : nextScene === 3 ? "review evidence and release" : "show the failed check and held funds"}.`}</p></div>
          {m1 && <div><p className="text-small text-capital-muted">{m1.title} · {m1.status === "released" ? "released" : "scheduled draw"}</p><p className="mt-2 text-[36px] leading-tight font-semibold tracking-[-0.035em] tabular-nums sm:text-[52px]">{formatAmount(m1.amount, { cents: true })} <span className="text-body tracking-normal text-capital-muted">RLUSD</span></p></div>}
        </div>
        <p className="mt-6 border-t border-capital-muted/30 pt-4 text-small text-capital-muted">100-second story · Signed audit + AI checks → release or hold. Mock sources remain labelled; no audit signature alone releases money.</p>
      </section>

      {!a && <div className="flex flex-wrap items-center justify-between gap-4 rounded-panel bg-review-bg px-5 py-4"><p className="text-small text-review">No pre-staged demo project found. Reset the demo, or pre-stage Project A (XRPL-11).</p><ActionButton variant="secondary" action={{ kind: "resetDemo" }}>Reset demo</ActionButton></div>}

      <ol className="divide-y divide-line rounded-panel border border-line bg-surface px-4 sm:px-6" aria-label="Recording sequence">
        <Scene
          n={1}
          current={nextScene === 1}
          title="Verified project"
          body="The builder paid to be checked; the AI verified identity, feasibility and capability; the credential is on the ledger."
          state={a && (a.builder.verified ? <Tag tone="pass">Builder verified</Tag> : <Tag>Not verified</Tag>)}
          screen={<ScreenLink href="/builder" label="Builder page" />}
        />
        <Scene
          n={2}
          current={nextScene === 2}
          title="Locked state"
          body="Investors funded the vault, the loan went to the project account, and every milestone sits in its own escrow."
          state={a && <Tag tone={PROJECT_STATUS[a.project.status].tone}>{PROJECT_STATUS[a.project.status].label}</Tag>}
          detail={a?.vault && `${a.project.milestones.filter((m) => m.escrow).length} escrows · vault ${formatAmount(a.vault.assetsTotal)} RLUSD · share price ${Number(a.vault.sharePrice).toFixed(4)}`}
          screen={a && <ScreenLink href={`/projects/${a.project.id}`} label={a.project.name} />}
        />
        <Scene
          n={3}
          current={nextScene === 3}
          title="Review evidence and release"
          body="The inspector's signed audit plus the AI's checks run on the first milestone. All green, so the release service finishes the escrow."
          state={m1 && <MilestoneTag m={m1} />}
          detail={m1?.status === "released" && a?.balances ? `Builder balance ${formatAmount(a.balances.builder)} RLUSD` : undefined}
          action={a && m1 && RUNNABLE.includes(m1.status) && <ActionButton action={{ kind: "runChecks", projectId: a.project.id, milestoneId: m1.id }}>Run checks</ActionButton>}
          screen={a && m1 && <ScreenLink href={`/projects/${a.project.id}?m=${m1.id}`} label={m1.title} />}
        />
        <Scene
          n={4}
          current={nextScene === 4}
          title="Failed check: funds stay locked"
          body="The second milestone includes a photo reused from another project. One check fails and the money stays locked."
          state={m2 && <MilestoneTag m={m2} />}
          detail={failedCheck && `${checkName(failedCheck.check)}: ${failedCheck.reason}`}
          action={a && m2 && RUNNABLE.includes(m2.status) && m2.status !== "failed" && <ActionButton action={{ kind: "runChecks", projectId: a.project.id, milestoneId: m2.id }}>Run checks</ActionButton>}
          screen={a && m2 && <ScreenLink href={`/projects/${a.project.id}?m=${m2.id}`} label={m2.title} />}
        />
      </ol>

      <details className="space-y-4">
        <summary className="min-h-11 cursor-pointer py-2 text-heading">Extended walkthrough and engineering checks</summary>
        <p className="text-small text-ink-2">Outside the timed pitch. Use these controls for preparation or technical Q&A.</p>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-panel border border-line bg-surface p-5"><p className="text-small text-ink-2">Reset replaces the demo state. Finish recording before using it.</p><ActionButton variant="secondary" action={{ kind: "resetDemo" }}>Reset demo</ActionButton></div>
        <ol className="divide-y divide-line border-y border-line">
        <Scene
          title="Ledger says no"
          body="A wrong fulfillment is rejected. This tests the escrow condition; it does not prove that the ledger enforces AI checks."
          state={refused && <Tag tone="fail">Refused by the ledger</Tag>}
          detail={
            refused && (
              <>
                {refused.result ?? "tecCRYPTOCONDITION_ERROR"} · EscrowFinish <TxLink hash={refused.txHash} />
              </>
            )
          }
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
          screen={a && m2 && <ScreenLink href={`/projects/${a.project.id}?m=${m2.id}`} label={m2.title} />}
        />
        <Scene
          title="Stall: escrow expires, money goes back"
          body="An escrow passed its CancelAfter. The keeper cancels it, and the project account repays the vault. Investors redeem at maturity."
          state={b && (bExpired ? <Tag tone="review">Expired, not cancelled yet</Tag> : bRefunded ? <Tag>Returned to the vault</Tag> : <Tag>Nothing expired</Tag>)}
          detail={b?.vault && `${b.project.name} vault available ${formatAmount(b.vault.assetsAvailable)} RLUSD`}
          action={bExpired && <ActionButton action={{ kind: "keeperTick" }}>Keeper tick</ActionButton>}
          screen={b && <ScreenLink href={`/projects/${b.project.id}`} label={b.project.name} />}
        />
          <Scene
            title="Operator decision"
            body={
              review
                ? `${review.m.title} on ${review.d.project.name} passed its checks below the confidence it needs. Approve or reject with a reason; the reason is attested on-chain.`
                : "When a milestone comes back below its confidence minimum, the platform operator approves or rejects it with a reason attested on-chain."
            }
            state={review ? <MilestoneTag m={review.m} /> : m3 && <MilestoneTag m={m3} />}
            action={
              review && platform ? (
                <DecisionForm projectId={review.d.project.id} milestoneId={review.m.id} actor={platform} />
              ) : (
                a &&
                m3 &&
                RUNNABLE.includes(m3.status) && (
                  <ActionButton size="sm" variant="secondary" action={{ kind: "runChecks", projectId: a.project.id, milestoneId: m3.id }}>
                    Run checks on {m3.title}
                  </ActionButton>
                )
              )
            }
            screen={(review ?? (a && m3 && { d: a, m: m3 })) && <ScreenLink href={`/projects/${(review?.d ?? a)!.project.id}?m=${(review?.m ?? m3)!.id}`} label={(review?.m ?? m3)!.title} />}
          />
          <Scene
            title="Builder repays an instalment"
            body="Repayments flow to the vault through LoanPay. The interest in each one raises the vault's share price."
            detail={a?.loan && a.vault && `Share price ${Number(a.vault.sharePrice).toFixed(4)} · ${a.loan.paymentRemaining} payments left`}
            action={a?.loan && <ActionButton size="sm" variant="secondary" disabled={toCents(a.loan.totalValueOutstanding) <= 0} context={a.project.name} action={{ kind: "repay", projectId: a.project.id, amount: a.loan.periodicPayment }}>Repay {formatAmount(a.loan.periodicPayment)} RLUSD</ActionButton>}
            screen={a && <ScreenLink href={`/projects/${a.project.id}`} label={a.project.name} />}
          />
          {onboard && <OnboardScene d={onboard} platform={platform} investor={investor?.address} />}
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
      title={`Onboard a project: ${p.name}`}
      body="Pay the verification fee, run verification (credential on first pass), lock terms (inspector assigned, vault opened), fill the vault, close the loan."
      state={<Tag tone={PROJECT_STATUS[st].tone}>{PROJECT_STATUS[st].label}</Tag>}
      detail={st === "funding" || st === "funded" ? `Raised ${formatAmount(raised / 100)} of ${formatAmount(p.terms.principal)} RLUSD` : undefined}
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
            Investors fill the vault
          </ActionButton>
        ) : st === "funded" && platform ? (
          <CloseLoanButton projectId={p.id} actor={platform} opensAt={d.vault?.subscriptionDate} />
        ) : undefined
      }
      screen={<ScreenLink href={`/projects/${p.id}`} label={p.name} />}
    />
  );
}

function Scene({
  n,
  current,
  title,
  body,
  state,
  detail,
  action,
  screen,
}: {
  n?: number;
  current?: boolean;
  title: string;
  body: string;
  state?: React.ReactNode;
  detail?: React.ReactNode;
  action?: React.ReactNode;
  screen?: React.ReactNode;
}) {
  return (
    <li aria-current={current ? "step" : undefined} className="grid grid-cols-[32px_minmax(0,1fr)] items-start gap-x-4 gap-y-3 py-6 xl:grid-cols-[32px_minmax(0,1fr)_auto]">
      <span className={`flex size-8 items-center justify-center rounded-control text-small font-medium tabular-nums ${current ? "bg-accent text-ink" : "text-ink-2"}`}>{n ?? ""}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-body font-semibold">{title}</h3>
          {state}
        </div>
        <p className="mt-1 max-w-[72ch] text-small text-ink-2">{body}</p>
        {detail && <p className="mt-1.5 text-small font-medium text-ink">{detail}</p>}
      </div>
      <div className="col-start-2 flex flex-wrap items-center gap-3 xl:col-start-3 xl:max-w-[420px] xl:justify-end">
        {action}
        {screen}
      </div>
    </li>
  );
}

function ScreenLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center text-small text-link underline underline-offset-4">
      Show {label}
    </Link>
  );
}

function MilestoneTag({ m }: { m: Milestone }) {
  const s = MILESTONE_STATUS[m.status];
  return <Tag tone={s.tone}>{s.label}</Tag>;
}
