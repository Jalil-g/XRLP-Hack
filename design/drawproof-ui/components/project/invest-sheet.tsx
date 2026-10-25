'use client'

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import Link from 'next/link'
import { useState } from 'react'
import { Chip } from '@/components/status-tag'
import { Button, buttonVariants } from '@/components/ui/button'
import { LedgerLink } from '@/components/xrpl/ledger-drawer'
import { SigningPanel } from '@/components/xrpl/signing-flow'
import { formatRLUSD, formatWhole } from '@/lib/api'
import type { LedgerTx, Project, Wallet } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

type Step = 'amount' | 'review' | 'done'
const STEPS: { id: Step; label: string }[] = [
  { id: 'amount', label: 'Amount' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
]

export function InvestSheet({ project, wallet }: { project: Project; wallet: Wallet }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('amount')
  const [raw, setRaw] = useState('10,000')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tx, setTx] = useState<LedgerTx | null>(null)

  const remaining = project.principal - project.raised
  const amount = Number(raw.replace(/,/g, ''))
  let error = ''
  if (!raw.trim() || Number.isNaN(amount)) error = 'Enter an amount in RLUSD.'
  else if (amount < project.minInvestment) error = `Minimum is ${formatWhole(project.minInvestment)} RLUSD.`
  else if (amount > wallet.rlusd) error = `Your wallet holds ${formatRLUSD(wallet.rlusd)} RLUSD.`
  else if (amount > remaining) error = `Only ${formatWhole(remaining)} RLUSD is left to raise.`
  const valid = !error
  const shares = valid ? Math.round(amount) : 0
  const showError = touched && raw.trim() !== '' ? error : touched ? error : ''

  function openSheet() {
    setStep('amount')
    setTx(null)
    setTouched(false)
    setOpen(true)
  }

  return (
    <>
      <Button className="w-full" onClick={openSheet} disabled={remaining <= 0}>
        Invest
      </Button>
      <DialogPrimitive.Root open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-ink/20 motion-safe:transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
          <DialogPrimitive.Popup className="fixed top-0 right-0 z-50 flex h-full w-full max-w-[480px] flex-col border-l border-hairline bg-white outline-none motion-safe:transition-transform motion-safe:duration-200 data-ending-style:translate-x-full data-starting-style:translate-x-full">
            <div className="flex items-start justify-between gap-4 border-b border-hairline px-6 py-5">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <DialogPrimitive.Title className="t-card">Invest in {project.name}</DialogPrimitive.Title>
                  {project.sample && <Chip>Sample</Chip>}
                </div>
                <DialogPrimitive.Description className="t-label">
                  {project.ratePct.toFixed(2)}% · {project.termDays} days · {formatWhole(remaining)} RLUSD left to raise
                </DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close disabled={busy} className="inline-flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-accent disabled:opacity-40" aria-label="Close">
                <X className="size-5" />
              </DialogPrimitive.Close>
            </div>

            <ol className="flex border-b border-hairline px-6" aria-label="Steps">
              {STEPS.map((s, i) => {
                const current = s.id === step
                const past = STEPS.findIndex((x) => x.id === step) > i
                return (
                  <li
                    key={s.id}
                    aria-current={current ? 'step' : undefined}
                    className={cn(
                      'relative flex h-12 flex-1 items-center gap-2 text-[14px]',
                      current ? 'text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-clay' : past ? 'text-ink' : 'text-label',
                    )}
                  >
                    <span className="font-mono text-[12px]">{i + 1}</span>
                    {s.label}
                  </li>
                )
              })}
            </ol>

            <div className="flex flex-1 flex-col overflow-y-auto px-6 py-6">
              {step === 'amount' && (
                <form
                  noValidate
                  className="flex flex-col gap-4"
                  onSubmit={(e) => {
                    e.preventDefault()
                    setTouched(true)
                    if (valid) setStep('review')
                  }}
                >
                  <label htmlFor="invest-amount" className="t-label">
                    Amount
                  </label>
                  <div
                    className={cn(
                      'flex h-16 items-center rounded-md border bg-white px-4 focus-within:ring-2 focus-within:ring-ink/20',
                      showError ? 'border-bad' : 'border-control focus-within:border-ink',
                    )}
                  >
                    <input
                      id="invest-amount"
                      inputMode="decimal"
                      autoComplete="off"
                      autoFocus
                      value={raw}
                      onChange={(e) => {
                        setRaw(e.target.value.replace(/[^\d.,]/g, ''))
                        setTouched(true)
                      }}
                      aria-invalid={!!showError}
                      aria-describedby="invest-hint invest-error"
                      className="tnum min-w-0 flex-1 bg-transparent text-[32px] outline-none"
                    />
                    <span className="text-[17px] text-label">RLUSD</span>
                  </div>
                  <div id="invest-hint" className="flex items-center justify-between text-[14px]">
                    <span className="text-label">Wallet: {formatRLUSD(wallet.rlusd)} RLUSD</span>
                    <button
                      type="button"
                      onClick={() => {
                        setRaw(formatWhole(Math.min(wallet.rlusd, remaining)))
                        setTouched(true)
                      }}
                      className="underline underline-offset-4 hover:no-underline"
                    >
                      Max
                    </button>
                  </div>
                  <p id="invest-error" role="alert" className="min-h-5 text-[14px] text-bad">
                    {showError}
                  </p>
                  <dl className="divide-y divide-hairline border-y border-hairline" aria-live="polite">
                    <div className="flex min-h-11 items-center justify-between py-2.5">
                      <dt className="t-label">Estimated shares</dt>
                      <dd className="tnum">{valid ? `≈ ${formatWhole(shares)}` : '—'}</dd>
                    </div>
                    <div className="flex min-h-11 items-center justify-between py-2.5">
                      <dt className="t-label">Minimum</dt>
                      <dd className="tnum">{formatWhole(project.minInvestment)} RLUSD</dd>
                    </div>
                  </dl>
                  <Button type="submit" className="mt-2 w-full" disabled={!valid}>
                    Continue
                  </Button>
                </form>
              )}

              {step === 'review' && (
                <div className="flex flex-col gap-5">
                  <p className="text-[16px] leading-6">
                    You deposit {formatRLUSD(amount)} RLUSD into the {project.name} vault and receive about {formatWhole(shares)} shares. Money is lent
                    to the project after {project.closes} and held in escrow per milestone. Withdrawable after the loan is repaid.
                  </p>
                  <SigningPanel
                    request={{
                      title: 'Review deposit',
                      meta: project.name,
                      from: { name: wallet.name, address: wallet.address },
                      to: { name: `${project.name} vault`, address: project.vaultId },
                      amount,
                      ledgerAction: 'Vault deposit',
                      txAction: 'VaultDeposit',
                      txLabel: 'Vault deposit',
                      actionLabel: `Deposit ${formatWhole(amount)} RLUSD`,
                      projectSlug: project.slug,
                      investor: wallet.name,
                    }}
                    backLabel="Back"
                    onBack={() => setStep('amount')}
                    onBusyChange={setBusy}
                    onConfirmed={(confirmed) => {
                      setTx(confirmed)
                      setStep('done')
                    }}
                  />
                </div>
              )}

              {step === 'done' && tx && (
                <div className="flex flex-col gap-5" aria-live="polite">
                  <div>
                    <p className="t-card text-ok">Deposited</p>
                    <p className="tnum text-[32px] leading-10">{formatRLUSD(amount)} RLUSD</p>
                  </div>
                  <dl className="divide-y divide-hairline border-y border-hairline">
                    <div className="flex min-h-11 items-center justify-between py-2.5">
                      <dt className="t-label">Shares received</dt>
                      <dd className="tnum">{formatWhole(shares)}</dd>
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
                  <Link href="/portfolio" className={cn(buttonVariants(), 'w-full')}>
                    View portfolio
                  </Link>
                </div>
              )}
            </div>
          </DialogPrimitive.Popup>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  )
}
