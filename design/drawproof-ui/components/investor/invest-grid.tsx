'use client'

import { useState } from 'react'
import { PlainSelect } from '@/components/plain-select'
import type { Project } from '@/lib/mock-data'
import { GridProjectCard } from './project-cards'

export function InvestGrid({ projects }: { projects: Project[] }) {
  const [status, setStatus] = useState('all')
  const [type, setType] = useState('all')
  const statuses = [...new Set(projects.map((p) => p.status))]
  const types = [...new Set(projects.map((p) => p.category))]
  const shown = projects.filter((p) => (status === 'all' || p.status === status) && (type === 'all' || p.category === type))

  return (
    <div className="container-app py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <h1 className="t-page">Projects</h1>
        <div className="flex gap-3">
          <PlainSelect
            label="Filter by status"
            value={status}
            onChange={setStatus}
            className="w-44"
            options={[{ value: 'all', label: 'All statuses' }, ...statuses.map((s) => ({ value: s, label: s }))]}
          />
          <PlainSelect
            label="Filter by type"
            value={type}
            onChange={setType}
            className="w-40"
            options={[{ value: 'all', label: 'All types' }, ...types.map((t) => ({ value: t, label: t }))]}
          />
        </div>
      </div>
      {shown.length ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {shown.map((p) => (
            <GridProjectCard key={p.slug} project={p} />
          ))}
        </div>
      ) : (
        <p className="panel p-6 t-label">No projects match these filters.</p>
      )}
    </div>
  )
}
