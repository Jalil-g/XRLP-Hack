import type { Metadata } from 'next'
import { PayoutsView } from '@/components/builder/payouts-view'
import { RepaySheet } from '@/components/builder/repay-sheet'

export const metadata: Metadata = { title: 'Payouts' }

export default function PayoutsPage() {
  return (
    <div className="container-app py-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <h1 className="t-page">Payouts</h1>
        <RepaySheet variant="secondary" />
      </div>
      <PayoutsView />
    </div>
  )
}
