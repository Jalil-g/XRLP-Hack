import { LayoutGrid, ListOrdered, Receipt, ShieldCheck } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { CoverBand, DetailLayout, Section } from '@/components/detail-shell'
import { InvestSheet } from '@/components/project/invest-sheet'
import { KeyInformation } from '@/components/project/key-information'
import { MilestoneTable } from '@/components/project/milestone-table'
import { ProjectLedger } from '@/components/project/project-ledger'
import { VerificationSection } from '@/components/project/verification-section'
import { Chip, StatusTag } from '@/components/status-tag'
import { Button, buttonVariants } from '@/components/ui/button'
import { LedgerFilterProvider } from '@/components/xrpl/ledger-filter'
import { LocationBar } from '@/components/xrpl/location-bar'
import { formatWhole, getCheckRun, getLedger, getLocationSegments, getPhotoMatch, getProject, getProjectMoney, getWallet } from '@/lib/api'
import type { CheckRun } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  return { title: getProject(slug)?.name ?? 'Project' }
}

export default async function ProjectPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const project = getProject(slug)
  if (!project) notFound()

  const funding = project.status === 'Funding'
  const txs = getLedger({ projectSlug: project.slug })
  const money = getProjectMoney(project)

  const runs: Record<string, CheckRun> = {}
  for (const m of project.milestones) {
    const run = getCheckRun(project.slug, m.id, 'reused')
    if (run) runs[m.id] = run
  }
  const releasedOn: Record<string, string> = {}
  for (const tx of txs) if (tx.action === 'EscrowFinish' && tx.milestoneId) releasedOn[tx.milestoneId] = tx.time.split(' ').slice(0, 3).join(' ')
  const failing = project.milestones.find((m) => runs[m.id]?.verdict.state === 'fail')

  const blocks: [string, string][] = [
    ['Principal', `${formatWhole(project.principal)} RLUSD`],
    ['Rate', `${project.ratePct.toFixed(2)}%`],
    ['Term', `${project.termDays} days`],
    funding ? ['Raised', `${formatWhole(project.raised)} RLUSD`] : ['Released', `${formatWhole(money.released)} RLUSD`],
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
          primary={
            funding ? (
              <InvestSheet project={project} wallet={getWallet('investor')} />
            ) : (
              <div className="flex flex-col gap-1.5">
                <Button className="w-full" disabled aria-describedby="invest-reason">
                  Invest
                </Button>
                <p id="invest-reason" className="text-center text-[13px] text-label">
                  Funding closed
                </p>
              </div>
            )
          }
          secondary={
            <a href="#verification" className={cn(buttonVariants({ variant: 'secondary' }), 'w-full')}>
              Verification report
            </a>
          }
          sections={[
            { id: 'overview', label: 'Overview', icon: LayoutGrid },
            { id: 'milestones', label: 'Milestones', icon: ListOrdered },
            { id: 'verification', label: 'Verification', icon: ShieldCheck },
            { id: 'ledger', label: 'Ledger', icon: Receipt },
          ]}
          quiet={
            <a href="#key-information" className="px-2 text-[14px] underline underline-offset-4 hover:no-underline">
              Project account
            </a>
          }
        >
          <Section id="overview" title="Where the money is" first aside={<StatusTag status={project.status} />}>
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

          <Section id="milestones" title="Milestones">
            <MilestoneTable milestones={project.milestones} runs={runs} releasedOn={releasedOn} match={getPhotoMatch()} defaultOpen={failing?.id} />
          </Section>

          <Section id="verification" title="Verification">
            <VerificationSection />
          </Section>

          <Section id="ledger" title="Ledger">
            <ProjectLedger txs={txs} />
          </Section>
        </DetailLayout>
      </LedgerFilterProvider>
    </>
  )
}
