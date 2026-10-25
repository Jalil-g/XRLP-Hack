'use client'

import Link from 'next/link'
import { useMemo } from 'react'
import { CoverBand, DetailLayout, Section } from '@/components/detail-shell'
import { EvidencePhoto } from '@/components/evidence-photo'
import { PropertyRows } from '@/components/property-rows'
import { StatusTag } from '@/components/status-tag'
import { TitleBlock } from '@/components/title-block'
import { buttonVariants } from '@/components/ui/button'
import { LedgerLink } from '@/components/xrpl/ledger-drawer'
import { getProject } from '@/lib/api'
import { useInspector } from '@/lib/inspector-store'
import type { AuditRecord, EvidencePhoto as Photo } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

function useRecords(base: AuditRecord[]) {
  const filed = useInspector((s) => s.filed)
  return useMemo(() => [...filed, ...base.filter((b) => !filed.some((f) => f.id === b.id))], [filed, base])
}

const doneOf = (r: AuditRecord) => `${r.lines.filter((l) => l.state === 'Done').length}/${r.lines.length}`

export function HistoryTable({ base }: { base: AuditRecord[] }) {
  const records = useRecords(base)
  if (records.length === 0) return <p className="py-10 text-center t-label">No audits filed yet. The clipboard is lonely.</p>
  return (
    <table className="tnum w-full text-left text-[15px]">
      <thead>
        <tr className="border-b-2 border-ink">
          <th className="py-2 pr-4 font-semibold">Filed</th>
          <th className="py-2 pr-4 font-semibold">Project</th>
          <th className="py-2 pr-4 font-semibold">Milestone</th>
          <th className="py-2 pr-4 font-semibold">Checklist</th>
          <th className="py-2 pr-4 font-semibold">Outcome</th>
          <th className="py-2 text-right font-semibold">Attestation</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-hairline">
        {records.map((r) => (
          <tr key={r.id} className="h-14">
            <td className="py-2 pr-4">{r.filed}</td>
            <td className="py-2 pr-4">
              <Link href={`/inspector/history/${r.id}`} className="underline underline-offset-4 hover:no-underline">
                {getProject(r.projectSlug)?.name ?? r.projectSlug}
              </Link>
            </td>
            <td className="py-2 pr-4">{r.subject}</td>
            <td className="py-2 pr-4">{doneOf(r)}</td>
            <td className="py-2 pr-4">
              <StatusTag status={r.outcome} />
            </td>
            <td className="py-2 text-right">
              <LedgerLink tx={r.tx} short />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function RecordView({ id, base, photoIndex }: { id: string; base: AuditRecord[]; photoIndex: Record<string, Photo> }) {
  const records = useRecords(base)
  const record = records.find((r) => r.id === id)
  if (!record)
    return (
      <div className="container-app py-16 text-center">
        <h1 className="t-page">Audit not found</h1>
        <p className="mt-3 t-label">It may have been filed in another browser session.</p>
        <Link href="/inspector/history" className={cn(buttonVariants({ variant: 'secondary' }), 'mt-6')}>
          Back to history
        </Link>
      </div>
    )
  const project = getProject(record.projectSlug)
  const photos = record.sitePhotos.map((f) => photoIndex[f]).filter(Boolean) as Photo[]
  return (
    <>
      {project && <CoverBand project={project} kicker={`${record.subject} · Audit filed ${record.filed}`} height="h-[200px]" />}
      <DetailLayout
        primary={
          <Link href="/inspector/history" className={cn(buttonVariants(), 'w-full')}>
            Back to history
          </Link>
        }
        sections={[]}
        nav={<p className="px-2 text-[14px] text-label">Read-only. This audit is signed and cannot be edited.</p>}
        wide
      >
        <Section id="summary" title="Audit" first aside={<StatusTag status={record.outcome} />}>
          <PropertyRows
            rows={[
              { label: 'Filed', value: record.filed },
              { label: 'Milestone', value: record.subject },
              { label: 'Evidence version', value: record.evidenceVersion ? `v${record.evidenceVersion}` : 'None' },
              { label: 'Checklist', value: doneOf(record) },
              { label: 'Attestation', value: <LedgerLink tx={record.tx} /> },
            ]}
          />
        </Section>
        <Section id="checklist" title="Checklist">
          <ul className="divide-y divide-hairline border-t border-hairline">
            {record.lines.map((l) => (
              <li key={l.trade} className="flex min-h-12 flex-wrap items-center justify-between gap-3 py-2">
                <span className="text-[16px]">
                  {l.trade}
                  {l.note && <span className="ml-2 text-[14px] text-label">{l.note}</span>}
                </span>
                <StatusTag status={l.state} />
              </li>
            ))}
          </ul>
        </Section>
        {photos.length > 0 && (
          <Section id="photos" title="Site photos">
            <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
              {photos.map((p) => (
                <EvidencePhoto key={p.file} photo={p} />
              ))}
            </div>
          </Section>
        )}
        <TitleBlock project={project?.name ?? record.projectSlug} sheet="Audit" revision="D" />
      </DetailLayout>
    </>
  )
}
