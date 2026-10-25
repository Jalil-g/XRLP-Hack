import Link from "next/link";
import { ArrowUpRight, Building2 } from "lucide-react";
import { ActionButton } from "@/components/action-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { Empty, PageHeader } from "@/components/ui/layout";
import { Tag } from "@/components/ui/tag";
import { ApiError, api } from "@/lib/api";
import { VAULT_PHASE } from "@/lib/display";
import { getSession } from "@/lib/session";
import { formatAmount, formatDate, fromCents, sharesFromUnits, toCents } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portfolio" };

export default async function PortfolioPage() {
  const session = await getSession();
  const investor = session.investor;
  if (!investor && session.directoryUnavailable) throw new ApiError("unreachable", "The account directory could not be loaded", 503);
  if (!investor) return (
    <Empty title="No investor accounts" action={<Link href="/" className="text-small text-link hover:underline">Browse verified projects</Link>}>
      No investor accounts are configured. Ask the operator to set up an account before investing.
    </Empty>
  );
  const positions = await api.portfolio(investor.address);
  const total = positions.reduce((a, p) => a + toCents(p.value), 0);

  const available = positions.filter((p) => p.phase === "redemption").reduce((sum, p) => sum + toCents(p.value), 0);
  return <div className="space-y-7">
    <AutoRefresh ms={4000} />
    <PageHeader title="My portfolio" description={`${investor.name} · Your capital, project by project.`} meta={investor.kyc ? <Tag tone="pass">KYC verified</Tag> : <Tag tone="review">KYC required</Tag>} action={<Link href="/" className="inline-flex min-h-11 items-center gap-2 rounded-control bg-action px-4 text-small font-medium text-white">Explore projects <ArrowUpRight className="size-4" aria-hidden="true" /></Link>} />
    {!investor.kyc && <div className="surface surface-pad flex flex-wrap items-center justify-between gap-4"><p className="text-small">Verify this investor account before depositing.</p><ActionButton action={{ kind: "kyc", investor: investor.address }}>Issue KYC credential</ActionButton></div>}
    <dl className="summary-strip"><div><dt>Portfolio value</dt><dd>{formatAmount(fromCents(total), { cents: true })}<small>RLUSD</small></dd></div><div><dt>Project positions</dt><dd>{positions.length}<small>in your portfolio</small></dd></div><div><dt>In redemption phase</dt><dd>{formatAmount(fromCents(available), { cents: true })}<small>RLUSD · subject to available funds</small></dd></div></dl>
    <section><div className="mb-4 flex items-center justify-between"><h2 className="text-heading">Your positions</h2><span className="text-caption text-ink-2">Value at the current share price</span></div>
      {positions.length === 0 ? <Empty title="Your first project starts here" action={<Link href="/" className="text-link">Browse verified projects</Link>}>Your investments and their progress will appear here.</Empty> : <div className="surface overflow-hidden">{positions.map((pos) => <article key={pos.projectId} className="portfolio-position">
        <div className="flex min-w-0 items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-control bg-band text-action"><Building2 className="size-5" aria-hidden="true" /></span><div className="min-w-0"><Link href={`/projects/${pos.projectId}`} className="text-small font-semibold hover:text-link">{pos.projectName}</Link><p className="mt-1 text-caption text-ink-2">{sharesFromUnits(pos.shares).toLocaleString("en-US", { maximumFractionDigits: 2 })} shares</p></div></div>
        <div><p className="tabular text-heading">{formatAmount(pos.value, { cents: true })}</p><p className="mt-1 text-caption text-ink-2">RLUSD</p></div>
        <div className="flex flex-wrap items-center justify-between gap-3"><Tag tone={pos.phase === "redemption" ? "pass" : pos.phase === "subscription" ? "info" : "neutral"}>{VAULT_PHASE[pos.phase]}</Tag>{pos.phase === "redemption" ? <ActionButton size="sm" variant="secondary" context={pos.projectName} action={{ kind: "withdraw", projectId: pos.projectId, investor: investor.address, amount: pos.value }}>Withdraw {formatAmount(pos.value)}</ActionButton> : <span className="text-caption text-ink-2">Withdrawals from {formatDate(pos.redemptionDate)}</span>}</div>
      </article>)}</div>}
    </section>
  </div>;
}
