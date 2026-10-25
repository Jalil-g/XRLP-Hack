'use client'

import { AlertTriangle, Camera, Check, ClipboardCheck, FileSearch, PenLine, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { CoverBand, DetailLayout, Section } from '@/components/detail-shell'
import { EvidencePhoto } from '@/components/evidence-photo'
import { PropertyRows } from '@/components/property-rows'
import { StatusTag } from '@/components/status-tag'
import { TitleBlock } from '@/components/title-block'
import { Button, buttonVariants } from '@/components/ui/button'
import { LedgerLink } from '@/components/xrpl/ledger-drawer'
import { SigningFlow } from '@/components/xrpl/signing-flow'
import { formatDistance, shortDigest, shortKey } from '@/lib/api'
import { inspectorActions, useInspector } from '@/lib/inspector-store'
import {
  emptyLines,
  inspectorProfile,
  SITE_RADIUS_M,
  type AuditSpec,
  type EvidencePhoto as Photo,
  type EvidenceSet,
  type LedgerTx,
  type LineState,
  type Project,
  type Wallet,
} from '@/lib/mock-data'
import { cn } from '@/lib/utils'

const STATES: LineState[] = ['Done', 'Partial', 'Not started']

type StepId = 'evidence' | 'checklist' | 'photos' | 'review' | 'sign'

function stepsFor(kind: AuditSpec['kind']): { id: StepId; label: string; icon: typeof Camera }[] {
  const first = kind === 'visit' ? 'Site' : 'Evidence'
  const third = kind === 'visit' ? 'Photos' : 'Site photos'
  return [
    { id: 'evidence', label: first, icon: FileSearch },
    { id: 'checklist', label: 'Checklist', icon: ClipboardCheck },
    { id: 'photos', label: third, icon: Camera },
    { id: 'review', label: 'Review', icon: ShieldCheck },
    { id: 'sign', label: 'Sign', icon: PenLine },
  ]
}

export function AuditWorkspace({
  spec,
  project,
  wallet,
  photoIndex,
}: {
  spec: AuditSpec
  project: Project
  wallet: Wallet
  photoIndex: Record<string, Photo>
}) {
  const keyLoaded = useInspector((s) => s.keyLoaded)
  const steps = stepsFor(spec.kind)
  const [step, setStep] = useState<StepId>('evidence')
  const [visited, setVisited] = useState<Set<StepId>>(new Set(['evidence']))
  const [lines, setLines] = useState<Record<string, LineState | undefined>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [sitePhotos, setSitePhotos] = useState<string[]>([])
  const [evidence, setEvidence] = useState<EvidenceSet | undefined>(spec.evidence)
  const [changed, setChanged] = useState(false)
  const [signOpen, setSignOpen] = useState(false)
  const [filed, setFiled] = useState<LedgerTx | null>(null)

  const doneCount = spec.lines.filter((l) => lines[l.id] === 'Done').length
  const decided = spec.lines.every((l) => lines[l.id])
  const needsNote = spec.lines.some((l) => (lines[l.id] === 'Partial' || lines[l.id] === 'Not started') && !(notes[l.id] ?? '').trim())
  const checklistResult = `${doneCount} of ${spec.lines.length} done`
  const candidates = useMemo(() => spec.photoCandidates.map((f) => photoIndex[f]).filter(Boolean), [spec, photoIndex])
  const added = sitePhotos.map((f) => photoIndex[f]).filter(Boolean)

  const go = (id: StepId) => {
    setStep(id)
    setVisited((v) => new Set(v).add(id))
  }
  const idx = steps.findIndex((s) => s.id === step)
  const canReview = decided && !needsNote && sitePhotos.length > 0 && !changed

  const next = () => {
    const to = steps[idx + 1]
    if (to) go(to.id)
  }

  function addPhoto() {
    const nextFile = spec.photoCandidates.find((f) => !sitePhotos.includes(f))
    if (nextFile) setSitePhotos((p) => [...p, nextFile])
  }

  function reloadEvidence() {
    if (spec.evidenceNext) setEvidence(spec.evidenceNext)
    setChanged(false)
    go('evidence')
  }

  function onConfirmed(tx: LedgerTx) {
    setFiled(tx)
    inspectorActions.file({
      id: tx.hash,
      key: spec.key,
      projectSlug: spec.projectSlug,
      subject: spec.subject,
      filed: 'Oct 25, 2026',
      lines: spec.lines.map((l) => ({ trade: l.trade, state: lines[l.id] ?? 'Done', note: notes[l.id] || undefined })),
      sitePhotos,
      evidenceVersion: evidence?.version ?? null,
      outcome: 'Waiting',
      tx,
    })
    go('sign')
  }

  const primary =
    step === 'review' ? (
      keyLoaded ? (
        <Button className="w-full" disabled={!canReview} onClick={() => setSignOpen(true)}>
          Sign and file audit
        </Button>
      ) : (
        <Button className="w-full" onClick={() => inspectorActions.openKeyDialog()}>
          Load key to sign
        </Button>
      )
    ) : step === 'sign' ? (
      <Link href="/inspector" className={cn(buttonVariants(), 'w-full')}>
        Back to queue
      </Link>
    ) : (
      <Button className="w-full" onClick={next} disabled={step === 'checklist' && (!decided || needsNote)}>
        Continue
      </Button>
    )

  const nav = (
    <nav aria-label="Audit steps" className="flex flex-col">
      {steps.map((s, i) => {
        const complete = filed ? true : visited.has(s.id) && i < idx
        const current = s.id === step
        return (
          <button
            key={s.id}
            type="button"
            disabled={!!filed && s.id !== 'sign'}
            onClick={() => go(s.id)}
            aria-current={current ? 'step' : undefined}
            className={cn('flex h-10 items-center gap-2.5 rounded-sm px-2 text-left text-[15px] hover:bg-accent disabled:opacity-60', current && 'bg-accent font-medium')}
          >
            <span className={cn('flex size-5 items-center justify-center rounded-full border text-[12px]', complete ? 'border-ok bg-ok-bg text-ok' : 'border-control')}>
              {complete ? <Check className="size-3" strokeWidth={2} aria-hidden /> : i + 1}
            </span>
            {s.label}
          </button>
        )
      })}
    </nav>
  )

  return (
    <>
      <CoverBand project={project} kicker={spec.kicker} height="h-[200px]" />
      <DetailLayout
        primary={primary}
        secondary={
          step !== 'sign' && idx > 0 ? (
            <Button variant="secondary" className="w-full" onClick={() => go(steps[idx - 1]!.id)}>
              Back
            </Button>
          ) : undefined
        }
        nav={nav}
        quiet={
          <Link href="/inspector" className="px-2 text-left text-[14px] underline underline-offset-4 hover:no-underline">
            Back to queue
          </Link>
        }
        wide
      >
        {changed && (
          <div role="alert" className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-md bg-warn-bg px-4 py-3 text-warn">
            <p className="flex items-center gap-2 text-[15px] font-medium">
              <AlertTriangle className="size-4" strokeWidth={1.75} aria-hidden />
              Evidence changed to v{spec.evidenceNext?.version}. Review again.
            </p>
            <Button size="sm" variant="secondary" onClick={reloadEvidence}>
              Reload evidence
            </Button>
          </div>
        )}

        {step === 'evidence' && (
          <Section id="evidence" title={spec.kind === 'visit' ? 'Site' : 'Evidence'} first aside={evidence && <span className="t-mono text-label">Evidence v{evidence.version} · {shortDigest(evidence.hash)}</span>}>
            {spec.kind === 'visit' && spec.site ? (
              <PropertyRows rows={spec.site.map(([label, value]) => ({ label, value }))} />
            ) : (
              evidence && (
                <>
                  <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
                    {evidence.photos.map((f) => photoIndex[f] && <EvidencePhoto key={f} photo={photoIndex[f]!} />)}
                  </div>
                  <h3 className="mt-10 mb-3 text-[20px] leading-[26px]">Invoices</h3>
                  <PropertyRows rows={evidence.invoices.map((i) => ({ label: `${i.number} · ${i.vendor}`, value: <span>{i.description} · {i.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span> }))} />
                  {spec.evidenceNext && !changed && evidence.version === spec.evidence?.version && (
                    <p className="mt-8 text-[13px] text-label">
                      Demo control (mock):{' '}
                      <button type="button" className="underline underline-offset-4 hover:no-underline" onClick={() => setChanged(true)}>
                        Builder resubmits evidence
                      </button>
                    </p>
                  )}
                </>
              )
            )}
          </Section>
        )}

        {step === 'checklist' && (
          <Section id="checklist" title="Checklist" first aside={<span className="tnum text-[15px] text-label">{checklistResult}</span>}>
            <ul className="divide-y divide-hairline border-t border-hairline">
              {spec.lines.map((l) => {
                const state = lines[l.id]
                return (
                  <li key={l.id} className="py-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-[16px]">{l.trade}</p>
                        {l.amount !== undefined && <p className="tnum text-[13px] text-label">{l.amount.toLocaleString('en-US')} RLUSD line</p>}
                      </div>
                      <div role="radiogroup" aria-label={l.trade} className="inline-flex overflow-hidden rounded-md border border-control">
                        {STATES.map((s) => (
                          <button
                            key={s}
                            type="button"
                            role="radio"
                            aria-checked={state === s}
                            onClick={() => setLines((m) => ({ ...m, [l.id]: s }))}
                            className={cn('h-9 border-r border-control px-3 text-[14px] last:border-r-0', state === s ? 'bg-ink text-white' : 'bg-white hover:bg-accent')}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                    {(state === 'Partial' || state === 'Not started') && (
                      <div className="mt-3">
                        <label htmlFor={`note-${l.id}`} className="sr-only">
                          Note for {l.trade}
                        </label>
                        <input
                          id={`note-${l.id}`}
                          value={notes[l.id] ?? ''}
                          onChange={(e) => setNotes((m) => ({ ...m, [l.id]: e.target.value }))}
                          placeholder="What is missing?"
                          className="h-10 w-full rounded-md border border-control px-3 text-[15px] outline-none focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink/20"
                        />
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
            <div className="mt-4 flex items-center justify-between">
              <p className="tnum text-[15px]">{checklistResult}</p>
              <Button variant="secondary" size="sm" onClick={() => setLines(Object.fromEntries(spec.lines.map((l) => [l.id, 'Done' as LineState])))}>
                Mark all done
              </Button>
            </div>
          </Section>
        )}

        {step === 'photos' && (
          <Section id="photos" title={spec.kind === 'visit' ? 'Photos' : 'Site photos'} first aside={<Button size="sm" variant="secondary" onClick={addPhoto} disabled={sitePhotos.length >= candidates.length}>Add photo</Button>}>
            {added.length === 0 ? (
              <p className="py-8 text-center t-label">No photos yet. Add one from the site.</p>
            ) : (
              <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
                {added.map((p) => (
                  <div key={p.file} className="flex flex-col gap-1">
                    <EvidencePhoto photo={p} />
                    <p className={cn('tnum text-[13px]', p.distanceM > SITE_RADIUS_M ? 'font-medium text-bad' : 'text-label')}>
                      {formatDistance(p.distanceM)} from site{p.distanceM > SITE_RADIUS_M ? ' (outside radius)' : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {step === 'review' && (
          <Section id="review" title="Review" first>
            <p className="mb-6 text-[16px] leading-[26px]">
              You are filing a signed audit for {project.name}, {spec.subject}
              {evidence ? `, against evidence v${evidence.version}` : ''}. Filing does not release money; the checks decide.
            </p>
            <PropertyRows
              rows={[
                { label: 'Inspector', value: wallet.name },
                { label: 'License', value: inspectorProfile.license },
                { label: 'Project', value: project.name },
                { label: spec.kind === 'visit' ? 'Visit' : 'Milestone', value: spec.subject },
                { label: 'Evidence version', value: evidence ? `v${evidence.version}` : 'None' },
                { label: 'Checklist result', value: checklistResult },
                { label: 'Site photos', value: String(sitePhotos.length) },
                { label: 'Signing key', value: <span className="t-mono">{keyLoaded ? shortKey(wallet.address) : 'Not loaded'}</span> },
              ]}
            />
            {!canReview && (
              <p className="mt-5 text-[14px] text-warn">
                {!decided || needsNote ? 'Finish the checklist first.' : sitePhotos.length === 0 ? 'Add at least one site photo.' : 'Reload the changed evidence first.'}
              </p>
            )}
          </Section>
        )}

        {step === 'sign' && (
          <Section id="sign" title={filed ? 'Audit filed' : 'Sign'} first>
            {filed ? (
              <div className="flex flex-col gap-5" role="status">
                <p className="text-[18px] leading-7">{emptyLines.auditFiled}</p>
                <PropertyRows
                  rows={[
                    { label: 'Ledger index', value: filed.ledgerIndex.toLocaleString('en-US') },
                    { label: 'Attestation', value: <LedgerLink tx={filed} /> },
                    { label: 'Signed by', value: `${wallet.name} in this browser` },
                    { label: 'Status', value: <StatusTag status="Evidence in" /> },
                  ]}
                />
                <Link href={`/projects/${project.slug}`} className="text-[14px] underline underline-offset-4 hover:no-underline">
                  View project
                </Link>
              </div>
            ) : (
              <p className="t-label">Review the audit, then sign it.</p>
            )}
          </Section>
        )}

        <TitleBlock project={project.name} sheet={`0${idx + 1} of 05`} revision="D" />
      </DetailLayout>

      <SigningFlow
        open={signOpen}
        onOpenChange={setSignOpen}
        onConfirmed={onConfirmed}
        request={{
          title: 'Review audit',
          meta: `${project.name} · ${spec.subject}`,
          from: { name: wallet.name, address: wallet.address },
          to: { name: `${project.name} account`, address: project.projectAccount },
          amount: null,
          ledgerAction: 'Audit attestation',
          txAction: 'Audit attestation',
          txLabel: 'Audit filed',
          actionLabel: 'Sign and file audit',
          projectSlug: project.slug,
          milestoneId: spec.key.split('/')[1],
          extraRows: [['Checklist', checklistResult]],
          note: 'Your signature attests that you inspected this site in person. Filing does not release money; the checks decide.',
        }}
      />
    </>
  )
}
