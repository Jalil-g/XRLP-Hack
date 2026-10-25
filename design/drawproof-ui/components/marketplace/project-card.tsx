import Link from 'next/link'
import { CoverTile } from '@/components/cover-tile'
import { PropertyRows } from '@/components/property-rows'
import { Chip, StatusTag } from '@/components/status-tag'
import { buttonVariants } from '@/components/ui/button'
import { formatWhole } from '@/lib/api'
import type { Project } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

export function ProjectCard({ project }: { project: Project }) {
  return (
    <article className="panel flex flex-col gap-5 p-5">
      <CoverTile project={project} />
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <p className="t-label">
            {project.category} · {project.town}
          </p>
          <div className="flex gap-1.5">
            {project.sample && <Chip>Sample</Chip>}
            <StatusTag status={project.status} />
          </div>
        </div>
        <h3 className="t-card">{project.name}</h3>
      </div>
      <PropertyRows
        rows={[
          { label: 'Rate', value: `${project.ratePct.toFixed(2)}%` },
          { label: 'Term', value: `${project.termDays} days` },
          { label: 'Raised', value: `${formatWhole(project.raised)} of ${formatWhole(project.principal)}` },
        ]}
      />
      <Link href={`/projects/${project.slug}`} className={cn(buttonVariants({ variant: 'secondary' }), 'w-full')}>
        View project
      </Link>
    </article>
  )
}
