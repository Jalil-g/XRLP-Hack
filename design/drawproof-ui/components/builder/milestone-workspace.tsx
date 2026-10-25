'use client'

import { useState } from 'react'
import { ChecksPanel, type PanelMode } from '@/components/checks/checks-panel'
import { PhotoCompare } from '@/components/checks/photo-compare'
import { StatusTag } from '@/components/status-tag'
import { Button } from '@/components/ui/button'
import { LedgerLink } from '@/components/xrpl/ledger-drawer'
import { formatRLUSD, formatWhole, getRequirements } from '@/lib/api'
import { builderActions, useBuilder, type FramingStage } from '@/lib/builder-store'
import type { CheckRun, LedgerTx, PhotoMatch, Project } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

function framingStatus(stage: FramingStage) {
  if (stage === 'failed') return 'Failed'
  if (stage === 'passed') return 'Checks passed'
  return 'Evidence in'
}

export function useCurrentMilestone(project: Project) {
  const framing = useBuilder((s) => s.framing)
  if (project.slug !== 'maple-st-duplex') return project.milestones.find((m) => m.status !== 'Released')
  return project.milestones.find((m) => (framing === 'passed' ? m.id === 'roof' : m.id === 'framing'))
}

export function UploadEvidenceButton({ project }: { project: Project }) {
  const current = useCurrentMilestone(project)
  const framing = useBuilder((s) => s.framing)
  const busy = current?.id === 'framing' && (framing === 'queued' || framing === 'checking')
  return (
    <Button className="w-full" disabled={!current || busy} onClick={() => current && builderActions.openUpload(current.id)}>
      {busy ? 'Checks running' : 'Upload evidence'}
    </Button>
  )
}

export function MilestoneWorkspace({
  project,
  runs,
  releases,
  match,
}: {
  project: Project
  runs: { reused?: CheckRun; honest?: CheckRun }
  releases: Record<string, LedgerTx>
  match: PhotoMatch
}) {
  const framing = useBuilder((s) => s.framing)
  const [selected, setSelected] = useState('framing')
  const milestone = project.milestones.find((m) => m.id === selected) ?? project.milestones[0]

  const statusOf = (id: string, fallback: string) => (id === 'framing' ? framingStatus(framing) : fallback)

  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" aria-label="Milestones" className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {project.milestones.map((m) => {
          const active = m.id === milestone.id
          return (
            <button
              key={m.id}
              role="tab"
              type="button"
              aria-selected={active}
              aria-controls="milestone-panel"
              onClick={() => setSelected(m.id)}
              className={cn(
                'flex flex-col items-start gap-2 rounded-md border px-4 py-3 text-left',
                active ? 'border-ink ring-1 ring-ink' : 'border-hairline hover:border-control',
              )}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="font-mono text-[12px] text-label">{String(m.number).padStart(2, '0')}</span>
                <span className="tnum text-[14px] text-label">{formatWhole(m.amount)}</span>
              </span>
              <span className="text-[16px] font-medium">{m.name}</span>
              <StatusTag status={statusOf(m.id, m.status)} />
            </button>
          )
        })}
      </div>

      <div id="milestone-panel" role="tabpanel" className="flex flex-col gap-6">
        {milestone.id === 'framing' ? (
          <FramingPanel project={project} runs={runs} match={match} stage={framing} />
        ) : releases[milestone.id] ? (
          <ReleasedPanel name={milestone.name} amount={milestone.amount} tx={releases[milestone.id]} />
        ) : (
          <div className="panel px-6 py-5">
            <p className="t-card">Waiting for evidence</p>
            <p className="t-label">
              {milestone.name} · {formatWhole(milestone.amount)} RLUSD in escrow · due {milestone.due}
            </p>
          </div>
        )}
        <RequiredEvidence project={project} milestoneId={milestone.id} stage={framing} />
      </div>
    </div>
  )
}

function FramingPanel({
  project,
  runs,
  match,
  stage,
}: {
  project: Project
  runs: { reused?: CheckRun; honest?: CheckRun }
  match: PhotoMatch
  stage: FramingStage
}) {
  const framing = project.milestones.find((m) => m.id === 'framing')!
  const [compareOpen, setCompareOpen] = useState(false)
  const run = stage === 'failed' ? runs.reused : runs.honest
  if (!run) return null
  const mode: PanelMode = stage === 'queued' ? 'queued' : stage === 'checking' ? 'idle' : 'resolved'

  return (
    <>
      <ChecksPanel
        key={stage}
        run={run}
        amount={framing.amount}
        mode={mode}
        runToken={stage === 'checking' ? 1 : 0}
        onDone={() => stage === 'checking' && builderActions.finishChecks()}
        label="Framing"
        failuresFirst
        failDetail={(check, openCompare) =>
          check.compare ? (
            <div className="mt-3 flex flex-col gap-3">
              <div className="grid max-w-md grid-cols-2 gap-3">
                <Thumb src={match.submitted.src} caption={`Maple St, ${match.submitted.file}`} />
                <Thumb src={match.archive.src} caption={match.archive.project} flipped />
              </div>
              <div className="flex items-center gap-4">
                <Button size="sm" onClick={() => builderActions.openUpload('framing')}>
                  Replace photo
                </Button>
                <button type="button" onClick={openCompare} className="text-[14px] underline underline-offset-4 hover:no-underline">
                  Compare photos
                </button>
              </div>
            </div>
          ) : null
        }
      />
      <PhotoCompare open={compareOpen} onOpenChange={setCompareOpen} />
    </>
  )
}

function Thumb({ src, caption, flipped }: { src: string; caption: string; flipped?: boolean }) {
  return (
    <figure className="flex flex-col gap-1.5">
      <img src={src} alt={caption} className={cn('aspect-[4/3] w-full rounded-sm object-cover', flipped && '-scale-x-100')} />
      <figcaption className="t-caption text-label">{caption}</figcaption>
    </figure>
  )
}

function ReleasedPanel({ name, amount, tx }: { name: string; amount: number; tx: LedgerTx }) {
  return (
    <section aria-label={`${name} outcome`} className="panel flex flex-col gap-4 px-6 py-5 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="t-card text-ok">Released</p>
        <p className="mt-1 text-[16px]">
          <span className="tnum">{formatRLUSD(amount)}</span> RLUSD sent to your wallet
        </p>
        <p className="t-label">{tx.time}</p>
      </div>
      <LedgerLink tx={tx} />
    </section>
  )
}

function RequiredEvidence({ project, milestoneId, stage }: { project: Project; milestoneId: string; stage: FramingStage }) {
  const reqs = getRequirements(project.slug, milestoneId)
  if (reqs.length === 0) return null
  const resubmitted = milestoneId === 'framing' && stage !== 'failed'
  const released = project.milestones.find((m) => m.id === milestoneId)?.status === 'Released'
  return (
    <section aria-labelledby="required-evidence">
      <h3 id="required-evidence" className="mb-3 t-card">
        Required evidence
      </h3>
      <ul className="divide-y divide-hairline border-y border-hairline">
        {reqs.map((r) => {
          const have = resubmitted && r.unit === 'photo' ? r.need : r.have
          const complete = have >= r.need
          const audit = r.unit === 'audit'
          const status = audit
            ? released || (milestoneId === 'framing' && stage === 'passed')
              ? 'Complete'
              : 'Waiting for audit'
            : complete
              ? 'Complete'
              : 'Missing'
          const unit = r.unit === 'photo' ? `photo${r.need === 1 ? '' : 's'}` : r.unit
          return (
            <li key={r.id} className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-2 py-2">
              <span className="flex-1 text-[15px]">
                {r.label}
                {!audit && (
                  <span className="tnum text-label">
                    : {have} of {r.need} {unit}
                  </span>
                )}
              </span>
              <StatusTag status={status} />
              {!complete && !audit && (
                <Button variant="secondary" size="sm" onClick={() => builderActions.openUpload(milestoneId)}>
                  Upload
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
