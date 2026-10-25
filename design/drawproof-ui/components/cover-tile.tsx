import type { Project } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

export function CoverTile({ project, className, label = true }: { project: Project; className?: string; label?: boolean }) {
  const { tone, photo } = project.cover
  return (
    <div
      className={cn(
        'relative flex aspect-[16/7] flex-col justify-end overflow-hidden rounded-md p-5',
        tone === 'clay' ? 'bg-clay' : 'bg-ink',
        className,
      )}
    >
      {photo && (
        <>
          <img src={photo} alt="" className="absolute inset-0 size-full object-cover" />
          <div className="absolute inset-0 bg-ink/40" aria-hidden />
        </>
      )}
      {label && (
      <div className="relative">
        <p className="text-[28px] leading-9 text-white">{project.street}</p>
        <p className="text-[15px] text-white/70">{project.town}</p>
      </div>
      )}
      {photo && <p className="absolute top-3 right-3 t-caption text-white/80">Sample photo</p>}
    </div>
  )
}
