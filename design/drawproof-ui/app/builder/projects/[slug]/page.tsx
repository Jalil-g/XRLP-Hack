import { LayoutGrid, ListOrdered, Receipt, ShieldCheck } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MilestoneWorkspace, UploadEvidenceButton } from '@/components/builder/milestone-workspace'
import { RepaySheet } from '@/components/builder/repay-sheet'
import { UploadSheet } from '@/components/builder/upload-sheet'
import { CoverBand, DetailLayout, Section } from '@/components/detail-shell'
import { KeyInformation } from '@/components/project/key-information'
import { ProjectLedger } from '@/components/project/project-ledger'
import { VerificationSection } from '@/components/project/verification-section'
import { Chip, StatusTag } from '@/components/status-tag'
import { LedgerFilterProvider } from '@/components/xrpl/ledger-filter'
import { LocationBar } from '@/components/xrpl/location-bar'
import { formatWhole, getCheckRun, getLedger, getLocationSegments, getPhotoMatch, getProject, getProjectMoney } from '@/lib/api'
import type { LedgerTx } from '@/lib/mock-data'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  return { title: getProject(slug)?.name ?? 'Project' }
}

export default async function BuilderProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const project = getProject(slug)
  if (!project) notFound()

  const txs = getLedger({ projectSlug: project.slug })
  const money = getProjectMoney(project)
  const releases: Record<string, LedgerTx> = {}
  for (const tx of txs) if (tx.action === 'EscrowFinish' && tx.milestoneId) releases[tx.milestoneId] = tx

  const blocks: [string, string][] = [
    ['Principal', `${formatWhole(project.principal)} RLUSD`],
    ['Raised', `${formatWhole(project.raised)} RLUSD`],
    ['Released', `${formatWhole(money.released)} RLUSD`],
    ['Term', `${project.termDays} days`],
  ]

  return (
    <>
      <CoverBand
        project={project}
        tall
        badges={
          <>
            {project.sample && <Chip>Sample</Chip>}
            <span className="inline-flex h-6 items-center rounded-sm bg-white px-2 text-[13px] font-medium text-ink">Verified</span>
          </>
        }
      />
      <LedgerFilterProvider>
        <DetailLayout
          wide
          primary={<UploadEvidenceButton project={project} />}
          secondary={<RepaySheet variant="secondary" className="w-full" />}
          sections={[
            { id: 'milestones', label: 'Milestones', icon: ListOrdered },
            { id: 'overview', label: 'Overview', icon: LayoutGrid },
            { id: 'verification', label: 'Verification', icon: ShieldCheck },
            { id: 'ledger', label: 'Ledger', icon: Receipt },
          ]}
        >
          <Section id="milestones" title="Milestones" first aside={<StatusTag status={project.status} />}>
            <MilestoneWorkspace
              project={project}
              runs={{ reused: getCheckRun(project.slug, 'framing', 'reused'), honest: getCheckRun(project.slug, 'framing', 'honest') }}
              releases={releases}
              match={getPhotoMatch()}
            />
          </Section>

          <Section id="overview" title="Where the money is">
            <LocationBar segments={getLocationSegments(project)} total={project.principal} />
            <dl className="mt-6 grid grid-cols-2 gap-x-8 gap-y-5">
              {blocks.map(([label, value]) => (
                <div key={label} className="border-t border-hairline pt-3">
                  <dt className="t-label">{label}</dt>
                  <dd className="tnum text-[28px] leading-9">{value}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <Section id="key-information" title="Key information">
            <KeyInformation project={project} />
          </Section>

          <Section id="verification" title="Verification">
            <VerificationSection />
          </Section>

          <Section id="ledger" title="Ledger">
            <ProjectLedger txs={txs} />
          </Section>
        </DetailLayout>
      </LedgerFilterProvider>
      <UploadSheet project={project} />
    </>
  )
}
