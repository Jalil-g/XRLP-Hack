'use client'

import { Check, Circle, LoaderCircle, X } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { PlainSelect } from '@/components/plain-select'
import { StatusTag } from '@/components/status-tag'
import { Button, buttonVariants } from '@/components/ui/button'
import { LedgerLink } from '@/components/xrpl/ledger-drawer'
import { SigningPanel } from '@/components/xrpl/signing-flow'
import { formatRLUSD, formatWhole, getWallet } from '@/lib/api'
import { builderActions, useBuilder, type Draft, type WizardStep } from '@/lib/builder-store'
import { addresses, sovTemplates, type LedgerTx } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

const STEPS: { id: WizardStep; label: string }[] = [
  { id: 'project', label: 'Project' },
  { id: 'sov', label: 'Schedule of Values' },
  { id: 'documents', label: 'Documents' },
  { id: 'fee', label: 'Verification fee' },
  { id: 'review', label: 'Review' },
]

const DOCS = ['Contractor license', 'Insurance certificate', 'LLC good standing', 'Building permit']
const FEE = 250

const toNumber = (s: string) => Number(s.replace(/,/g, ''))

function stepError(d: Draft, step: WizardStep) {
  if (step === 'project') {
    if (!d.name.trim()) return 'Enter a project name.'
    if (!d.address.trim()) return 'Enter the site address.'
    if (!(toNumber(d.principal) > 0)) return 'Enter the principal in RLUSD.'
    if (!(toNumber(d.termDays) > 0)) return 'Enter the term in days.'
  }
  if (step === 'sov') {
    const total = d.lines.reduce((s, l) => s + l.amount, 0)
    if (total !== toNumber(d.principal)) return 'The schedule total must equal the principal.'
  }
  if (step === 'documents' && DOCS.some((doc) => !d.docs[doc])) return 'Upload all four documents.'
  if (step === 'fee' && !d.feeTx) return 'Pay the verification fee to continue.'
  return ''
}

export function NewProjectWizard() {
  const draft = useBuilder((s) => s.draft)
  const [showError, setShowError] = useState(false)
  if (draft.submitted) return <VerifyingPage draft={draft} />

  const index = STEPS.findIndex((s) => s.id === draft.step)
  const error = stepError(draft, draft.step)
  const go = (step: WizardStep) => {
    setShowError(false)
    builderActions.updateDraft({ step })
  }

  function next() {
    if (error) return setShowError(true)
    const completed = Array.from(new Set([...draft.completed, draft.step]))
    if (draft.step === 'review') return builderActions.updateDraft({ completed, submitted: true })
    builderActions.updateDraft({ completed })
    go(STEPS[index + 1].id)
  }

  return (
    <div className="container-app grid grid-cols-1 gap-8 py-8 lg:grid-cols-[256px_1fr]">
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <nav aria-label="Steps" className="panel p-3">
          <ol className="flex flex-col">
            {STEPS.map((s, i) => {
              const done = draft.completed.includes(s.id)
              const reachable = done || i <= index || draft.completed.includes(STEPS[i - 1]?.id)
              const current = s.id === draft.step
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    disabled={!reachable}
                    onClick={() => go(s.id)}
                    aria-current={current ? 'step' : undefined}
                    className={cn(
                      'flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-[15px] disabled:text-label',
                      current ? 'bg-accent font-medium' : 'hover:bg-accent disabled:hover:bg-transparent',
                    )}
                  >
                    <span className={cn('flex size-5 items-center justify-center rounded-full border', done ? 'border-ok bg-ok text-white' : 'border-control')}>
                      {done ? <Check className="size-3.5" aria-hidden /> : <span className="font-mono text-[11px]">{i + 1}</span>}
                    </span>
                    {s.label}
                    {done && <span className="sr-only">, complete</span>}
                  </button>
                </li>
              )
            })}
          </ol>
        </nav>
        <p className="mt-3 px-3 t-caption text-label">Drafts are saved as you go.</p>
      </aside>

      <section aria-labelledby="step-title" className="panel flex min-h-[520px] flex-col">
        <div className="border-b border-hairline px-6 py-5">
          <p className="t-label">
            Step {index + 1} of {STEPS.length}
          </p>
          <h1 id="step-title" className="t-section">
            {STEPS[index].label}
          </h1>
        </div>
        <div className="flex-1 px-6 py-6">
          {draft.step === 'project' && <ProjectStep draft={draft} />}
          {draft.step === 'sov' && <SovStep draft={draft} />}
          {draft.step === 'documents' && <DocumentsStep draft={draft} />}
          {draft.step === 'fee' && <FeeStep draft={draft} />}
          {draft.step === 'review' && <ReviewStep draft={draft} />}
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-hairline px-6 py-4">
          <p role="alert" className="mr-auto text-[14px] text-bad">
            {showError ? error : ''}
          </p>
          {index > 0 && (
            <Button variant="secondary" onClick={() => go(STEPS[index - 1].id)}>
              Back
            </Button>
          )}
          <Button onClick={next} disabled={draft.step === 'fee' && !draft.feeTx}>
            {draft.step === 'review' ? 'Submit for verification' : 'Continue'}
          </Button>
        </div>
      </section>
    </div>
  )
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="t-label">{label}</span>
      {children}
      {hint && <span className="t-caption text-label">{hint}</span>}
    </label>
  )
}

const inputClass = 'h-11 rounded-md border border-control bg-white px-3 text-[16px] outline-none focus-visible:border-ink'

function ProjectStep({ draft }: { draft: Draft }) {
  const set = builderActions.updateDraft
  return (
    <div className="grid max-w-2xl grid-cols-1 gap-5 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Field label="Project name">
          <input className={cn(inputClass, 'w-full')} value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Birch Ln Single Family" />
        </Field>
      </div>
      <div className="sm:col-span-2">
        <Field label="Site address">
          <input className={cn(inputClass, 'w-full')} value={draft.address} onChange={(e) => set({ address: e.target.value })} placeholder="14 Birch Ln, Kingston, NY" autoComplete="street-address" />
        </Field>
      </div>
      <Field label="Type">
        <PlainSelect
          label="Type"
          value={draft.category}
          onChange={(v) => {
            const category = v as Draft['category']
            const template = sovTemplates[category] ?? sovTemplates['New build']
            set({ category, lines: template.lines.map((l) => ({ ...l })) })
          }}
          options={['New build', 'Renovation', 'ADU'].map((v) => ({ value: v, label: v }))}
        />
      </Field>
      <div />
      <Field label="Principal (RLUSD)">
        <input className={cn(inputClass, 'tnum')} inputMode="decimal" value={draft.principal} onChange={(e) => set({ principal: e.target.value.replace(/[^\d,]/g, '') })} />
      </Field>
      <Field label="Term (days)">
        <input className={cn(inputClass, 'tnum')} inputMode="numeric" value={draft.termDays} onChange={(e) => set({ termDays: e.target.value.replace(/\D/g, '') })} />
      </Field>
    </div>
  )
}

function SovStep({ draft }: { draft: Draft }) {
  const total = draft.lines.reduce((s, l) => s + l.amount, 0)
  const principal = toNumber(draft.principal)
  const diff = total - principal
  const template = sovTemplates[draft.category] ?? sovTemplates['New build']

  function update(id: string, patch: Partial<Draft['lines'][number]>) {
    builderActions.updateDraft({ lines: draft.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) })
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="t-label">Template: {template.name}</p>
      <div className="overflow-x-auto rounded-md border border-hairline">
        <table className="w-full min-w-[720px] text-[15px]">
          <caption className="sr-only">Schedule of Values</caption>
          <thead>
            <tr className="border-b border-hairline text-left">
              <th scope="col" className="h-11 w-14 px-4 t-label font-normal">Line</th>
              <th scope="col" className="px-4 t-label font-normal">Trade</th>
              <th scope="col" className="w-40 px-4 text-right t-label font-normal">Amount</th>
              <th scope="col" className="px-4 t-label font-normal">Evidence required</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {draft.lines.map((l, i) => (
              <tr key={l.id}>
                <td className="px-4 font-mono text-[13px] text-label">{String(i + 1).padStart(2, '0')}</td>
                <td className="px-4 py-1.5">
                  <input aria-label={`Line ${i + 1} trade`} value={l.trade} onChange={(e) => update(l.id, { trade: e.target.value })} className="h-9 w-full rounded-sm bg-transparent px-2 outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ink" />
                </td>
                <td className="px-4 py-1.5">
                  <input
                    aria-label={`Line ${i + 1} amount`}
                    inputMode="numeric"
                    value={formatWhole(l.amount)}
                    onChange={(e) => update(l.id, { amount: toNumber(e.target.value.replace(/[^\d,]/g, '')) || 0 })}
                    className="tnum h-9 w-full rounded-sm bg-transparent px-2 text-right outline-none hover:bg-accent focus-visible:ring-1 focus-visible:ring-ink"
                  />
                </td>
                <td className="px-4 py-1.5 text-[14px] text-label">{l.evidence}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-ink">
              <th scope="row" colSpan={2} className="h-12 px-4 text-left font-medium">
                Total
              </th>
              <td className="tnum px-6 text-right font-medium">{formatWhole(total)}</td>
              <td className="px-4 text-[14px]" aria-live="polite">
                {diff === 0 ? (
                  <span className="text-ok">Matches principal</span>
                ) : (
                  <span className="text-bad">
                    {formatWhole(Math.abs(diff))} RLUSD {diff > 0 ? 'over' : 'under'} the {formatWhole(principal)} principal
                  </span>
                )}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}

function DocumentsStep({ draft }: { draft: Draft }) {
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  function attach(doc: string, file: File | undefined) {
    if (!file) return
    const docs = { ...builderActions.getDraft().docs, [doc]: { file: file.name, status: 'Checking' as const } }
    builderActions.updateDraft({ docs })
    timers.current.push(
      setTimeout(() => {
        const current = builderActions.getDraft().docs
        builderActions.updateDraft({ docs: { ...current, [doc]: { file: file.name, status: 'Accepted' } } })
      }, 900),
    )
  }

  return (
    <ul className="divide-y divide-hairline border-y border-hairline">
      {DOCS.map((doc) => {
        const entry = draft.docs[doc]
        const id = `doc-${doc.replace(/\s+/g, '-').toLowerCase()}`
        return (
          <li key={doc} className="flex min-h-16 flex-wrap items-center gap-x-4 gap-y-2 py-3">
            <div className="flex flex-1 flex-col">
              <span className="text-[16px]">{doc}</span>
              <span className={cn('t-mono text-[13px]', entry ? 'text-ink' : 'text-label')}>{entry ? entry.file : 'PDF or image'}</span>
            </div>
            {entry && <StatusTag status={entry.status} />}
            <label htmlFor={id} className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'cursor-pointer')}>
              {entry ? 'Replace' : 'Upload'}
              <span className="sr-only"> {doc}</span>
            </label>
            <input id={id} type="file" accept="application/pdf,image/*" className="sr-only" onChange={(e) => attach(doc, e.target.files?.[0])} />
          </li>
        )
      })}
    </ul>
  )
}

function FeeStep({ draft }: { draft: Draft }) {
  const wallet = getWallet('builder')
  if (draft.feeTx)
    return (
      <div className="flex max-w-xl flex-col gap-4">
        <p className="t-card text-ok">Fee paid</p>
        <dl className="divide-y divide-hairline border-y border-hairline">
          <div className="flex min-h-11 items-center justify-between py-2.5">
            <dt className="t-label">Amount</dt>
            <dd className="tnum">{formatRLUSD(FEE)} RLUSD</dd>
          </div>
          <div className="flex min-h-11 items-center justify-between py-2.5">
            <dt className="t-label">Proof</dt>
            <dd>
              <LedgerLink tx={draft.feeTx} />
            </dd>
          </div>
        </dl>
      </div>
    )
  return (
    <div className="flex max-w-xl flex-col gap-5">
      <p className="text-[16px] leading-6">The fee covers registry checks, feasibility review and issuing your builder credential. It is paid once per project.</p>
      <SigningPanel
        request={{
          title: 'Review fee',
          meta: draft.name || 'New project',
          from: { name: wallet.name, address: wallet.address },
          to: { name: 'Drawproof', address: addresses.platform },
          amount: FEE,
          ledgerAction: 'Payment',
          txAction: 'Payment',
          txLabel: 'Verification fee',
          actionLabel: `Pay ${FEE} RLUSD`,
          projectSlug: 'new-project',
        }}
        onConfirmed={(tx) => {
          builderActions.addTx(tx)
          builderActions.updateDraft({ feeTx: tx })
        }}
      />
    </div>
  )
}

function ReviewStep({ draft }: { draft: Draft }) {
  const rows: [string, string][] = [
    ['Project', draft.name],
    ['Site address', draft.address],
    ['Type', draft.category],
    ['Principal', `${formatWhole(toNumber(draft.principal))} RLUSD`],
    ['Term', `${draft.termDays} days`],
    ['Schedule of Values', `${draft.lines.length} lines · ${formatWhole(draft.lines.reduce((s, l) => s + l.amount, 0))} RLUSD`],
    ['Documents', `${Object.keys(draft.docs).length} of ${DOCS.length} uploaded`],
    ['Verification fee', draft.feeTx ? `${formatRLUSD(FEE)} RLUSD paid` : 'Not paid'],
  ]
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <dl className="divide-y divide-hairline border-y border-hairline">
        {rows.map(([k, v]) => (
          <div key={k} className="grid min-h-11 grid-cols-[180px_1fr] items-center gap-4 py-2.5">
            <dt className="t-label">{k}</dt>
            <dd className="tnum">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="t-label">Submitting starts identity, feasibility and capability checks. Registry results are mock data.</p>
    </div>
  )
}

const GROUPS: { name: string; checks: { name: string; result: string }[] }[] = [
  {
    name: 'Identity',
    checks: [
      { name: 'Business entity', result: 'Hudson Valley Builders LLC, active (NY DOS, mock)' },
      { name: 'Beneficial owner', result: 'Matched to KYC record' },
      { name: 'Sanctions screen', result: 'No matches' },
    ],
  },
  {
    name: 'Feasibility',
    checks: [
      { name: 'Building permit', result: 'Permit on file with the municipality (mock)' },
      { name: 'Budget vs. comparables', result: 'Within 6% of regional cost per sq ft' },
      { name: 'Schedule of Values', result: 'Totals match principal' },
    ],
  },
  {
    name: 'Capability',
    checks: [
      { name: 'Contractor license', result: 'Active, no violations (mock)' },
      { name: 'Insurance certificate', result: 'General liability through Aug 2027' },
      { name: 'Prior projects', result: '2 completed on Drawproof, 0 failed draws' },
    ],
  },
]

function VerifyingPage({ draft }: { draft: Draft }) {
  const total = GROUPS.reduce((s, g) => s + g.checks.length, 0)
  const [resolved, setResolved] = useState(draft.verified ? total : 0)
  const wallet = getWallet('builder')

  useEffect(() => {
    if (draft.verified) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let n = 0
    const timer = setInterval(
      () => {
        n = reduce ? total : n + 1
        setResolved(n)
        if (n >= total) {
          clearInterval(timer)
          const tx: LedgerTx = {
            hash: wallet.credentialTx,
            action: 'Verdict attestation',
            label: 'Builder credential issued',
            from: addresses.platform,
            fromName: 'Drawproof',
            to: wallet.address,
            toName: wallet.name,
            amount: null,
            currency: 'XRP',
            time: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '').replace(',', ''),
            ledgerIndex: 93_418_220,
            projectSlug: 'new-project',
            mock: true,
          }
          builderActions.updateDraft({ verified: true, credentialTx: tx })
        }
      },
      reduce ? 0 : 420,
    )
    return () => clearInterval(timer)
  }, [draft.verified, total, wallet])

  let offset = 0
  return (
    <div className="container-app max-w-4xl py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="t-label">{draft.name || 'New project'}</p>
          <h1 className="t-page">Verifying</h1>
        </div>
        <p aria-live="polite" className={cn('t-card', draft.verified ? 'text-ok' : 'text-ink')}>
          {draft.verified ? 'Verified' : `${resolved} of ${total} checks`}
        </p>
      </div>

      <div className="flex flex-col gap-6">
        {GROUPS.map((g) => {
          const start = offset
          offset += g.checks.length
          return (
            <section key={g.name} aria-labelledby={`group-${g.name}`} className="panel">
              <h2 id={`group-${g.name}`} className="border-b border-hairline px-6 py-4 t-card">
                {g.name}
              </h2>
              <ul className="divide-y divide-hairline">
                {g.checks.map((c, i) => {
                  const state = start + i < resolved ? 'pass' : start + i === resolved ? 'running' : 'pending'
                  return (
                    <li key={c.name} className="flex min-h-12 items-center gap-3 px-6 py-2.5">
                      {state === 'pass' ? (
                        <Check className="size-4 text-ok" aria-label="Passed" />
                      ) : state === 'running' ? (
                        <LoaderCircle className="size-4 animate-spin text-label" aria-label="Checking" />
                      ) : (
                        <Circle className="size-4 text-control" aria-label="Pending" />
                      )}
                      <span className="w-52 shrink-0 text-[15px]">{c.name}</span>
                      <span className="text-[14px] text-label">{state === 'pass' ? c.result : state === 'running' ? 'Checking' : 'Waiting'}</span>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}

        {draft.verified && draft.credentialTx && (
          <section aria-label="Outcome" className="panel flex flex-col gap-4 px-6 py-5 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="t-card text-ok">Verified</p>
              <p className="text-[15px]">Credential &ldquo;{wallet.credential}&rdquo; issued to {wallet.name}.</p>
              <LedgerLink tx={draft.credentialTx} />
            </div>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => builderActions.resetDraft()}>
                <X className="size-4" aria-hidden />
                Start another
              </Button>
              <Link href="/builder" className={buttonVariants()}>
                Back to home
              </Link>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
