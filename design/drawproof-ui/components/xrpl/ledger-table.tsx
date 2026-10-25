'use client'

import { formatRLUSD } from '@/lib/api'
import { emptyLines, type LedgerTx } from '@/lib/mock-data'
import { LedgerLink } from './ledger-drawer'
import { useLedgerFilter } from './ledger-filter'

export function LedgerTable({
  txs,
  milestoneNames = {},
  showProject = false,
  projectNames = {},
}: {
  txs: LedgerTx[]
  milestoneNames?: Record<string, string>
  showProject?: boolean
  projectNames?: Record<string, string>
}) {
  const ctx = useLedgerFilter()
  const filter = ctx?.filter
  const rows = [...txs]
    .filter((tx) => {
      if (!filter) return true
      if (filter.milestoneId) return tx.milestoneId === filter.milestoneId
      if (filter.actions) return filter.actions.includes(tx.action)
      return true
    })
    .reverse()

  return (
    <div className="flex flex-col gap-3">
      {filter && (
        <div className="flex items-center gap-3 text-[14px]">
          <span className="t-label">Showing {filter.label}</span>
          <button type="button" onClick={() => ctx?.setFilter(null)} className="underline underline-offset-4 hover:no-underline">
            Clear filter
          </button>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="py-6 text-center t-label">{emptyLines.transactions}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="tnum w-full text-left text-[15px]">
            <thead>
              <tr className="border-b-2 border-ink">
                <th className="py-2 pr-4 font-semibold">Time</th>
                <th className="py-2 pr-4 font-semibold">Action</th>
                <th className="py-2 pr-4 font-semibold">{showProject ? 'Project' : 'Milestone'}</th>
                <th className="py-2 pr-4 font-semibold">From</th>
                <th className="py-2 pr-4 text-right font-semibold">Amount</th>
                <th className="py-2 text-right font-semibold">Proof</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {rows.map((tx) => (
                <tr key={tx.hash} className="h-12">
                  <td className="py-2 pr-4 whitespace-nowrap text-label">{tx.time}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {tx.label}
                    <span className="ml-2 font-mono text-[12px] text-label">{tx.action}</span>
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {showProject ? projectNames[tx.projectSlug] : tx.milestoneId ? milestoneNames[tx.milestoneId] : '—'}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">{tx.fromName}</td>
                  <td className="py-2 pr-4 text-right whitespace-nowrap">{tx.amount === null ? '—' : formatRLUSD(tx.amount)}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <LedgerLink tx={tx} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
