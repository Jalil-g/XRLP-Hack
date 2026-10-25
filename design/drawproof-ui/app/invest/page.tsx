import type { Metadata } from 'next'
import { InvestGrid } from '@/components/investor/invest-grid'
import { getProjects } from '@/lib/api'

export const metadata: Metadata = { title: 'Projects' }

export default function InvestPage() {
  return <InvestGrid projects={getProjects()} />
}
