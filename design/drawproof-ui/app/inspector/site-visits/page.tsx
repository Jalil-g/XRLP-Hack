import type { Metadata } from 'next'
import { DueNumber, QueueTable } from '@/components/inspector/queue-table'
import { getSiteVisits } from '@/lib/api'

export const metadata: Metadata = { title: 'Site visits' }

export default function SiteVisitsPage() {
  const items = getSiteVisits()
  return (
    <div className="container-app py-10">
      <div className="mb-6 flex items-end justify-between">
        <h1 className="t-page">Site visits</h1>
        <DueNumber items={items} />
      </div>
      <div className="panel px-6 py-2">
        <QueueTable items={items} action="Start visit" empty="No visits scheduled. Enjoy the quiet." />
      </div>
    </div>
  )
}
