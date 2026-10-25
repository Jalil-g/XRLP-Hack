import type { Metadata } from 'next'
import { DueNumber, QueueTable } from '@/components/inspector/queue-table'
import { getAuditQueue } from '@/lib/api'

export const metadata: Metadata = { title: 'Queue' }

export default function InspectorPage() {
  const items = getAuditQueue()
  return (
    <div className="container-app py-10">
      <div className="mb-6 flex items-end justify-between">
        <h1 className="t-page">Queue</h1>
        <DueNumber items={items} />
      </div>
      <div className="panel px-6 py-2">
        <QueueTable items={items} />
      </div>
    </div>
  )
}
