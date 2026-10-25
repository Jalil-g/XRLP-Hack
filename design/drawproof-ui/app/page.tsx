import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { OpenProjectCard } from '@/components/investor/project-cards'
import { RecentActivity } from '@/components/investor/recent-activity'
import { buttonVariants } from '@/components/ui/button'
import { CopyButton } from '@/components/xrpl/copy-button'
import { daysUntil, formatRLUSD, getInvestorTransactions, getPortfolio, getProjects, getWallet } from '@/lib/api'
import { memberSince } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

export default function HomePage() {
  const wallet = getWallet('investor')
  const { totals } = getPortfolio(wallet.name)
  const open = getProjects().filter((p) => p.status === 'Funding')
  const closing = open.map((p) => ({ p, days: daysUntil(p.closes) })).find(({ days }) => days >= 0 && days <= 30)
  const recent = getInvestorTransactions(wallet.name).slice(0, 3)

  return (
    <div className="container-app py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <h1 className="t-page">Welcome back, {wallet.name.split(' ')[0]}</h1>
        <p className="t-label">Member since {memberSince}</p>
      </div>

      {closing && (
        <div className="mb-8 flex items-center justify-between gap-4 rounded-md bg-ink px-6 py-4">
          <p className="text-[17px] text-white">
            {closing.p.name} closes in {closing.days} days
          </p>
          <Link href={`/projects/${closing.p.slug}`} className={cn(buttonVariants({ variant: 'secondary' }), 'border-white')}>
            View project
          </Link>
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-labelledby="open-projects" className="flex flex-col gap-4">
          <div className="flex items-center gap-3">
            <h2 id="open-projects" className="t-section">
              Open projects
            </h2>
            <Link
              href="/invest"
              aria-label="All projects"
              className="inline-flex size-8 items-center justify-center rounded-sm border border-control bg-white hover:bg-accent"
            >
              <ArrowRight className="size-4" aria-hidden />
            </Link>
          </div>
          {open.length ? (
            open.map((p) => <OpenProjectCard key={p.slug} project={p} />)
          ) : (
            <p className="panel p-6 t-label">No open projects right now.</p>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <section aria-labelledby="rail-portfolio" className="panel p-5">
            <div className="flex items-center justify-between">
              <h2 id="rail-portfolio" className="t-card">
                Portfolio
              </h2>
              <Link href="/portfolio" className="text-[14px] underline underline-offset-4 hover:no-underline">
                See details
              </Link>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-4">
              <div>
                <dt className="t-label">Invested</dt>
                <dd className="tnum text-[24px] leading-8">{formatRLUSD(totals.invested)}</dd>
              </div>
              <div className="border-l border-hairline pl-4">
                <dt className="t-label">Interest earned</dt>
                <dd className="tnum text-[24px] leading-8">{formatRLUSD(totals.interest)}</dd>
              </div>
            </dl>
          </section>

          <section aria-labelledby="rail-wallet" className="panel p-5">
            <h2 id="rail-wallet" className="t-card">
              Wallet
            </h2>
            <p className="mt-3 t-label">RLUSD balance</p>
            <p className="tnum text-[32px] leading-10">{formatRLUSD(wallet.rlusd)}</p>
            <div className="mt-3 flex items-center justify-between gap-2 border-t border-hairline pt-3">
              <code className="truncate font-mono text-[13px]" title={wallet.address}>
                {wallet.address}
              </code>
              <CopyButton value={wallet.address} label="Copy address" />
            </div>
            <span className="mt-2 inline-flex h-6 items-center rounded-sm bg-ok-bg px-2 text-[13px] font-medium text-ok">{wallet.credential}</span>
          </section>

          <section aria-labelledby="rail-activity" className="panel p-5">
            <h2 id="rail-activity" className="t-card">
              Recent activity
            </h2>
            <RecentActivity
              items={recent.map((r) => ({ hash: r.tx.hash, action: r.action, date: r.date, signed: r.signed }))}
            />
          </section>
        </aside>
      </div>
    </div>
  )
}
