'use client'

import Link from 'next/link'
import { RecentActivity, signedRLUSD } from '@/components/investor/recent-activity'
import { LedgerLink } from '@/components/xrpl/ledger-drawer'
import { formatRLUSD, getBuilderPayouts, getReleasedToDate, toPayoutRow } from '@/lib/api'
import { useBuilder } from '@/lib/builder-store'
import { cn } from '@/lib/utils'

function usePayouts() {
  const extra = useBuilder((s) => s.txs)
  return [...extra.map(toPayoutRow), ...getBuilderPayouts()]
}

export function RecentPayouts() {
  const rows = usePayouts()
    .filter((r) => r.tx.action === 'EscrowFinish')
    .slice(0, 3)
  return <RecentActivity items={rows.map((r) => ({ hash: r.tx.hash, action: `${r.projectName} · ${r.milestone}`, date: r.date, signed: r.signed }))} />
}

export function PayoutsView() {
  const rows = usePayouts()
  return (
    <>
      <div className="mb-6 border-t border-hairline pt-3">
        <p className="t-label">Released to date</p>
        <p className="tnum text-[32px] leading-10">{formatRLUSD(getReleasedToDate())} RLUSD</p>
      </div>
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[720px] text-[15px]">
          <caption className="sr-only">Payouts and loan payments</caption>
          <thead>
            <tr className="border-b border-hairline text-left">
              {['Date', 'Project', 'Milestone', 'Amount', 'Tx'].map((h) => (
                <th key={h} scope="col" className={cn('h-11 px-5 t-label font-normal', h === 'Amount' && 'text-right')}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {rows.map((r) => (
              <tr key={r.tx.hash}>
                <td className="h-12 px-5 whitespace-nowrap">{r.date}</td>
                <td className="px-5">
                  <Link href={`/builder/projects/${r.projectSlug}`} className="underline-offset-4 hover:underline">
                    {r.projectName}
                  </Link>
                </td>
                <td className="px-5">{r.milestone}</td>
                <td className={cn('tnum px-5 text-right whitespace-nowrap', r.signed < 0 && 'text-label')}>{signedRLUSD(r.signed)} RLUSD</td>
                <td className="px-5">
                  <LedgerLink tx={r.tx} short />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
