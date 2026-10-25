'use client'

import { formatWhole, type MoneySegment } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useLedgerFilter } from './ledger-filter'

export const LOCATION_FILL: Record<MoneySegment['location'], string> = {
  Released: 'bg-ok',
  'In escrow': 'bg-ink',
  'In vault': 'bg-ink',
  Lent: 'bg-ink',
  Returned: 'bg-[#8FA09D]',
  'To raise': 'bg-hairline',
}

export function LocationBar({ segments, total }: { segments: MoneySegment[]; total: number }) {
  const ledger = useLedgerFilter()
  const active = ledger?.filter?.id ?? null

  function select(seg: MoneySegment) {
    if (!ledger || !seg.actions) return
    if (active === seg.id) {
      ledger.setFilter(null)
      return
    }
    ledger.setFilter({ id: seg.id, label: seg.label, actions: seg.actions })
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.getElementById('ledger')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }

  let offset = 0
  const placed = segments
    .filter((s) => s.amount > 0)
    .map((s) => {
      const left = (offset / total) * 100
      const width = (s.amount / total) * 100
      offset += s.amount
      return { ...s, left, width }
    })

  return (
    <figure aria-label="Where the money is" className="flex flex-col">
      <div className="relative flex h-5 items-center" aria-hidden>
        <span className="absolute left-0 h-3 w-px bg-ink" />
        <span className="absolute right-0 h-3 w-px bg-ink" />
        <span className="h-px flex-1 bg-ink" />
        <span className="tnum bg-white px-2 font-mono text-[12px] text-ink">{formatWhole(total)} RLUSD</span>
        <span className="h-px flex-1 bg-ink" />
      </div>
      <div className="mt-2 flex h-2.5 gap-px">
        {placed.map((seg) => {
          const interactive = !!seg.actions && !!ledger
          return (
            <button
              key={seg.id}
              type="button"
              disabled={!interactive}
              aria-pressed={interactive ? active === seg.id : undefined}
              aria-label={`${seg.label}, ${formatWhole(seg.amount)} RLUSD${interactive ? '. Show in ledger' : ''}`}
              onClick={() => select(seg)}
              style={{ width: `${seg.width}%` }}
              className={cn(
                'h-full outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 disabled:cursor-default',
                LOCATION_FILL[seg.location],
                active && active !== seg.id && 'opacity-30',
                interactive && 'cursor-pointer hover:opacity-80',
              )}
            />
          )
        })}
      </div>
      <div className="mt-2 flex">
        {placed.map((seg) => (
          <div key={seg.id} className="flex min-w-0 flex-col border-l border-ink pl-2" style={{ width: `${seg.width}%` }}>
            <span className="tnum truncate text-[15px] text-ink">{formatWhole(seg.amount)}</span>
            <span className="flex items-center gap-1.5 truncate text-[13px] text-label">
              <span className={cn('size-2 shrink-0', LOCATION_FILL[seg.location])} aria-hidden />
              {seg.label}
            </span>
          </div>
        ))}
      </div>
    </figure>
  )
}

export function MiniLocationBar({ parts, total }: { parts: { amount: number; location: MoneySegment['location'] }[]; total: number }) {
  return (
    <div className="flex h-1.5 w-24 gap-px bg-hairline" aria-hidden>
      {parts
        .filter((p) => p.amount > 0)
        .map((p, i) => (
          <span key={i} className={LOCATION_FILL[p.location]} style={{ width: `${(p.amount / total) * 100}%` }} />
        ))}
    </div>
  )
}
