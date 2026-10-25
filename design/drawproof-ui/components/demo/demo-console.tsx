'use client'

import { useState } from 'react'
import { ChecksPanel } from '@/components/checks/checks-panel'
import { Button } from '@/components/ui/button'
import { LedgerLink } from '@/components/xrpl/ledger-drawer'
import { SigningFlow } from '@/components/xrpl/signing-flow'
import { formatWhole } from '@/lib/api'
import { addresses, type CheckRun, type LedgerTx, type Project, type Scenario } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: 'honest', label: 'Honest builder' },
  { id: 'reused', label: 'Reused photo' },
]

export function DemoConsole({ project, runs }: { project: Project; runs: Record<Scenario, CheckRun> }) {
  const framing = project.milestones.find((m) => m.id === 'framing')!
  const [scenario, setScenario] = useState<Scenario>('reused')
  const [token, setToken] = useState(0)
  const [result, setResult] = useState<'pass' | 'fail' | null>(null)
  const [signOpen, setSignOpen] = useState(false)
  const [released, setReleased] = useState<LedgerTx | null>(null)

  const running = token > 0 && result === null

  function pick(s: Scenario) {
    setScenario(s)
    setToken(0)
    setResult(null)
    setReleased(null)
  }

  const primary =
    result === 'pass' && !released ? (
      <Button onClick={() => setSignOpen(true)}>Release {formatWhole(framing.amount)} RLUSD</Button>
    ) : (
      <Button
        disabled={running}
        onClick={() => {
          setResult(null)
          setReleased(null)
          setToken((t) => t + 1)
        }}
      >
        {token > 0 && !running ? 'Run checks again' : 'Run checks'}
      </Button>
    )

  return (
    <div className="container-app py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="t-page">Demo</h1>
          <p className="t-label">
            {project.name} · {framing.name} · {project.town}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div role="radiogroup" aria-label="Scenario" className="flex items-center gap-2">
            <span className="t-label">Scenario</span>
            <div className="inline-flex rounded-md border border-control bg-white p-0.5">
              {SCENARIOS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={scenario === s.id}
                  disabled={running}
                  onClick={() => pick(s.id)}
                  className={cn('h-9 rounded-[4px] px-3 text-[14px]', scenario === s.id ? 'bg-ink text-white' : 'text-ink hover:bg-accent')}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          {primary}
        </div>
      </div>

      <ChecksPanel
        run={runs[scenario]}
        amount={framing.amount}
        mode={token > 0 ? 'resolved' : 'idle'}
        runToken={token}
        released={!!released}
        onDone={setResult}
        action={released ? <LedgerLink tx={released} /> : undefined}
      />

      <SigningFlow
        open={signOpen}
        onOpenChange={setSignOpen}
        onConfirmed={setReleased}
        request={{
          title: 'Review release',
          meta: `${project.name} · ${framing.name}`,
          from: { name: `${project.name} account`, address: project.projectAccount },
          to: { name: project.builder, address: addresses.builder },
          amount: framing.amount,
          ledgerAction: 'Escrow release',
          txAction: 'EscrowFinish',
          txLabel: 'Released',
          actionLabel: `Release ${formatWhole(framing.amount)} RLUSD`,
          projectSlug: project.slug,
          milestoneId: framing.id,
          extraRows: [['Signers', '3 of 4 multisig']],
          note: 'This finishes the framing escrow and pays the builder. It cannot be undone once the ledger confirms it.',
        }}
      />
    </div>
  )
}
