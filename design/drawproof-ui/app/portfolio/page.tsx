import type { Metadata } from 'next'
import { PortfolioView } from '@/components/investor/portfolio-view'
import { getInvestorTransactions, getPortfolio, getWallet } from '@/lib/api'

export const metadata: Metadata = { title: 'Portfolio' }

export default function PortfolioPage() {
  const wallet = getWallet('investor')
  const { rows, totals } = getPortfolio(wallet.name)
  const recent = getInvestorTransactions(wallet.name)
    .slice(0, 5)
    .map((r) => ({ hash: r.tx.hash, action: r.action, date: r.date, signed: r.signed }))
  return <PortfolioView rows={rows} totals={totals} wallet={wallet} recent={recent} />
}
