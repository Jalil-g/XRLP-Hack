import type { Metadata } from 'next'
import { BuilderProjectCard, NewProjectCard } from '@/components/builder/builder-project-cards'
import { NextActionBand } from '@/components/builder/next-action-band'
import { RecentPayouts } from '@/components/builder/payouts-view'
import { RepaySheet } from '@/components/builder/repay-sheet'
import { StatusTag } from '@/components/status-tag'
import { CopyButton } from '@/components/xrpl/copy-button'
import { formatRLUSD, getActiveBuilderProjects, getNextPayment, getWallet } from '@/lib/api'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Builder home' }

export default function BuilderHomePage() {
  const wallet = getWallet('builder')
  const active = getActiveBuilderProjects()
  const due = getNextPayment()

  return (
    <div className="container-app py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <h1 className="t-page">{wallet.name}</h1>
        <span className="inline-flex h-7 items-center rounded-sm border border-ok px-2.5 text-[14px] text-ok">{wallet.credential}</span>
      </div>

      <NextActionBand />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section aria-labelledby="builder-projects" className="flex flex-col gap-4">
          <h2 id="builder-projects" className="t-section">
            Projects
          </h2>
          {active.map((p) => (
            <BuilderProjectCard key={p.slug} project={p} />
          ))}
          <NewProjectCard />
        </section>

        <aside className="flex flex-col gap-4">
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
            <div className="mt-2 flex items-center justify-between">
              <span className="t-label">Trust line</span>
              <StatusTag status="RLUSD ready" />
            </div>
          </section>

          <section aria-labelledby="rail-payment" className="panel p-5">
            <h2 id="rail-payment" className="t-card">
              Next payment
            </h2>
            <dl className="mt-3 flex flex-col gap-1">
              <dt className="sr-only">Amount due</dt>
              <dd className="tnum text-[32px] leading-10">{formatRLUSD(due.amount)} RLUSD</dd>
              <dt className="sr-only">Due date</dt>
              <dd className="t-label">
                Due {due.due} · {due.basis}
              </dd>
            </dl>
            <RepaySheet className="mt-4 w-full" />
          </section>

          <section aria-labelledby="rail-payouts" className="panel p-5">
            <div className="flex items-center justify-between">
              <h2 id="rail-payouts" className="t-card">
                Recent payouts
              </h2>
              <Link href="/builder/payouts" className="text-[14px] underline underline-offset-4 hover:no-underline">
                See all
              </Link>
            </div>
            <RecentPayouts />
          </section>
        </aside>
      </div>
    </div>
  )
}
