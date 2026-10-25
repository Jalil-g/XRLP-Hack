import type { Metadata } from 'next'
import { RecordView } from '@/components/inspector/history-views'
import { getAuditHistory } from '@/lib/api'
import { photos } from '@/lib/mock-data'

export const metadata: Metadata = { title: 'Audit' }

export default async function RecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <RecordView id={id} base={getAuditHistory()} photoIndex={photos} />
}
