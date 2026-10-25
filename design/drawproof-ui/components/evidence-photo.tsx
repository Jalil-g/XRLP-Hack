import type { EvidencePhoto as Photo } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

export function CropMarks() {
  const mark = 'absolute size-3 border-ink'
  return (
    <span aria-hidden className="pointer-events-none absolute -inset-1.5">
      <span className={cn(mark, 'top-0 left-0 border-t border-l')} />
      <span className={cn(mark, 'top-0 right-0 border-t border-r')} />
      <span className={cn(mark, 'bottom-0 left-0 border-b border-l')} />
      <span className={cn(mark, 'right-0 bottom-0 border-r border-b')} />
    </span>
  )
}

export function EvidencePhoto({
  photo,
  flagged,
  hash,
  className,
}: {
  photo: Photo
  flagged?: boolean
  hash?: string
  className?: string
}) {
  return (
    <figure className={cn('flex flex-col gap-2', className)}>
      <div className="relative">
        <CropMarks />
        <img
          src={photo.src}
          alt={`Sample photo ${photo.file}`}
          className={cn('aspect-[4/3] w-full rounded-sm object-cover', photo.flipped && '-scale-x-100')}
        />
      </div>
      <figcaption className="flex flex-col gap-0.5">
        <span className="flex items-center justify-between gap-2 t-mono text-ink">
          {photo.file}
          {flagged && <span className="rounded-sm bg-bad-bg px-1.5 text-[12px] text-bad">Failed</span>}
        </span>
        <span className="t-mono text-label">
          Sample photo · {photo.captured} · {photo.distanceM} m from site
        </span>
        {hash && <span className="t-mono text-label">sha256 {hash}</span>}
      </figcaption>
    </figure>
  )
}
