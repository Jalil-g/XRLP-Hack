'use client'

import { useState } from 'react'
import { PlainSelect } from '@/components/plain-select'
import { LedgerLink } from '@/components/xrpl/ledger-drawer'
import { TODAY } from '@/lib/api'
import { emptyLines } from '@/lib/mock-data'
import { signedRLUSD } from './recent-activity'

interface Row {
  hash: string
  date: string
  action: string
  signed: number
  projectSlug: string
  projectName: string
}

const RANGES = [
  { value: 'all', label: 'All time' },
  { value: '30', label: 'Last 30 days' },
  { value: '90', label: 'Last 90 days' },
]

export function TransactionsView({ rows }: { rows: Row[] }) {
  const [range, setRange] = useState('all')
  const [project, setProject] = useState('all')
  const [action, setAction] = useState('all')

  const projects = [...new Map(rows.filter((r) => r.projectSlug).map((r) => [r.projectSlug, r.projectName])).entries()]
  const actions = [...new Set(rows.map((r) => r.action))]

  const shown = rows.filter((r) => {
    if (project !== 'all' && r.projectSlug !== project) return false
    if (action !== 'all' && r.action !== action) return false
    if (range !== 'all') {
      const age = (TODAY.getTime() - new Date(r.date).getTime()) / 86_400_000
      if (age > Number(range)) return false
    }
    return true
  })

  return (
    <div className="container-app py-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <h1 className="t-page">Transactions</h1>
        <div className="flex flex-wrap gap-3">
          <PlainSelect label="Date range" value={range} onChange={setRange} className="w-40" options={RANGES} />
          <PlainSelect
            label="Project"
            value={project}
            onChange={setProject}
            className="w-52"
            options={[{ value: 'all', label: 'All projects' }, ...projects.map(([value, label]) => ({ value, label }))]}
          />
          <PlainSelect
            label="Action"
            value={action}
            onChange={setAction}
            className="w-40"
            options={[{ value: 'all', label: 'All actions' }, ...actions.map((a) => ({ value: a, label: a }))]}
          />
        </div>
      </div>

      {shown.length === 0 ? (
        <p className="panel p-6 t-label">{rows.length ? 'No transactions match these filters.' : emptyLines.transactions}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="tnum w-full text-left text-[15px]">
            <thead>
              <tr className="border-b-2 border-ink">
                <th className="py-2 pr-4 font-semibold">Date</th>
                <th className="py-2 pr-4 font-semibold">Action</th>
                <th className="py-2 pr-4 font-semibold">Project</th>
                <th className="py-2 pr-4 text-right font-semibold">Amount (RLUSD)</th>
                <th className="py-2 text-right font-semibold">Tx</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {shown.map((r) => (
                <tr key={r.hash} className="h-12">
                  <td className="py-2 pr-4 whitespace-nowrap text-label">{r.date}</td>
                  <td className="py-2 pr-4">{r.action}</td>
                  <td className="py-2 pr-4">{r.projectName}</td>
                  <td className={`py-2 pr-4 text-right whitespace-nowrap ${r.signed > 0 ? 'text-ok' : ''}`}>{signedRLUSD(r.signed)}</td>
                  <td className="py-2 text-right whitespace-nowrap">
                    <LedgerLink hash={r.hash} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
