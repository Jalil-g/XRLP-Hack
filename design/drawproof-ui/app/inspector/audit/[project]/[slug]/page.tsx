import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { AuditWorkspace } from '@/components/inspector/audit-workspace'
import { getAuditSpec, getProject, getWallet } from '@/lib/api'
import { photos } from '@/lib/mock-data'

export const metadata: Metadata = { title: 'Audit' }

export default async function AuditPage({ params }: { params: Promise<{ project: string; slug: string }> }) {
  const { project: projectSlug, slug } = await params
  const spec = getAuditSpec(`${projectSlug}/${slug}`)
  const project = getProject(projectSlug)
  if (!spec || !project) notFound()
  return <AuditWorkspace spec={spec} project={project} wallet={getWallet('inspector')} photoIndex={photos} />
}
