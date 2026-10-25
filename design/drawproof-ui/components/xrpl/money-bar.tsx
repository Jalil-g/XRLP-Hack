'use client'

import { useState } from 'react'
import { formatWhole, type MoneySegment } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useLedgerFilter } from './ledger-filter'

const FILL: Record<MoneySegment['location'], string> = {
  Released: 'bg-ink',
  'In escrow': 'bg-[#8FA09D]',
  'In vault': 'bg-[#8FA09D]',
  Lent: 'bg-[#8FA09D]',
  Returned: 'bg-[#C9D1CE]',
  'To raise': 'bg-hairline',
}

export function MoneyBar({ segments, total }: { segments: MoneySegment[]; total: number }) {
  const ledger = useLedgerFilter()
  const [hover, setHover] = useState<string | null>(null)
  const active = ledger?.filter?.id ?? null

  function select(seg: MoneySegment) {
    if (!ledger || seg.location === 'To raise') return
    if (active === seg.id) {
      ledger.setFilter(null)
      return
    }
    ledger.setFilter({ id: seg.id, label: seg.label, milestoneId: seg.milestoneId, actions: seg.actions })
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    document.getElementById('ledger')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }

  let offset = 0
  const placed = segments.map((s) => {
    const left = (offset / total) * 100
    const width = (s.amount / total) * 100
    offset += s.amount
    return { ...s, left, width }
  })

  return (
    <figure aria-label="Money by location" className="flex flex-col">
      <figcaption className="tnum mb-1 text-center font-mono text-[13px] text-ink">{formatWhole(total)} RLUSD</figcaption>
      <div className="relative h-3" aria-hidden>
        <div className="absolute top-1/2 right-0 left-0 h-px bg-ink" />
        {[0, ...placed.map((p) => p.left + p.width)].map((x, i) => (
          <div key={i} className="absolute top-0 h-3 w-px bg-ink" style={{ left: `calc(${x}% - ${x === 100 ? 1 : 0}px)` }} />
        ))}
      </div>
      <div className="relative mt-2 flex h-8 gap-px">
        {placed.map((seg) => {
          const show = hover === seg.id
          const interactive = seg.location !== 'To raise' && !!ledger
          return (
            <div key={seg.id} className="relative h-full" style={{ width: `${seg.width}%` }}>
              <button
                type="button"
                disabled={!interactive}
                aria-pressed={interactive ? active === seg.id : undefined}
                aria-label={`${seg.label}, ${formatWhole(seg.amount)} RLUSD, ${seg.location}${interactive ? '. Filter ledger' : ''}`}
                onMouseEnter={() => setHover(seg.id)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(seg.id)}
                onBlur={() => setHover(null)}
                onClick={() => select(seg)}
                className={cn(
                  'size-full rounded-[2px] transition-opacity disabled:cursor-default',
                  FILL[seg.location],
                  active && active !== seg.id && 'opacity-35',
                  interactive && 'cursor-pointer hover:opacity-90',
                )}
              />
              {show && (
                <div
                  role="tooltip"
                  className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 rounded-sm border border-hairline bg-white px-2.5 py-1.5 whitespace-nowrap text-[13px]"
                >
                  {seg.label} · <span className="tnum">{formatWhole(seg.amount)}</span> · {seg.location}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <div className="relative mt-1 h-12" aria-hidden>
        {placed.map((seg) => (
          <div key={seg.id} className="absolute top-0 flex flex-col pl-2" style={{ left: `${seg.left}%`, width: `${seg.width}%` }}>
            <span className="absolute top-0 left-0 h-3 w-px bg-ink" />
            <span className="tnum truncate font-mono text-[13px] text-ink">{formatWhole(seg.amount)}</span>
            <span className="truncate text-[13px] text-label">
              {seg.label} · {seg.location}
            </span>
          </div>
        ))}
      </div>
    </figure>
  )
}
