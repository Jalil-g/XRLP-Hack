import type { Metadata } from 'next'
import { HistoryTable } from '@/components/inspector/history-views'
import { getAuditHistory } from '@/lib/api'

export const metadata: Metadata = { title: 'History' }

export default function HistoryPage() {
  return (
    <div className="container-app py-10">
      <h1 className="t-page mb-6">History</h1>
      <div className="panel px-6 py-2">
        <HistoryTable base={getAuditHistory()} />
      </div>
    </div>
  )
}
