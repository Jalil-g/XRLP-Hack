import Link from 'next/link'
import { CoverTile } from '@/components/cover-tile'
import { PropertyRows } from '@/components/property-rows'
import { Chip, StatusTag } from '@/components/status-tag'
import { buttonVariants } from '@/components/ui/button'
import { formatWhole, getNextMilestone, getProjectMoney } from '@/lib/api'
import type { Project } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

export function BuilderProjectCard({ project }: { project: Project }) {
  const money = getProjectMoney(project)
  const next = getNextMilestone(project)
  return (
    <article className="panel flex flex-col gap-5 p-5">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <CoverTile project={project} label={false} className="aspect-auto min-h-48" />
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="t-label">
              {project.category} · {project.town}
            </p>
            {project.sample && <Chip>Sample</Chip>}
          </div>
          <h3 className="text-[22px] leading-7 font-medium">{project.name}</h3>
          <PropertyRows
            className="mt-1"
            rows={[
              { label: 'Status', value: <StatusTag status={project.status} /> },
              { label: 'Raised', value: `${formatWhole(project.raised)} / ${formatWhole(project.principal)} RLUSD` },
              { label: 'Released', value: `${formatWhole(money.released)} RLUSD` },
              { label: 'Next milestone', value: next ? next.name : 'None' },
            ]}
          />
        </div>
      </div>
      <Link href={`/builder/projects/${project.slug}`} className={cn(buttonVariants({ variant: 'secondary' }), 'w-full')}>
        Open project
      </Link>
    </article>
  )
}

export function NewProjectCard({ className }: { className?: string }) {
  return (
    <article className={cn('flex flex-col items-center justify-center gap-3 rounded-md border border-dashed border-control p-8 text-center', className)}>
      <h3 className="t-card">New project</h3>
      <p className="max-w-80 t-label">Set up the schedule of values, documents and verification fee for your next build.</p>
      <Link href="/builder/new" className={cn(buttonVariants(), 'mt-2')}>
        Start a project
      </Link>
    </article>
  )
}
