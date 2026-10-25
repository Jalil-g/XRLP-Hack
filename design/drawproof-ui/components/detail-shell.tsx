import type { LucideIcon } from 'lucide-react'
import type { Project } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

export interface SectionLink {
  id: string
  label: string
  icon: LucideIcon
}

export function CoverBand({
  project,
  kicker,
  tall = false,
  badges,
  height = 'h-44',
}: {
  project: Project
  kicker?: string
  tall?: boolean
  badges?: React.ReactNode
  height?: string
}) {
  const { tone, photo } = project.cover
  if (tall)
    return (
      <div className="relative overflow-hidden bg-ink">
        {photo && <img src={photo} alt="" className="absolute inset-0 size-full object-cover" />}
        <div className="absolute inset-0 bg-ink/40" aria-hidden />
        <div className="container-app relative flex h-[320px] flex-col justify-end pb-8">
          {badges && <div className="absolute top-6 right-6 flex gap-1.5 md:right-8">{badges}</div>}
          <p className="text-[20px] leading-7 text-white">{kicker ?? project.builder}</p>
          <h1 className="text-[44px] leading-[52px] font-medium tracking-tight text-white">{project.name}</h1>
          {photo && <p className="absolute right-6 bottom-4 t-caption text-white/80 md:right-8">Sample photo</p>}
        </div>
      </div>
    )
  return (
    <div className={cn('relative overflow-hidden', tone === 'clay' ? 'bg-clay' : 'bg-ink')}>
      {photo && (
        <>
          <img src={photo} alt="" className="absolute inset-0 size-full object-cover" />
          <div className="absolute inset-0 bg-ink/40" aria-hidden />
        </>
      )}
      <div className={cn('container-app relative flex flex-col justify-end pb-7', height)}>
        <p className="text-[18px] text-white">{kicker ?? project.builder}</p>
        <h1 className="t-page text-white">{project.name}</h1>
      </div>
      {photo && <p className="absolute top-3 right-4 t-caption text-white/80">Sample photo</p>}
    </div>
  )
}

export function DetailLayout({
  primary,
  secondary,
  sections = [],
  nav,
  quiet,
  children,
  wide = false,
}: {
  primary?: React.ReactNode
  secondary?: React.ReactNode
  sections?: SectionLink[]
  nav?: React.ReactNode
  quiet?: React.ReactNode
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <div className={cn('container-app grid grid-cols-1 gap-8 py-8', wide ? 'lg:grid-cols-[300px_1fr]' : 'lg:grid-cols-[256px_1fr]')}>
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="panel flex flex-col gap-3 p-5">
          {primary}
          {secondary}
          {(primary || secondary) && <hr className="my-2 border-hairline" />}
          {nav ?? (
            <nav aria-label="Sections" className="flex flex-col">
              {sections.map((s) => (
                <a key={s.id} href={`#${s.id}`} className="flex h-10 items-center gap-2.5 rounded-sm px-2 text-[15px] hover:bg-accent">
                  <s.icon className="size-4" strokeWidth={1.5} aria-hidden />
                  {s.label}
                </a>
              ))}
            </nav>
          )}
          {quiet && (
            <>
              <hr className="my-2 border-hairline" />
              {quiet}
            </>
          )}
        </div>
      </aside>
      <div className="panel min-w-0 px-8 py-7">{children}</div>
    </div>
  )
}

export function Section({
  id,
  title,
  children,
  first,
  aside,
}: {
  id: string
  title: string
  children: React.ReactNode
  first?: boolean
  aside?: React.ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={cn('scroll-mt-24', !first && 'mt-16')}>
      <div className={cn('flex items-center justify-between gap-4', first ? 'mb-5' : 'mb-6')}>
        <h2 id={`${id}-title`} className="t-section">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  )
}
