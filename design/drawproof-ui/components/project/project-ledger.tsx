'use client'

import { LedgerLink } from '@/components/xrpl/ledger-drawer'
import { useLedgerFilter } from '@/components/xrpl/ledger-filter'
import { formatRLUSD } from '@/lib/api'
import { emptyLines, type LedgerTx } from '@/lib/mock-data'

export function ProjectLedger({ txs }: { txs: LedgerTx[] }) {
  const ctx = useLedgerFilter()
  const filter = ctx?.filter
  const rows = txs.filter((tx) => !filter?.actions || filter.actions.includes(tx.action)).sort((a, b) => b.ledgerIndex - a.ledgerIndex)

  return (
    <div className="flex flex-col gap-3">
      {filter && (
        <div className="flex items-center gap-3 text-[14px]" aria-live="polite">
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
                <th className="py-2 pr-4 font-semibold">Action</th>
                <th className="py-2 pr-4 text-right font-semibold">Amount</th>
                <th className="py-2 pr-4 font-semibold">From to To</th>
                <th className="py-2 pr-4 font-semibold">Time</th>
                <th className="py-2 text-right font-semibold">Tx</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {rows.map((tx) => (
                <tr key={tx.hash} className="h-12">
                  <td className="py-2 pr-4 whitespace-nowrap">
                    {tx.label}
                    <span className="ml-2 font-mono text-[12px] text-label">{tx.action}</span>
                  </td>
                  <td className="py-2 pr-4 text-right whitespace-nowrap">{tx.amount === null ? '—' : formatRLUSD(tx.amount)}</td>
                  <td className="py-2 pr-4 text-[14px]">
                    {tx.fromName} <span className="text-label">to</span> {tx.toName}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap text-label">{tx.time}</td>
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
