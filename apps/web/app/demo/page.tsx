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
import { DUPLICATE_PHOTO_CHECK, failedChecks, findStall } from "@/lib/demo-scenes";
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
  const reusedPhoto = failedCheck?.check === DUPLICATE_PHOTO_CHECK;
  const bExpired = stall?.overdue;
  const bRefunded = stall?.refunded;

  return (
    <div className="space-y-7">
      <AutoRefresh ms={2500} />
      <PageHeader
        title="Control room"
        description="Guide a project from verification to its first milestone payment."
        action={
          <div className="flex gap-2">
            <a href={INSPECTOR_APP_URL} target="_blank" rel="noreferrer" className={buttonClass("secondary")}>
              Open inspector app
            </a>
            <ActionButton variant="secondary" action={{ kind: "resetDemo" }}>
              Reset demo
            </ActionButton>
          </div>
        }
      />

      {!a && <p className="rounded-panel bg-review-bg px-5 py-4 text-small text-review">No pre-staged demo project found. Run Reset demo, or pre-stage Project A (XRPL-11).</p>}

      <ol className="surface overflow-hidden divide-y divide-line">
        <Scene
          n={1}
          title="Verified project"
          body="The builder paid to be checked; the AI verified identity, feasibility and capability; the credential is on the ledger."
          state={a && (a.builder.verified ? <Tag tone="pass">Builder verified</Tag> : <Tag>Not verified</Tag>)}
          screen={<ScreenLink href="/builder" label="Builder page" />}
        />
        <Scene
          n={2}
          title="Locked state"
          body="Investors funded the vault, the loan went to the project account, and every milestone sits in its own escrow."
          state={a && <Tag tone={PROJECT_STATUS[a.project.status].tone}>{PROJECT_STATUS[a.project.status].label}</Tag>}
          detail={a?.vault && `${a.project.milestones.filter((m) => m.escrow).length} escrows · vault ${formatAmount(a.vault.assetsTotal)} RLUSD · share price ${Number(a.vault.sharePrice).toFixed(4)}`}
          screen={a && <ScreenLink href={`/projects/${a.project.id}`} label={a.project.name} />}
        />
        <Scene
          n={3}
          title="Review evidence and release"
          body="The inspector's signed audit plus the AI's checks run on the first milestone. All green, so the release service finishes the escrow."
          state={m1 && <MilestoneTag m={m1} />}
          detail={m1?.status === "released" && a?.balances ? `Builder balance ${formatAmount(a.balances.builder)} RLUSD` : undefined}
          action={a && m1 && RUNNABLE.includes(m1.status) && <ActionButton action={{ kind: "runChecks", projectId: a.project.id, milestoneId: m1.id }}>Run checks</ActionButton>}
          screen={a && m1 && <ScreenLink href={`/projects/${a.project.id}?m=${m1.id}`} label={m1.title} />}
        />
        <Scene
          n={4}
          title="Failed check: funds stay locked"
          body={
            m2Failed.length
              ? `${reusedPhoto ? "The second milestone includes a photo reused from another project. " : ""}${m2Failed.length} required check${m2Failed.length === 1 ? " fails" : "s fail"} and the money stays locked.`
              : "The second milestone includes a photo reused from another project. A required check fails and the money stays locked."
          }
          state={m2 && <MilestoneTag m={m2} />}
          detail={
            failedCheck &&
            `${checkName(failedCheck.check)}: ${failedCheck.reason}${m2Failed.length > 1 ? ` (+${m2Failed.length - 1} more failed check${m2Failed.length === 2 ? "" : "s"})` : ""}`
          }
          action={a && m2 && RUNNABLE.includes(m2.status) && m2.status !== "failed" && <ActionButton action={{ kind: "runChecks", projectId: a.project.id, milestoneId: m2.id }}>Run checks</ActionButton>}
          screen={a && m2 && <ScreenLink href={`/projects/${a.project.id}?m=${m2.id}`} label={m2.title} />}
        />
      </ol>

      <details className="space-y-4">
        <summary className="min-h-11 cursor-pointer py-2 text-heading">Extended walkthrough and engineering checks</summary>
        <p className="text-small text-ink-2">Outside the timed pitch. Use these controls for preparation or technical Q&A.</p>
        <ol className="surface overflow-hidden divide-y divide-line">
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
          state={b && (bExpired ? <Tag tone="review">{bExpired.status === "expired" ? "Expired" : "Past CancelAfter"}, not cancelled yet</Tag> : bRefunded ? <Tag>Returned to the vault</Tag> : <Tag>Nothing expired</Tag>)}
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
  title,
  body,
  state,
  detail,
  action,
  screen,
}: {
  n?: number;
  title: string;
  body: string;
  state?: React.ReactNode;
  detail?: React.ReactNode;
  action?: React.ReactNode;
  screen?: React.ReactNode;
}) {
  return (
    <li className="demo-scene">
      <span className="milestone-number">{n ?? ""}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-body font-semibold">{title}</h3>
          {state}
        </div>
        <details className="mt-2 text-caption text-ink-2"><summary className="min-h-7 cursor-pointer">How this step works</summary><p className="mt-1 max-w-[65ch]">{body}</p></details>
        {detail && <p className="mt-1.5 text-small font-medium text-ink">{detail}</p>}
      </div>
      <div className="demo-scene-actions">
        {action}
        {screen}
      </div>
    </li>
  );
}

function ScreenLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="text-caption text-link hover:underline">
      Show {label}
    </Link>
  );
}

function MilestoneTag({ m }: { m: Milestone }) {
  const s = MILESTONE_STATUS[m.status];
  return <Tag tone={s.tone}>{s.label}</Tag>;
}
