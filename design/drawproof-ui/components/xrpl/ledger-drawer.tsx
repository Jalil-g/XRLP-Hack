'use client'

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { ExternalLink, X } from 'lucide-react'
import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { formatRLUSD, getTx, shortHash } from '@/lib/api'
import { network, type LedgerTx } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import { CopyButton } from './copy-button'

export interface LedgerObject {
  kind: string
  title: string
  id: string
  rows: [string, string][]
  explorerUrl?: string
}

type Entry = LedgerTx | LedgerObject

const LedgerContext = createContext<{ show: (entry: Entry) => void } | null>(null)

export function useLedgerDrawer() {
  const ctx = useContext(LedgerContext)
  if (!ctx) throw new Error('useLedgerDrawer must be used inside LedgerProvider')
  return ctx
}

export function LedgerProvider({ children }: { children: React.ReactNode }) {
  const [tx, setTx] = useState<Entry | null>(null)
  const [open, setOpen] = useState(false)
  const show = useCallback((next: Entry) => {
    setTx(next)
    setOpen(true)
  }, [])
  const value = useMemo(() => ({ show }), [show])

  return (
    <LedgerContext.Provider value={value}>
      {children}
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-ink/20 motion-safe:transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <DialogPrimitive.Popup className="fixed top-0 right-0 z-50 flex h-full w-full max-w-[440px] flex-col border-l border-hairline bg-white outline-none motion-safe:transition-transform motion-safe:duration-200 data-ending-style:translate-x-full data-starting-style:translate-x-full">
            {tx && ('hash' in tx ? <LedgerDetail tx={tx} /> : <ObjectDetail obj={tx} />)}
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </LedgerContext.Provider>
  )
}

function LedgerDetail({ tx }: { tx: LedgerTx }) {
  const rows: [string, React.ReactNode][] = [
    ['Action', tx.action],
    ['From', <AddressCell key="f" name={tx.fromName} address={tx.from} />],
    ['To', <AddressCell key="t" name={tx.toName} address={tx.to} />],
    ['Amount', tx.amount === null ? 'None' : `${formatRLUSD(tx.amount)} ${tx.currency}`],
    ['Time', tx.time],
    ['Ledger index', <span key="i" className="t-mono">{tx.ledgerIndex.toLocaleString('en-US')}</span>],
  ]
  return (
    <>
      <div className="flex h-[72px] items-center justify-between border-b border-hairline px-6">
        <DialogPrimitive.Title className="t-card">{tx.label}</DialogPrimitive.Title>
        <DialogPrimitive.Close className="inline-flex size-9 items-center justify-center rounded-md hover:bg-accent" aria-label="Close">
          <X className="size-5" />
        </DialogPrimitive.Close>
      </div>
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
        <dl className="divide-y divide-hairline">
          {rows.map(([label, value]) => (
            <div key={label} className="flex min-h-11 items-start justify-between gap-4 py-3">
              <dt className="t-label">{label}</dt>
              <dd className="tnum text-right text-[15px]">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-col gap-2">
          <p className="t-label">Hash</p>
          <div className="flex items-start gap-2 rounded-md border border-hairline bg-paper p-3">
            <code className="flex-1 font-mono text-[13px] leading-5 break-all">{tx.hash}</code>
            <CopyButton value={tx.hash} label="Copy hash" />
          </div>
        </div>
        <p className="t-label">{network.name}</p>
      </div>
      <div className="border-t border-hairline px-6 py-5">
        {tx.mock ? (
          <span title="mock" className="t-label">
            Mock transaction · no explorer page
          </span>
        ) : (
          <a
            href={`${network.explorer}${tx.hash}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[15px] font-medium underline underline-offset-4 hover:no-underline"
          >
            Open explorer
            <ExternalLink className="size-4" aria-hidden />
          </a>
        )}
      </div>
    </>
  )
}

function ObjectDetail({ obj }: { obj: LedgerObject }) {
  return (
    <>
      <div className="flex h-[72px] items-center justify-between border-b border-hairline px-6">
        <div>
          <DialogPrimitive.Title className="t-card">{obj.title}</DialogPrimitive.Title>
          <p className="t-label">{obj.kind}</p>
        </div>
        <DialogPrimitive.Close className="inline-flex size-9 items-center justify-center rounded-md hover:bg-accent" aria-label="Close">
          <X className="size-5" />
        </DialogPrimitive.Close>
      </div>
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto px-6 py-6">
        <div className="flex flex-col gap-2">
          <p className="t-label">ID</p>
          <div className="flex items-start gap-2 rounded-md border border-hairline bg-paper p-3">
            <code className="flex-1 font-mono text-[13px] leading-5 break-all">{obj.id}</code>
            <CopyButton value={obj.id} label="Copy ID" />
          </div>
        </div>
        <dl className="divide-y divide-hairline">
          {obj.rows.map(([label, value]) => (
            <div key={label} className="flex min-h-11 items-start justify-between gap-4 py-3">
              <dt className="t-label">{label}</dt>
              <dd className="tnum text-right text-[15px]">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="t-label">{network.name}</p>
      </div>
      <div className="border-t border-hairline px-6 py-5">
        {obj.explorerUrl ? (
          <a href={obj.explorerUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[15px] font-medium underline underline-offset-4 hover:no-underline">
            Open explorer
            <ExternalLink className="size-4" aria-hidden />
          </a>
        ) : (
          <span className="t-label">Mock object · no explorer page</span>
        )}
      </div>
    </>
  )
}

export function ObjectLink({ obj, className }: { obj: LedgerObject; className?: string }) {
  const { show } = useLedgerDrawer()
  return (
    <button type="button" onClick={() => show(obj)} className={cn('rounded-sm text-[13px] text-ink underline underline-offset-4 hover:no-underline', className)}>
      View on ledger
    </button>
  )
}

function AddressCell({ name, address }: { name: string; address: string }) {
  return (
    <span className="flex flex-col items-end">
      <span>{name}</span>
      <span className="t-mono text-label">{`${address.slice(0, 4)}...${address.slice(-4)}`}</span>
    </span>
  )
}

export function LedgerLink({ tx, hash, className, short = false }: { tx?: LedgerTx; hash?: string; className?: string; short?: boolean }) {
  const { show } = useLedgerDrawer()
  const resolved = tx ?? (hash ? getTx(hash) : undefined)
  if (!resolved) return null
  return (
    <button
      type="button"
      onClick={() => show(resolved)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm text-[13px] text-ink underline-offset-4 hover:underline',
        className,
      )}
    >
      <span className="underline">View on ledger</span>
      {!short && <span className="font-mono text-label">{shortHash(resolved.hash)}</span>}
    </button>
  )
}
