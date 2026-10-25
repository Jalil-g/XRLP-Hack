'use client'

import { Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/modal'
import { formatRLUSD, shortAddress } from '@/lib/api'
import { network, type LedgerAction, type LedgerTx } from '@/lib/mock-data'
import { LedgerLink } from './ledger-drawer'

type Phase = 'review' | 'signing' | 'submitting'

export interface SigningRequest {
  title: string
  meta: string
  from: { name: string; address: string }
  to: { name: string; address: string }
  amount: number | null
  ledgerAction: string
  txAction: LedgerAction
  txLabel: string
  actionLabel: string
  projectSlug: string
  milestoneId?: string
  investor?: string
  note?: string
  extraRows?: [string, string][]
}

function randomHex(bytes: number) {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()
}

const latency = () => 600 + Math.round(Math.random() * 300)

export function SigningPanel({
  request,
  onConfirmed,
  onBack,
  backLabel = 'Edit amount',
  onBusyChange,
  autoStart = false,
}: {
  request: SigningRequest
  onConfirmed: (tx: LedgerTx) => void
  onBack?: () => void
  backLabel?: string
  onBusyChange?: (busy: boolean) => void
  autoStart?: boolean
}) {
  const [phase, setPhase] = useState<Phase>('review')
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const started = useRef(false)

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true
      sign()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart])

  function sign() {
    setPhase('signing')
    onBusyChange?.(true)
    const t1 = setTimeout(() => {
      setPhase('submitting')
      const t2 = setTimeout(() => {
        const now = new Date()
        onBusyChange?.(false)
        setPhase('review')
        onConfirmed({
          hash: randomHex(32),
          action: request.txAction,
          label: request.txLabel,
          from: request.from.address,
          fromName: request.from.name,
          to: request.to.address,
          toName: request.to.name,
          amount: request.amount,
          currency: 'RLUSD',
          time: now.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }),
          ledgerIndex: 4185300 + Math.floor(Math.random() * 900),
          projectSlug: request.projectSlug,
          milestoneId: request.milestoneId,
          investor: request.investor,
          mock: true,
        })
      }, latency())
      timers.current.push(t2)
    }, latency())
    timers.current.push(t1)
  }

  const busy = phase !== 'review'
  const rows: [string, React.ReactNode][] = [
    ['From', <Party key="f" {...request.from} />],
    ['To', <Party key="t" {...request.to} />],
    ['Amount', request.amount === null ? 'None' : `${formatRLUSD(request.amount)} RLUSD`],
    ['Ledger action', request.ledgerAction],
    ...(request.extraRows ?? []),
    ['Network fee', network.fee],
  ]

  return (
    <div className="flex flex-col gap-5">
      <dl className="divide-y divide-hairline rounded-md border border-hairline px-4">
        {rows.map(([label, value]) => (
          <div key={label} className="flex min-h-11 items-center justify-between gap-4 py-2.5">
            <dt className="t-label">{label}</dt>
            <dd className="tnum text-right text-[15px]">{value}</dd>
          </div>
        ))}
      </dl>
      {request.note && <p className="t-label">{request.note}</p>}
      <div aria-live="polite" className="flex flex-col gap-3">
        {busy ? (
          <div className="flex h-11 items-center justify-center gap-2 rounded-md bg-neutral-bg text-[15px] text-neutral">
            <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden />
            {phase === 'signing' ? 'Signing' : `Submitting to ${network.name}`}
          </div>
        ) : (
          <Button onClick={sign} className="w-full">
            {request.actionLabel}
          </Button>
        )}
        {!busy && onBack && (
          <Button variant="secondary" className="w-full" onClick={onBack}>
            {backLabel}
          </Button>
        )}
      </div>
    </div>
  )
}

export function SigningFlow({
  request,
  open,
  onOpenChange,
  onConfirmed,
  onBack,
}: {
  request: SigningRequest
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirmed?: (tx: LedgerTx) => void
  onBack?: () => void
}) {
  const [tx, setTx] = useState<LedgerTx | null>(null)
  const [busy, setBusy] = useState(false)
  const [session, setSession] = useState(0)

  useEffect(() => {
    if (open) {
      setTx(null)
      setBusy(false)
      setSession((s) => s + 1)
    }
  }, [open])

  return (
    <Modal open={open} onOpenChange={onOpenChange} dismissible={!busy} title={tx ? 'Confirmed' : request.title} meta={request.meta}>
      {!tx ? (
        <div className="px-6 py-5">
          <SigningPanel
            key={session}
            request={request}
            onBack={onBack}
            onBusyChange={setBusy}
            onConfirmed={(confirmed) => {
              setTx(confirmed)
              onConfirmed?.(confirmed)
            }}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-5 px-6 py-5" aria-live="polite">
          <dl className="divide-y divide-hairline">
            <div className="flex min-h-11 items-center justify-between py-2.5">
              <dt className="t-label">Ledger action</dt>
              <dd>{request.ledgerAction}</dd>
            </div>
            <div className="flex min-h-11 items-center justify-between py-2.5">
              <dt className="t-label">Ledger index</dt>
              <dd className="t-mono">{tx.ledgerIndex.toLocaleString('en-US')}</dd>
            </div>
            <div className="flex min-h-11 items-center justify-between py-2.5">
              <dt className="t-label">Proof</dt>
              <dd>
                <LedgerLink tx={tx} />
              </dd>
            </div>
          </dl>
          <Button className="w-full" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      )}
    </Modal>
  )
}

function Party({ name, address }: { name: string; address: string }) {
  return (
    <span className="flex flex-col items-end">
      <span>{name}</span>
      <span className="t-mono text-label">{shortAddress(address)}</span>
    </span>
  )
}
