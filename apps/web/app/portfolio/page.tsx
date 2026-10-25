import Link from "next/link";
import { ActionButton } from "@/components/action-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { buttonClass } from "@/components/ui/button";
import { CapitalBar } from "@/components/ui/capital-bar";
import { Empty } from "@/components/ui/layout";
import { ApiError, api } from "@/lib/api";
import { getSession } from "@/lib/session";
import { formatAmount, formatDate, fromCents, sharesFromUnits, toCents } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portfolio" };

const browse = <Link href="/" className={buttonClass("secondary")}>Browse projects</Link>;

export default async function PortfolioPage() {
  const session = await getSession();
  const investor = session.investor;
  if (!investor && session.directoryUnavailable) throw new ApiError("unreachable", "The account directory could not be loaded", 503);
  if (!investor) return <Empty title="No investor account" action={browse} />;

  const positions = await api.portfolio(investor.address);
  const total = positions.reduce((a, p) => a + toCents(p.value), 0);
  const open = positions.filter((p) => p.phase === "redemption").reduce((a, p) => a + toCents(p.value), 0);
  const nextOpen = positions.filter((p) => p.phase !== "redemption").map((p) => p.redemptionDate).sort()[0];

  const facts = [
    { label: "Positions", value: String(positions.length) },
    { label: "Withdrawals", value: !nextOpen ? "Open" : open > 0 ? "Partly open" : `From ${formatDate(nextOpen)}` },
    { label: "KYC", value: investor.kyc ? "Verified" : "Missing" },
  ];

  return (
    <div className="space-y-8">
      <AutoRefresh ms={4000} />
      <header>
        <h1 className="text-[30px] leading-10 font-medium tracking-tight">Portfolio</h1>
        <p className="mt-1 text-small text-ink-2">Your project positions and available withdrawals.</p>
      </header>

      {positions.length === 0 ? (
        <Empty
          title="No positions"
          action={
            investor.kyc ? browse : <ActionButton action={{ kind: "kyc", investor: investor.address }}>Issue KYC credential</ActionButton>
          }
        />
      ) : (
        <>
          <section aria-label="Portfolio value" className="space-y-5 rounded-md border border-line bg-white p-5 md:p-6">
            <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-5">
              <div className="min-w-0">
                <p className="text-small font-medium text-ink-2">Value</p>
                <p className="mt-2 text-[32px] leading-10 font-medium tracking-tight tabular-nums">
                  {formatAmount(fromCents(total), { cents: true })}
                  <span className="text-[15px] font-normal tracking-normal text-ink-2"> RLUSD</span>
                </p>
              </div>
              <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
                <dl className="flex flex-wrap gap-x-10 gap-y-3">
                  {facts.map((f) => (
                    <div key={f.label} className="flex flex-col-reverse">
                      <dt className="mt-0.5 text-caption text-ink-2">{f.label}</dt>
                      <dd className="text-body font-semibold tabular-nums">{f.value}</dd>
                    </div>
                  ))}
                </dl>
                {!investor.kyc && <ActionButton action={{ kind: "kyc", investor: investor.address }}>Issue KYC credential</ActionButton>}
              </div>
            </div>
            <CapitalBar
              label="Holdings by withdrawal status"
              segments={[
                { label: "Withdrawable", cents: open, tone: "accent", keep: true },
                { label: "Locked", cents: total - open, tone: "muted" },
              ]}
            />
          </section>

          <section className="rounded-md border border-line bg-white p-5 md:p-6">
          <div className="mb-4 flex items-center justify-between gap-4"><h2 className="text-[23px] font-medium">Positions</h2>{browse}</div>
          <div aria-hidden className="hidden grid-cols-[minmax(0,1fr)_160px_180px] gap-8 border-b-2 border-[#163c35] pb-3 text-small font-medium md:grid"><span>Project</span><span className="text-right">Value · RLUSD</span><span className="text-right">Withdrawal status</span></div>
          <ul aria-label="Positions">
            {positions.map((pos) => (
              <li key={pos.projectId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-8 gap-y-3 border-b border-line py-5 last:border-0 md:grid-cols-[minmax(0,1fr)_160px_180px]">
                <Link href={`/projects/${pos.projectId}`} className="min-w-0 rounded-[8px]">
                  <span className="block truncate text-body font-semibold hover:underline">{pos.projectName}</span>
                  <span className="block text-small text-ink-2 tabular-nums">{sharesFromUnits(pos.shares).toLocaleString("en-US", { maximumFractionDigits: 2 })} shares</span>
                </Link>
                <span className="text-right text-heading font-semibold tabular-nums">{formatAmount(pos.value, { cents: true })}</span>
                <span className="col-span-2 flex md:col-span-1 md:justify-end">
                  {pos.phase === "redemption" ? (
                    <ActionButton size="sm" variant="secondary" context={pos.projectName} action={{ kind: "withdraw", projectId: pos.projectId, investor: investor.address, amount: pos.value }}>
                      Withdraw {formatAmount(pos.value)}
                    </ActionButton>
                  ) : (
                    <span className="text-small text-ink-2">Opens {formatDate(pos.redemptionDate)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          </section>
        </>
      )}
    </div>
  );
}
