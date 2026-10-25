'use client'

import { useState } from 'react'
import { SideSheet } from '@/components/side-sheet'
import { Button, type buttonVariants } from '@/components/ui/button'
import { LedgerLink } from '@/components/xrpl/ledger-drawer'
import { SigningPanel } from '@/components/xrpl/signing-flow'
import { formatRLUSD, formatWhole, getNextPayment, getProject, getWallet } from '@/lib/api'
import { builderActions } from '@/lib/builder-store'
import type { LedgerTx } from '@/lib/mock-data'
import { cn } from '@/lib/utils'
import type { VariantProps } from 'class-variance-authority'

type Step = 'amount' | 'review' | 'done'
const STEPS: { id: Step; label: string }[] = [
  { id: 'amount', label: 'Amount' },
  { id: 'review', label: 'Review' },
  { id: 'done', label: 'Done' },
]

export function RepaySheet({
  variant = 'default',
  className,
  label = 'Repay',
}: {
  variant?: VariantProps<typeof buttonVariants>['variant']
  className?: string
  label?: string
}) {
  const due = getNextPayment()
  const project = getProject(due.projectSlug)!
  const wallet = getWallet('builder')
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<Step>('amount')
  const [choice, setChoice] = useState<'due' | 'custom'>('due')
  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [tx, setTx] = useState<LedgerTx | null>(null)

  const amount = choice === 'due' ? due.amount : Number(raw.replace(/,/g, ''))
  let error = ''
  if (choice === 'custom') {
    if (!raw.trim() || Number.isNaN(amount) || amount <= 0) error = 'Enter an amount in RLUSD.'
    else if (amount > wallet.rlusd) error = `Your wallet holds ${formatRLUSD(wallet.rlusd)} RLUSD.`
  }

  function openSheet() {
    setStep('amount')
    setChoice('due')
    setRaw('')
    setTx(null)
    setOpen(true)
  }

  const option = (active: boolean) =>
    cn('flex cursor-pointer items-start gap-3 rounded-md border p-4', active ? 'border-ink' : 'border-control hover:bg-accent')

  return (
    <>
      <Button variant={variant} className={className} onClick={openSheet}>
        {label}
      </Button>
      <SideSheet
        open={open}
        onOpenChange={setOpen}
        busy={busy}
        title={`Repay ${project.name}`}
        description={`Next payment due ${due.due}`}
        steps={STEPS}
        step={step}
      >
        {step === 'amount' && (
          <form
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              if (!error) setStep('review')
            }}
          >
            <fieldset className="flex flex-col gap-3">
              <legend className="t-label mb-3">Amount</legend>
              <label className={option(choice === 'due')}>
                <input type="radio" name="repay" checked={choice === 'due'} onChange={() => setChoice('due')} className="mt-1 accent-ink" />
                <span className="flex flex-col">
                  <span className="tnum text-[17px]">{formatRLUSD(due.amount)} RLUSD</span>
                  <span className="t-label">Amount due · {due.basis}</span>
                </span>
              </label>
              <label className={option(choice === 'custom')}>
                <input type="radio" name="repay" checked={choice === 'custom'} onChange={() => setChoice('custom')} className="mt-1 accent-ink" />
                <span className="flex flex-1 flex-col gap-2">
                  <span className="text-[17px]">Custom amount</span>
                  {choice === 'custom' && (
                    <span className={cn('flex h-12 items-center rounded-md border bg-white px-3', error && raw ? 'border-bad' : 'border-control')}>
                      <input
                        aria-label="Custom amount"
                        inputMode="decimal"
                        autoFocus
                        value={raw}
                        onChange={(e) => setRaw(e.target.value.replace(/[^\d.,]/g, ''))}
                        aria-invalid={!!error}
                        aria-describedby="repay-error"
                        className="tnum min-w-0 flex-1 bg-transparent text-[20px] outline-none"
                      />
                      <span className="text-label">RLUSD</span>
                    </span>
                  )}
                </span>
              </label>
            </fieldset>
            <p id="repay-error" role="alert" className="min-h-5 text-[14px] text-bad">
              {choice === 'custom' && raw ? error : ''}
            </p>
            <p className="t-label">Wallet: {formatRLUSD(wallet.rlusd)} RLUSD</p>
            <Button type="submit" className="w-full" disabled={!!error}>
              Continue
            </Button>
          </form>
        )}

        {step === 'review' && (
          <div className="flex flex-col gap-5">
            <p className="text-[16px] leading-6">
              You pay {formatRLUSD(amount)} RLUSD toward the {project.name} loan. Payments go to the project vault and are shared with its investors.
            </p>
            <SigningPanel
              request={{
                title: 'Review payment',
                meta: project.name,
                from: { name: wallet.name, address: wallet.address },
                to: { name: `${project.name} vault`, address: project.vaultId },
                amount,
                ledgerAction: 'LoanPay',
                txAction: 'LoanPay',
                txLabel: 'Loan payment',
                actionLabel: `Pay ${formatWhole(amount)} RLUSD`,
                projectSlug: project.slug,
              }}
              backLabel="Back"
              onBack={() => setStep('amount')}
              onBusyChange={setBusy}
              onConfirmed={(confirmed) => {
                setTx(confirmed)
                builderActions.addTx(confirmed)
                setStep('done')
              }}
            />
          </div>
        )}

        {step === 'done' && tx && (
          <div className="flex flex-col gap-5" aria-live="polite">
            <div>
              <p className="t-card text-ok">Paid</p>
              <p className="tnum text-[32px] leading-10">{formatRLUSD(amount)} RLUSD</p>
            </div>
            <dl className="divide-y divide-hairline border-y border-hairline">
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
            <Button className="w-full" onClick={() => setOpen(false)}>
              Done
            </Button>
          </div>
        )}
      </SideSheet>
    </>
  )
}
