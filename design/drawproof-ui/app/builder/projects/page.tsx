import type { Metadata } from 'next'
import { BuilderProjectCard, NewProjectCard } from '@/components/builder/builder-project-cards'
import { getProjects, getWallet } from '@/lib/api'

export const metadata: Metadata = { title: 'Projects' }

export default function BuilderProjectsPage() {
  const wallet = getWallet('builder')
  const mine = getProjects().filter((p) => p.builder === wallet.name)
  return (
    <div className="container-app py-8">
      <h1 className="mb-6 t-page">Projects</h1>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {mine.map((p) => (
          <BuilderProjectCard key={p.slug} project={p} />
        ))}
        <NewProjectCard className="min-h-72" />
      </div>
    </div>
  )
}
