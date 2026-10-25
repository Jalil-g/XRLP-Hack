'use client'

import { LedgerLink } from '@/components/xrpl/ledger-drawer'
import { formatRLUSD } from '@/lib/api'
import { emptyLines } from '@/lib/mock-data'

export function signedRLUSD(n: number) {
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${formatRLUSD(Math.abs(n))}`
}

export function RecentActivity({ items }: { items: { hash: string; action: string; date: string; signed: number }[] }) {
  if (!items.length) return <p className="mt-3 t-label">{emptyLines.transactions}</p>
  return (
    <ul className="mt-2 divide-y divide-hairline">
      {items.map((item) => (
        <li key={item.hash} className="flex items-start justify-between gap-3 py-3">
          <div className="flex flex-col">
            <span className="text-[15px]">{item.action}</span>
            <span className="t-caption text-label">{item.date}</span>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            <span className="tnum text-[15px]">{signedRLUSD(item.signed)}</span>
            <LedgerLink hash={item.hash} short />
          </div>
        </li>
      ))}
    </ul>
  )
}
