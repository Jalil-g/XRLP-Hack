// Investor portfolio. Functional baseline — see TODOs for planned polish.
import Link from "next/link";
import { Lock, TrendingUp, Undo2, Unlock, Wallet } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { ChainTimeline } from "@/components/project/chain-timeline";
import { StatTile } from "@/components/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StackedBar } from "@/components/ui/progress";
import { getInvestorPortfolio } from "@/lib/api";
import { projectStatus } from "@/lib/display";
import { getSession } from "@/lib/session";
import { formatAmount, toCents } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Portfolio" };

// TODO(portfolio): share-value sparkline per position (needs historical share price from core).
// TODO(portfolio): VaultWithdraw action for idle / returned funds.
export default async function PortfolioPage() {
  const session = await getSession();
  const pf = await getInvestorPortfolio(session.investor.address);
  const gain = toCents(pf.totals.value) - toCents(pf.totals.deposited);
  const projectNames = Object.fromEntries(pf.positions.map((p) => [p.summary.project.id, p.summary.project.name]));
  const milestoneTitles = Object.fromEntries(pf.positions.flatMap((p) => p.summary.project.milestones.map((m) => [m.id, m.title])));

  return (
    <div className="space-y-8">
      <AutoRefresh ms={4000} />
      <div>
        <div className="text-[13px] text-muted">Investor portfolio</div>
        <h1 className="mt-1 text-[28px] font-semibold tracking-tight">{pf.investor.name}</h1>
        <p className="mt-1 text-[13px] text-muted">{pf.investor.detail}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Position value" value={formatAmount(pf.totals.value, { cents: true })} unit="RLUSD" icon={Wallet} hint={`${formatAmount(pf.totals.deposited)} deposited`} />
        <StatTile label="Interest earned" value={`${gain >= 0 ? "+" : ""}${formatAmount(gain / 100, { cents: true })}`} unit="RLUSD" icon={TrendingUp} hint="Reflected in vault share price" />
        <StatTile label="Locked in escrow" value={formatAmount(pf.totals.escrowed)} unit="RLUSD" icon={Lock} hint="Your pro-rata share" />
        <StatTile
          label="Released · returned"
          value={`${formatAmount(pf.totals.released)} · ${formatAmount(pf.totals.returned)}`}
          icon={Unlock}
          hint="At work with builders · back in vault"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div>
              <CardTitle>Positions</CardTitle>
              <CardDescription>Where your share of each vault sits right now.</CardDescription>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ul className="divide-y divide-line">
              {pf.positions.map((pos) => {
                const status = projectStatus(pos.summary.project);
                const segs = [
                  { label: "Awaiting close", value: toCents(pos.exposure.awaitingClose), className: "bg-sky-400" },
                  { label: "Escrowed", value: toCents(pos.exposure.escrowed), className: "bg-lock" },
                  { label: "Released", value: toCents(pos.exposure.released), className: "bg-ok" },
                  { label: "Returned", value: toCents(pos.exposure.returned), className: "bg-emerald-300" },
                ];
                return (
                  <li key={pos.summary.project.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Link href={`/projects/${pos.summary.project.id}`} className="text-[15px] font-semibold hover:text-brand">
                          {pos.summary.project.name}
                        </Link>
                        <Badge tone={status.tone} dot>
                          {status.label}
                        </Badge>
                      </div>
                      <div className="text-right">
                        <div className="tabular text-[15px] font-semibold">{formatAmount(pos.value, { cents: true })} RLUSD</div>
                        <div className="text-xs text-muted">
                          {Number(pos.shares).toLocaleString("en-US", { maximumFractionDigits: 2 })} shares @ {pos.sharePrice} ·{" "}
                          {(pos.ownership * 100).toFixed(1)}% of vault
                        </div>
                      </div>
                    </div>
                    <StackedBar className="mt-3" total={segs.reduce((a, s) => a + s.value, 0)} segments={segs} />
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                      {segs.map((s) => (
                        <span key={s.label}>
                          {s.label}: <span className="tabular font-medium text-ink-2">{formatAmount(s.value / 100)}</span>
                        </span>
                      ))}
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div>
              <CardTitle>Live activity</CardTitle>
              <CardDescription>On-chain events across your projects.</CardDescription>
            </div>
            <Undo2 className="size-4 text-faint" />
          </CardHeader>
          <CardContent className="max-h-[640px] overflow-y-auto">
            <ChainTimeline events={pf.events} directory={pf.directory} milestoneTitles={milestoneTitles} showProject={projectNames} limit={25} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
