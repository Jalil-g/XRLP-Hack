'use client'

import { ChevronDown } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useRef } from 'react'
import { ChecksPanel } from '@/components/checks/checks-panel'
import { EvidencePhoto } from '@/components/evidence-photo'
import { PropertyRows } from '@/components/property-rows'
import { StatusTag } from '@/components/status-tag'
import { formatWhole } from '@/lib/api'
import type { CheckRun, EvidencePhoto as Photo, Milestone } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

export function MilestoneList({
  milestones,
  photos,
  runs,
}: {
  milestones: Milestone[]
  photos: Record<string, Photo>
  runs: Record<string, CheckRun>
}) {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const open = params.get('milestone')
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  function toggle(id: string) {
    const next = new URLSearchParams(params)
    if (open === id) next.delete('milestone')
    else next.set('milestone', id)
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }

  function onKey(e: React.KeyboardEvent, i: number) {
    const map: Record<string, number> = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: milestones.length - 1 }
    if (!(e.key in map)) return
    e.preventDefault()
    const target = Math.max(0, Math.min(milestones.length - 1, map[e.key]))
    buttons.current[target]?.focus()
  }

  return (
    <ol className="flex flex-col">
      {milestones.map((m, i) => {
        const expanded = open === m.id
        const last = i === milestones.length - 1
        const flagged = runs[m.id]?.checks.find((c) => c.state === 'fail' && c.compare)
        return (
          <li key={m.id} className="relative flex gap-5">
            <div className="flex flex-col items-center pt-3" aria-hidden>
              <span className="flex size-7 items-center justify-center border border-ink bg-white font-mono text-[13px]">{m.number}</span>
              {!last && <span className="w-px flex-1 bg-ink" />}
            </div>
            <div className={cn('min-w-0 flex-1 border-b border-hairline', last && 'border-b-0')}>
              <h3>
                <button
                  ref={(el) => {
                    buttons.current[i] = el
                  }}
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={`ms-${m.id}`}
                  onClick={() => toggle(m.id)}
                  onKeyDown={(e) => onKey(e, i)}
                  className="flex min-h-14 w-full items-center gap-4 rounded-sm py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ink"
                >
                  <span className="flex-1 text-[17px]">{m.name}</span>
                  <StatusTag status={m.status} />
                  <span className="tnum w-24 text-right text-[16px]">{formatWhole(m.amount)}</span>
                  <span className="w-20 text-[14px] text-label">{m.location}</span>
                  <ChevronDown className={cn('size-4 motion-safe:transition-transform', expanded && 'rotate-180')} aria-hidden />
                </button>
              </h3>
              {expanded && (
                <div id={`ms-${m.id}`} className="flex flex-col gap-6 pb-6">
                  <PropertyRows
                    rows={[
                      { label: 'Due', value: m.due },
                      { label: 'Money', value: m.location },
                      ...(m.escrowSequence ? [{ label: 'Escrow sequence', value: <span className="t-mono">{m.escrowSequence}</span> }] : []),
                    ]}
                  />
                  {runs[m.id] && <ChecksPanel run={runs[m.id]} amount={m.amount} />}
                  {m.evidence.length > 0 && (
                    <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
                      {m.evidence.map((f) => photos[f] && <EvidencePhoto key={f} photo={photos[f]} flagged={flagged && f === 'IMG_2231.jpg'} />)}
                    </div>
                  )}
                </div>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
