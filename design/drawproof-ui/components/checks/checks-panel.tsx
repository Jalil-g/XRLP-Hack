'use client'

import { Check as CheckIcon, Minus, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatWhole } from '@/lib/api'
import { loadingLines, type Check, type CheckRun } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import { LedgerLink } from '@/components/xrpl/ledger-drawer'
import { Chip } from '@/components/status-tag'
import { PhotoCompare } from './photo-compare'

export type PanelMode = 'resolved' | 'idle' | 'waiting-audit' | 'queued'

function sortChecks(checks: Check[], failuresFirst: boolean) {
  if (failuresFirst) return [...checks.filter((c) => c.state === 'fail'), ...checks.filter((c) => c.state !== 'fail')]
  const [audit, ...rest] = checks
  return [audit, ...rest.filter((c) => c.state === 'fail'), ...rest.filter((c) => c.state !== 'fail')]
}

export function ChecksPanel({
  run,
  amount,
  mode = 'resolved',
  runToken = 0,
  released = false,
  onDone,
  action,
  label = 'Framing',
  failuresFirst = false,
  failDetail,
}: {
  run: CheckRun
  amount: number
  mode?: PanelMode
  runToken?: number
  released?: boolean
  onDone?: (state: 'pass' | 'fail') => void
  action?: React.ReactNode
  label?: string
  failuresFirst?: boolean
  failDetail?: (check: Check, openCompare: () => void) => React.ReactNode
}) {
  const rows = useMemo(() => sortChecks(run.checks, failuresFirst), [run, failuresFirst])
  const waiting = mode === 'waiting-audit' || mode === 'queued'
  const total = rows.length + 1
  const [resolved, setResolved] = useState(mode === 'resolved' ? total : 0)
  const [compareOpen, setCompareOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  useEffect(() => {
    if (mode !== 'resolved') setResolved(0)
  }, [mode, run])

  useEffect(() => {
    if (runToken === 0) return
    if (timer.current) clearInterval(timer.current)
    const finalState = run.verdict.state === 'fail' ? 'fail' : 'pass'
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setResolved(total)
      onDoneRef.current?.(finalState)
      return
    }
    setResolved(0)
    let n = 0
    timer.current = setInterval(() => {
      n += 1
      setResolved(n)
      if (n >= total) {
        clearInterval(timer.current!)
        onDoneRef.current?.(finalState)
      }
    }, 110)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [runToken, run, total])

  const running = runToken > 0 && resolved < total && !waiting
  const done = resolved >= total && !waiting
  const failures = rows.filter((c) => c.state === 'fail').length

  let outcome = 'Waiting for checks'
  if (mode === 'waiting-audit') outcome = 'Waiting for audit'
  else if (mode === 'queued') outcome = 'Queued'
  else if (running) outcome = loadingLines.checks
  else if (done) outcome = released ? 'Released' : failures > 0 ? `Failed: ${failures} check${failures > 1 ? 's' : ''}` : 'Checks passed'

  const outcomeTone = done ? (released || failures === 0 ? 'text-ok' : 'text-bad') : 'text-ink'

  return (
    <section aria-labelledby="checks-outcome" className="panel">
      <div className="flex items-center justify-between gap-4 border-b border-hairline px-6 py-5">
        <div className="flex flex-col">
          <p id="checks-outcome" aria-live="polite" className={cn('t-card', outcomeTone)}>
            {outcome}
          </p>
          <p className="t-label">
            {label} · {total} checks
          </p>
        </div>
        <div className="flex items-center gap-5">
          <p className="tnum t-card">{formatWhole(amount)} RLUSD</p>
          {action}
        </div>
      </div>
      <ul className="divide-y divide-hairline">
        {rows.map((check, i) => {
          const state = waiting ? 'pending' : i < resolved ? check.state : 'pending'
          const detail = state === 'fail' && failDetail ? failDetail(check, () => setCompareOpen(true)) : null
          return (
            <li key={check.id} className="flex min-h-14 flex-wrap items-center gap-4 px-6 py-3">
              <Glyph state={state} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2 text-[15px]">
                  {check.name}
                  {check.ai && <Chip className="h-5 px-1.5 text-[12px]">AI</Chip>}
                </span>
                <span className="truncate text-[14px] text-label">
                  {state === 'pending' ? (mode === 'queued' ? 'Queued' : 'Not run') : check.reason}
                </span>
              </div>
              {state !== 'pending' && check.txHash && <LedgerLink hash={check.txHash} />}
              {detail && <div className="basis-full pl-10">{detail}</div>}
              {!detail && state === 'fail' && check.compare && (
                <button type="button" onClick={() => setCompareOpen(true)} className="text-[14px] underline underline-offset-4 hover:no-underline">
                  Compare photos
                </button>
              )}
            </li>
          )
        })}
        <li className="flex min-h-14 items-center gap-4 bg-paper px-6 py-3">
          <Glyph state={done ? run.verdict.state : 'pending'} />
          <div className="flex flex-1 flex-col">
            <span className="text-[15px] font-medium">Verdict</span>
            <span className="text-[14px] text-label">
              {done ? `${run.verdict.reason} · Confidence ${Math.round(run.verdict.confidence * 100)}%` : 'Not run'}
            </span>
          </div>
          {done && run.verdict.txHash && <LedgerLink hash={run.verdict.txHash} />}
        </li>
      </ul>
      <PhotoCompare open={compareOpen} onOpenChange={setCompareOpen} />
    </section>
  )
}

function Glyph({ state }: { state: Check['state'] }) {
  if (state === 'pass')
    return (
      <span className="flex size-6 shrink-0 items-center justify-center text-ok">
        <CheckIcon className="size-5" aria-hidden />
        <span className="sr-only">Passed</span>
      </span>
    )
  if (state === 'fail')
    return (
      <span className="flex size-6 shrink-0 items-center justify-center text-bad">
        <X className="size-5" aria-hidden />
        <span className="sr-only">Failed</span>
      </span>
    )
  return (
    <span className="flex size-6 shrink-0 items-center justify-center text-neutral">
      <Minus className="size-5" aria-hidden />
      <span className="sr-only">Pending</span>
    </span>
  )
}
