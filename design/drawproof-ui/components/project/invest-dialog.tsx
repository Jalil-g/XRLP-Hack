'use client'

import { useState } from 'react'
import { Modal } from '@/components/modal'
import { Button } from '@/components/ui/button'
import { SigningFlow } from '@/components/xrpl/signing-flow'
import { formatRLUSD, formatWhole } from '@/lib/api'
import type { Project, Wallet } from '@/lib/mock-data'

export function InvestButton({ project, wallet }: { project: Project; wallet: Wallet }) {
  const [step, setStep] = useState<'closed' | 'amount' | 'sign'>('closed')
  const [raw, setRaw] = useState('10000')
  const [touched, setTouched] = useState(false)

  const amount = Number(raw.replace(/,/g, ''))
  const open = project.principal - project.raised
  const cap = Math.min(wallet.rlusd, open)
  let error = ''
  if (!raw || Number.isNaN(amount)) error = 'Enter an amount in RLUSD.'
  else if (amount < project.minInvestment) error = `Minimum is ${formatWhole(project.minInvestment)} RLUSD. Raise the amount.`
  else if (amount > wallet.rlusd) error = `Your wallet holds ${formatRLUSD(wallet.rlusd)} RLUSD. Lower the amount.`
  else if (amount > open) error = `Only ${formatWhole(open)} RLUSD is left to raise. Lower the amount.`
  const valid = !error
  const share = valid ? (amount / project.principal) * 100 : 0
  const interest = valid ? amount * (project.ratePct / 100) * (project.termDays / 365) : 0

  return (
    <>
      <Button className="w-full" onClick={() => setStep('amount')} disabled={open <= 0}>
        {open > 0 ? 'Invest now' : 'Fully funded'}
      </Button>
      <Modal open={step === 'amount'} onOpenChange={(o) => !o && setStep('closed')} title="Invest" meta={`${project.name} · ${project.ratePct.toFixed(2)}% · ${project.termDays} days`}>
        <form
          className="flex flex-col gap-5 px-6 py-5"
          onSubmit={(e) => {
            e.preventDefault()
            setTouched(true)
            if (valid) setStep('sign')
          }}
        >
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label htmlFor="amount" className="t-label">
                Amount (RLUSD)
              </label>
              <button type="button" className="text-[14px] underline underline-offset-4 hover:no-underline" onClick={() => setRaw(String(cap))}>
                Max
              </button>
            </div>
            <input
              id="amount"
              inputMode="decimal"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={touched && !valid}
              aria-describedby="amount-error"
              className="tnum h-12 rounded-md border border-control px-3 text-[20px] outline-none focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink/20 aria-invalid:border-bad"
            />
            <p id="amount-error" role="alert" className="min-h-5 text-[14px] text-bad">
              {touched ? error : ''}
            </p>
          </div>
          <dl className="divide-y divide-hairline" aria-live="polite">
            {[
              ['Vault share', `${share.toFixed(2)}%`],
              ['Est. interest', `${formatRLUSD(interest)} RLUSD`],
              ['Wallet', `${formatRLUSD(wallet.rlusd)} RLUSD`],
            ].map(([k, v]) => (
              <div key={k} className="flex min-h-11 items-center justify-between py-2.5">
                <dt className="t-label">{k}</dt>
                <dd className="tnum">{v}</dd>
              </div>
            ))}
          </dl>
          <Button type="submit" className="w-full">
            Review deposit
          </Button>
        </form>
      </Modal>
      <SigningFlow
        open={step === 'sign'}
        onOpenChange={(o) => !o && setStep('closed')}
        onBack={() => setStep('amount')}
        request={{
          title: 'Review deposit',
          meta: project.name,
          from: { name: wallet.name, address: wallet.address },
          to: { name: `${project.name} vault`, address: project.vaultId },
          amount: valid ? amount : 0,
          ledgerAction: 'Vault deposit',
          txAction: 'VaultDeposit',
          txLabel: 'Vault deposit',
          actionLabel: `Deposit ${formatWhole(valid ? amount : 0)} RLUSD`,
          projectSlug: project.slug,
          note: 'Your RLUSD goes into this project’s vault. It is lent to the project account and released to the builder one milestone at a time, only after that milestone’s checks pass. You can lose money.',
        }}
      />
    </>
  )
}
