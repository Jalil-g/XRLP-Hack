'use client'

import Link from 'next/link'
import { useState } from 'react'
import { StatusTag } from '@/components/status-tag'
import { Button } from '@/components/ui/button'
import { MiniLocationBar } from '@/components/xrpl/location-bar'
import { SigningFlow } from '@/components/xrpl/signing-flow'
import { formatRLUSD, formatWhole } from '@/lib/api'
import { type Position, type Project, type Wallet } from '@/lib/mock-data'
import { RecentActivity } from './recent-activity'

type Row = Position & { project: Project; released: number; inEscrow: number; inVault: number; value: number }

export function PortfolioView({
  rows,
  totals,
  wallet,
  recent,
}: {
  rows: Row[]
  totals: { invested: number; value: number; interest: number }
  wallet: Wallet
  recent: { hash: string; action: string; date: string; signed: number }[]
}) {
  const [withdrawing, setWithdrawing] = useState<Row | null>(null)
  const [withdrawn, setWithdrawn] = useState<Record<string, boolean>>({})

  return (
    <div className="container-app py-8">
      <h1 className="t-page mb-6">Portfolio</h1>

      <dl className="panel grid grid-cols-1 divide-y divide-hairline sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {(
          [
            ['Invested', totals.invested],
            ['Value', totals.value],
            ['Interest earned', totals.interest],
          ] as const
        ).map(([label, n]) => (
          <div key={label} className="p-5">
            <dt className="t-label">{label}</dt>
            <dd className="tnum text-[32px] leading-10">
              {formatRLUSD(n)} <span className="text-[15px] text-label">RLUSD</span>
            </dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="positions" className="mt-12">
        <h2 id="positions" className="t-section mb-4">
          Positions
        </h2>
        {rows.length === 0 ? (
          <p className="panel p-6 t-label">No positions yet. Deposit into an open project to start.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="tnum w-full text-left text-[15px]">
              <thead>
                <tr className="border-b-2 border-ink">
                  <th className="py-2 pr-4 font-semibold">Project</th>
                  <th className="py-2 pr-4 text-right font-semibold">Invested</th>
                  <th className="py-2 pr-4 text-right font-semibold">Interest</th>
                  <th className="py-2 pr-4 font-semibold">Where the money is</th>
                  <th className="py-2 pr-4 font-semibold">Status</th>
                  <th className="py-2 text-right font-semibold">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rows.map((r) => {
                  const p = r.project
                  const canWithdraw = r.withdrawable > 0 && !withdrawn[r.projectSlug]
                  const parts =
                    p.status === 'Funding'
                      ? [
                          { amount: r.inVault, location: 'In vault' as const },
                          { amount: p.principal - r.inVault, location: 'To raise' as const },
                        ]
                      : [
                          { amount: r.released, location: 'Released' as const },
                          { amount: r.inEscrow, location: 'In escrow' as const },
                        ]
                  const summary =
                    p.status === 'Funding' ? `${formatWhole(r.inVault)} in vault` : `${formatWhole(r.released)} released · ${formatWhole(r.inEscrow)} in escrow`
                  return (
                    <tr key={r.projectSlug} className="h-16">
                      <td className="py-2 pr-4">
                        <Link href={`/projects/${p.slug}`} className="underline-offset-4 hover:underline">
                          {p.name}
                        </Link>
                        <p className="text-[13px] text-label">
                          {formatWhole(r.shares)} shares · {p.ratePct.toFixed(2)}%
                        </p>
                      </td>
                      <td className="py-2 pr-4 text-right whitespace-nowrap">{formatRLUSD(r.invested)}</td>
                      <td className="py-2 pr-4 text-right whitespace-nowrap">{formatRLUSD(r.interest)}</td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-3">
                          <MiniLocationBar parts={parts} total={p.principal} />
                          <span className="text-[13px] whitespace-nowrap text-label">{summary}</span>
                        </div>
                      </td>
                      <td className="py-2 pr-4">
                        <StatusTag status={p.status} />
                      </td>
                      <td className="py-2 text-right">
                        {canWithdraw ? (
                          <Button variant="secondary" size="sm" onClick={() => setWithdrawing(r)}>
                            Withdraw {formatWhole(r.withdrawable)}
                          </Button>
                        ) : (
                          <span className="text-[13px] text-label">{withdrawn[r.projectSlug] ? 'Withdrawn' : 'Locked until repaid'}</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="recent" className="mt-12">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="recent" className="t-section">
            Recent transactions
          </h2>
          <Link href="/transactions" className="text-[14px] underline underline-offset-4 hover:no-underline">
            All transactions
          </Link>
        </div>
        <RecentActivity items={recent} />
      </section>

      {withdrawing && (
        <SigningFlow
          open={!!withdrawing}
          onOpenChange={(o) => !o && setWithdrawing(null)}
          onConfirmed={() => setWithdrawn((w) => ({ ...w, [withdrawing.projectSlug]: true }))}
          request={{
            title: 'Review withdrawal',
            meta: withdrawing.project.name,
            from: { name: `${withdrawing.project.name} vault`, address: withdrawing.project.vaultId },
            to: { name: wallet.name, address: wallet.address },
            amount: withdrawing.withdrawable,
            ledgerAction: 'Vault withdraw',
            txAction: 'VaultWithdraw',
            txLabel: 'Withdrawal',
            actionLabel: `Withdraw ${formatWhole(withdrawing.withdrawable)} RLUSD`,
            projectSlug: withdrawing.projectSlug,
            investor: wallet.name,
          }}
        />
      )}
    </div>
  )
}
