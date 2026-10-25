'use client'

import { ChevronDown } from 'lucide-react'
import { Fragment, useState } from 'react'
import { ChecksPanel } from '@/components/checks/checks-panel'
import { PhotoCompare } from '@/components/checks/photo-compare'
import { StatusTag } from '@/components/status-tag'
import { formatWhole } from '@/lib/api'
import type { CheckRun, Milestone, PhotoMatch } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

export function MilestoneTable({
  milestones,
  runs,
  releasedOn,
  match,
  defaultOpen,
}: {
  milestones: Milestone[]
  runs: Record<string, CheckRun>
  releasedOn: Record<string, string>
  match: PhotoMatch
  defaultOpen?: string
}) {
  const [open, setOpen] = useState<string | null>(defaultOpen ?? null)

  return (
    <div className="overflow-x-auto">
      <table className="tnum w-full text-left text-[15px]">
        <thead>
          <tr className="border-b-2 border-ink">
            <th className="py-2 pr-4 font-semibold">Milestone</th>
            <th className="py-2 pr-4 text-right font-semibold">Amount</th>
            <th className="py-2 pr-4 font-semibold">Escrow</th>
            <th className="py-2 pr-4 font-semibold">Status</th>
            <th className="py-2 pr-4 font-semibold">Released on</th>
            <th className="w-8 py-2">
              <span className="sr-only">Expand</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {milestones.map((m) => {
            const expanded = open === m.id
            return (
              <Fragment key={m.id}>
                <tr
                  className={cn('h-14 cursor-pointer border-b border-hairline hover:bg-paper', expanded && 'bg-paper')}
                  onClick={() => setOpen(expanded ? null : m.id)}
                >
                  <td className="py-2 pr-4">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={`ms-${m.id}`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setOpen(expanded ? null : m.id)
                      }}
                      className="flex items-center gap-3 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ink"
                    >
                      <span className="flex size-6 items-center justify-center border border-ink bg-white font-mono text-[12px]">{m.number}</span>
                      {m.name}
                    </button>
                  </td>
                  <td className="py-2 pr-4 text-right whitespace-nowrap">{formatWhole(m.amount)}</td>
                  <td className="py-2 pr-4 font-mono text-[13px] whitespace-nowrap">{m.escrowSequence ? `seq ${m.escrowSequence}` : '—'}</td>
                  <td className="py-2 pr-4">
                    <StatusTag status={m.status} />
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap text-label">{releasedOn[m.id] ?? '—'}</td>
                  <td className="py-2">
                    <ChevronDown className={cn('size-4 motion-safe:transition-transform', expanded && 'rotate-180')} aria-hidden />
                  </td>
                </tr>
                {expanded && (
                  <tr id={`ms-${m.id}`} className="border-b border-hairline">
                    <td colSpan={6} className="py-5">
                      <MilestoneDetail milestone={m} run={runs[m.id]} match={match} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function MilestoneDetail({ milestone, run, match }: { milestone: Milestone; run?: CheckRun; match: PhotoMatch }) {
  const [done, setDone] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)

  if (!run)
    return (
      <p className="t-label">
        {milestone.status === 'Released'
          ? `Checks passed and ${formatWhole(milestone.amount)} RLUSD was released to the builder.`
          : `No checks yet. Due ${milestone.due}.`}
      </p>
    )

  const duplicate = run.checks.find((c) => c.state === 'fail' && c.compare)
  return (
    <div className="flex flex-col gap-5">
      <ChecksPanel run={run} amount={milestone.amount} mode="idle" runToken={1} onDone={() => setDone(true)} />
      {duplicate && done && (
        <section aria-label="Duplicate photo" className="panel flex flex-col gap-4 p-5 md:flex-row md:items-end">
          <div className="flex flex-1 flex-col gap-3">
            <p className="text-[15px]">
              {duplicate.name}
              <span className="ml-2 text-bad">Failed</span>
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Thumb src={match.submitted.src} caption={`Maple St, ${match.submitted.file}`} />
              <Thumb src={match.archive.src} caption={match.archive.project} flipped />
            </div>
            <button type="button" onClick={() => setCompareOpen(true)} className="self-start text-[14px] underline underline-offset-4 hover:no-underline">
              Compare photos
            </button>
          </div>
          <div className="md:w-56 md:text-right">
            <p className="t-label">Outcome</p>
            <p className="tnum text-[22px] leading-7">{formatWhole(milestone.amount)} RLUSD</p>
            <p className="text-[15px]">stays in escrow</p>
          </div>
          <PhotoCompare open={compareOpen} onOpenChange={setCompareOpen} />
        </section>
      )}
    </div>
  )
}

function Thumb({ src, caption, flipped }: { src: string; caption: string; flipped?: boolean }) {
  return (
    <figure className="flex flex-col gap-1.5">
      <div className="relative aspect-[4/3] overflow-hidden rounded-sm border-2 border-bad bg-ink">
        <img src={src} alt={caption} className={cn('size-full object-cover', flipped && '-scale-x-100')} />
        <div className="absolute inset-0 bg-ink/40" aria-hidden />
        <span className="absolute right-2 bottom-1.5 t-caption text-white/80">Sample photo</span>
      </div>
      <figcaption className="text-[13px]">{caption}</figcaption>
    </figure>
  )
}
