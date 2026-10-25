'use client'

import { Check, Upload } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { SideSheet } from '@/components/side-sheet'
import { Button } from '@/components/ui/button'
import { formatDistance, formatWhole, shortFileHash } from '@/lib/api'
import { builderActions, useBuilder } from '@/lib/builder-store'
import { photos, SITE_RADIUS_M, uploadCandidates, type Project } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

type Step = 'choose' | 'review' | 'submit'
const STEPS: { id: Step; label: string }[] = [
  { id: 'choose', label: 'Choose' },
  { id: 'review', label: 'Review' },
  { id: 'submit', label: 'Submit' },
]

interface Candidate {
  file: string
  src: string
  captured: string
  distanceM: number | null
  sample: boolean
  flipped?: boolean
}

const DEFAULT_PICK = ['IMG_2228.jpg', 'IMG_2230.jpg', 'IMG_2232.jpg', 'IMG_2235.jpg']

export function UploadSheet({ project }: { project: Project }) {
  const upload = useBuilder((s) => s.upload)
  const milestone = project.milestones.find((m) => m.id === upload?.milestoneId)
  const [step, setStep] = useState<Step>('choose')
  const [extra, setExtra] = useState<Candidate[]>([])
  const [picked, setPicked] = useState<string[]>(DEFAULT_PICK)
  const [hashed, setHashed] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (upload) {
      setStep('choose')
      setHashed(0)
      setPicked(upload.milestoneId === 'framing' ? DEFAULT_PICK : [])
    }
  }, [upload])

  const candidates: Candidate[] = [
    ...uploadCandidates.map((f) => ({ ...photos[f], distanceM: photos[f].distanceM as number | null })),
    ...extra,
  ]
  const chosen = candidates.filter((c) => picked.includes(c.file))
  const outside = chosen.filter((c) => c.distanceM !== null && c.distanceM > SITE_RADIUS_M)

  function addFiles(files: FileList | null) {
    if (!files) return
    const added = Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .map((f) => ({
        file: f.name,
        src: URL.createObjectURL(f),
        captured: new Date(f.lastModified).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }),
        distanceM: null,
        sample: false,
      }))
    setExtra((e) => [...e, ...added])
    setPicked((p) => [...p, ...added.map((a) => a.file)])
  }

  function submit() {
    setStep('submit')
    let n = 0
    const timer = setInterval(() => {
      n += 1
      setHashed(n)
      if (n >= chosen.length) {
        clearInterval(timer)
        setTimeout(() => builderActions.submitEvidence(milestone!.id, chosen.map((c) => c.file)), 400)
      }
    }, 180)
  }

  if (!milestone) return null
  const count = chosen.length
  const noun = `${count} photo${count === 1 ? '' : 's'}`

  return (
    <SideSheet
      open={!!upload}
      onOpenChange={(o) => !o && builderActions.closeUpload()}
      busy={step === 'submit'}
      title="Upload evidence"
      description={`${project.name} · ${milestone.name}`}
      steps={STEPS}
      step={step}
    >
      {step === 'choose' && (
        <div className="flex flex-col gap-5">
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              addFiles(e.dataTransfer.files)
            }}
            className="flex flex-col items-center gap-2 rounded-md border border-dashed border-control px-6 py-7 text-center"
          >
            <Upload className="size-5 text-label" aria-hidden />
            <p className="text-[15px]">Drop photos here</p>
            <p className="t-caption text-label">Location and capture time are read from each photo.</p>
            <Button variant="secondary" size="sm" className="mt-1" onClick={() => input.current?.click()}>
              Choose files
            </Button>
            <input ref={input} type="file" accept="image/*" multiple className="sr-only" onChange={(e) => addFiles(e.target.files)} tabIndex={-1} />
          </div>

          <fieldset>
            <legend className="mb-3 flex w-full items-center justify-between">
              <span className="t-label">Photos</span>
            </legend>
            <ul className="grid grid-cols-2 gap-3">
              {candidates.map((c) => {
                const on = picked.includes(c.file)
                const far = c.distanceM !== null && c.distanceM > SITE_RADIUS_M
                return (
                  <li key={c.file}>
                    <label className={cn('flex cursor-pointer flex-col overflow-hidden rounded-md border', on ? 'border-ink ring-1 ring-ink' : 'border-hairline hover:border-control')}>
                      <span className="relative block aspect-[4/3] bg-paper">
                        <img src={c.src} alt={c.file} className={cn('size-full object-cover', c.flipped && '-scale-x-100')} />
                        <span
                          className={cn(
                            'absolute top-2 left-2 flex size-6 items-center justify-center rounded-sm border',
                            on ? 'border-ink bg-ink text-white' : 'border-white bg-white/80',
                          )}
                          aria-hidden
                        >
                          {on && <Check className="size-4" />}
                        </span>
                        {c.sample && <span className="absolute right-2 bottom-1.5 t-caption text-white drop-shadow">Sample photo</span>}
                      </span>
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={on}
                        onChange={() => setPicked((p) => (on ? p.filter((f) => f !== c.file) : [...p, c.file]))}
                      />
                      <span className="flex flex-col gap-0.5 px-3 py-2.5">
                        <span className="t-mono truncate">{c.file}</span>
                        <span className="t-caption text-label">{c.captured}</span>
                        <span className={cn('t-caption', far ? 'text-bad' : 'text-label')}>
                          {c.distanceM === null ? 'No location' : `${formatDistance(c.distanceM)} from site`}
                        </span>
                        <span className="t-mono text-[12px] text-label">#{shortFileHash(c.file)}</span>
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </fieldset>
          {outside.length > 0 && (
            <p role="alert" className="text-[14px] text-bad">
              {outside.length} photo{outside.length > 1 ? 's are' : ' is'} outside the {SITE_RADIUS_M} m site radius and will fail the location check.
            </p>
          )}
          <Button className="w-full" disabled={count === 0} onClick={() => setStep('review')}>
            Continue with {noun}
          </Button>
        </div>
      )}

      {step === 'review' && (
        <div className="flex flex-col gap-5">
          <p className="text-[16px] leading-6">
            Submitting starts checks for {milestone.name}. If every check passes and the audit is signed, {formatWhole(milestone.amount)} RLUSD is released to your wallet.
          </p>
          <ul className="divide-y divide-hairline border-y border-hairline">
            {chosen.map((c) => (
              <li key={c.file} className="flex min-h-11 items-center justify-between gap-3 py-2">
                <span className="t-mono">{c.file}</span>
                <span className="t-mono text-label">#{shortFileHash(c.file)}</span>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setStep('choose')}>
              Back
            </Button>
            <Button onClick={submit}>Submit {noun}</Button>
          </div>
        </div>
      )}

      {step === 'submit' && (
        <div className="flex flex-col gap-5" aria-live="polite">
          <p className="t-card">{hashed >= count ? 'Submitted' : `Uploading ${noun}`}</p>
          <ul className="divide-y divide-hairline border-y border-hairline">
            {chosen.map((c, i) => (
              <li key={c.file} className="flex min-h-11 items-center justify-between gap-3 py-2">
                <span className="t-mono">{c.file}</span>
                <span className={cn('text-[14px]', i < hashed ? 'text-ok' : 'text-label')}>{i < hashed ? 'Hashed' : 'Waiting'}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SideSheet>
  )
}
