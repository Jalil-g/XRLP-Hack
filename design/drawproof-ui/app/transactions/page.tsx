import type { Metadata } from 'next'
import { TransactionsView } from '@/components/investor/transactions-view'
import { getInvestorTransactions, getProject, getWallet } from '@/lib/api'

export const metadata: Metadata = { title: 'Transactions' }

export default function TransactionsPage() {
  const wallet = getWallet('investor')
  const rows = getInvestorTransactions(wallet.name).map((r) => ({
    hash: r.tx.hash,
    date: r.date,
    action: r.action,
    signed: r.signed,
    projectSlug: r.tx.projectSlug ?? '',
    projectName: (r.tx.projectSlug && getProject(r.tx.projectSlug)?.name) || '—',
  }))
  return <TransactionsView rows={rows} />
}
