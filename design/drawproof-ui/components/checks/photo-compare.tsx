'use client'

import { useRef, useState } from 'react'
import { Modal } from '@/components/modal'
import { CropMarks } from '@/components/evidence-photo'
import { getPhotoMatch } from '@/lib/api'
import { cn } from '@/lib/utils'

export function PhotoCompare({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const match = getPhotoMatch()
  const [mode, setMode] = useState<'side' | 'overlay'>('side')
  const [pos, setPos] = useState(50)
  const frame = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  function moveTo(clientX: number) {
    const rect = frame.current?.getBoundingClientRect()
    if (!rect) return
    setPos(Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100)))
  }

  const caption = (p: typeof match.submitted) => (
    <figcaption className="mt-2 flex flex-col">
      <span className="t-mono">{p.file} · {p.project}</span>
      <span className="t-mono text-label">Sample photo · {p.captured}</span>
    </figcaption>
  )

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Compare photos" meta="Maple St Duplex · Framing" className="max-w-[880px]">
      <div className="flex flex-col gap-5 px-6 py-5">
        <div className="flex items-center justify-between gap-4">
          <div role="radiogroup" aria-label="View" className="inline-flex rounded-md border border-control p-0.5">
            {(['side', 'overlay'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cn('h-8 rounded-[4px] px-3 text-[14px]', mode === m ? 'bg-ink text-white' : 'text-ink hover:bg-accent')}
              >
                {m === 'side' ? 'Side by side' : 'Overlay'}
              </button>
            ))}
          </div>
          <p className="tnum font-mono text-[13px]">
            Distance {match.distance} of {match.bits} (fails at {match.threshold} or less)
          </p>
        </div>

        {mode === 'side' ? (
          <div className="grid grid-cols-2 gap-6">
            <figure>
              <div className="relative"><CropMarks /><img src={match.submitted.src} alt="Submitted photo IMG_2231.jpg" className="aspect-[4/3] w-full rounded-sm object-cover" /></div>
              {caption(match.submitted)}
            </figure>
            <figure>
              <div className="relative"><CropMarks /><img src={match.archive.src} alt="Archived photo from Oak Ave Renovation" className="aspect-[4/3] w-full -scale-x-100 rounded-sm object-cover" /></div>
              {caption(match.archive)}
            </figure>
          </div>
        ) : (
          <figure>
            <div
              ref={frame}
              className="relative aspect-[16/9] w-full touch-none overflow-hidden rounded-sm select-none"
              onPointerDown={(e) => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); moveTo(e.clientX) }}
              onPointerMove={(e) => dragging.current && moveTo(e.clientX)}
              onPointerUp={() => { dragging.current = false }}
            >
              <img src={match.archive.src} alt="Archived photo from Oak Ave Renovation" className="absolute inset-0 size-full -scale-x-100 object-cover" />
              <img
                src={match.submitted.src}
                alt="Submitted photo IMG_2231.jpg"
                className="absolute inset-0 size-full object-cover"
                style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
              />
              <div
                role="slider"
                tabIndex={0}
                aria-label="Divider position"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(pos)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft') setPos((p) => Math.max(0, p - 5))
                  if (e.key === 'ArrowRight') setPos((p) => Math.min(100, p + 5))
                }}
                className="absolute top-0 bottom-0 w-px cursor-ew-resize bg-white outline-none focus-visible:w-0.5"
                style={{ left: `${pos}%` }}
              >
                <span className="absolute top-1/2 left-1/2 flex h-8 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-sm border border-ink bg-white" />
              </div>
              <span className="absolute top-2 left-2 rounded-sm bg-white px-1.5 t-mono">{match.submitted.file}</span>
              <span className="absolute top-2 right-2 rounded-sm bg-white px-1.5 t-mono">{match.archive.file}</span>
            </div>
            <figcaption className="mt-2 t-mono text-label">Sample photos · drag the divider or use arrow keys</figcaption>
          </figure>
        )}
      </div>
    </Modal>
  )
}
