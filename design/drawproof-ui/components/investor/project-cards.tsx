import Link from 'next/link'
import { CoverTile } from '@/components/cover-tile'
import { PropertyRows } from '@/components/property-rows'
import { Chip, StatusTag } from '@/components/status-tag'
import { buttonVariants } from '@/components/ui/button'
import { formatWhole } from '@/lib/api'
import type { Project } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

function Meta({ project }: { project: Project }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <p className="t-label">
        {project.category} · {project.town}
      </p>
      {project.sample && <Chip>Sample</Chip>}
    </div>
  )
}

export function OpenProjectCard({ project }: { project: Project }) {
  return (
    <article className="panel flex flex-col gap-5 p-5">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <CoverTile project={project} label={false} className="aspect-auto min-h-48" />
        <div className="flex flex-col gap-2">
          <Meta project={project} />
          <h3 className="text-[22px] leading-7 font-medium">{project.name}</h3>
          <PropertyRows
            className="mt-1"
            rows={[
              { label: 'Rate', value: `${project.ratePct.toFixed(2)}%` },
              { label: 'Term', value: `${project.termDays} days` },
              { label: 'Raised', value: `${formatWhole(project.raised)} / ${formatWhole(project.principal)} RLUSD` },
              { label: 'Closes', value: project.closes },
            ]}
          />
        </div>
      </div>
      <Link href={`/projects/${project.slug}`} className={cn(buttonVariants({ variant: 'secondary' }), 'w-full')}>
        View project
      </Link>
    </article>
  )
}

export function GridProjectCard({ project }: { project: Project }) {
  return (
    <article className="panel flex flex-col gap-4 p-5">
      <CoverTile project={project} label={false} className="aspect-[16/9]" />
      <div className="flex flex-col gap-1">
        <Meta project={project} />
        <h3 className="text-[22px] leading-7 font-medium">{project.name}</h3>
      </div>
      <PropertyRows
        rows={[
          { label: 'Rate', value: `${project.ratePct.toFixed(2)}%` },
          { label: 'Term', value: `${project.termDays} days` },
          { label: 'Principal', value: `${formatWhole(project.principal)} RLUSD` },
          { label: 'Status', value: <StatusTag status={project.status} /> },
        ]}
      />
      <Link href={`/projects/${project.slug}`} className={cn(buttonVariants({ variant: 'secondary' }), 'mt-auto w-full')}>
        View project
      </Link>
    </article>
  )
}
