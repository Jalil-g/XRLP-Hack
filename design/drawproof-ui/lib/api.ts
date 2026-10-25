import {
  auditHistory,
  auditQueue,
  auditSpecs,
  checkRuns,
  evidenceRequirements,
  nextPayment,
  type LedgerTx,
  ledger,
  photoMatch,
  photos,
  positions,
  projects,
  siteVisitQueue,
  wallets,
  type LedgerAction,
  type MoneyLocation,
  type Project,
  type Role,
  type Scenario,
} from './mock-data'

export interface MoneySegment {
  id: string
  label: string
  amount: number
  location: MoneyLocation | 'To raise'
  milestoneId?: string
  actions?: LedgerAction[]
}

export function getProjects() {
  return projects
}

export function getProject(slug: string) {
  return projects.find((p) => p.slug === slug)
}

export function getMilestone(slug: string, milestoneId: string) {
  return getProject(slug)?.milestones.find((m) => m.id === milestoneId)
}

export function getWallet(role: Role) {
  return wallets[role]
}

export function getLedger(filter: { projectSlug?: string; investor?: string } = {}) {
  return ledger.filter(
    (tx) =>
      (!filter.projectSlug || tx.projectSlug === filter.projectSlug) &&
      (!filter.investor || !tx.investor || tx.investor === filter.investor),
  )
}

export function getTx(hash: string) {
  return ledger.find((tx) => tx.hash === hash)
}

export function getCheckRun(slug: string, milestoneId: string, scenario: Scenario) {
  return checkRuns.find((r) => r.projectSlug === slug && r.milestoneId === milestoneId && r.scenario === scenario)
}

export function getPhotoMatch() {
  return photoMatch
}

export function getPhotos(files: string[]) {
  return files.map((f) => photos[f]).filter(Boolean)
}

export function getMoneySegments(project: Project): MoneySegment[] {
  if (project.status === 'Funding') {
    return [
      { id: 'vault', label: 'Raised', amount: project.raised, location: 'In vault', actions: ['VaultDeposit'] },
      { id: 'open', label: 'Open', amount: project.principal - project.raised, location: 'To raise' },
    ]
  }
  return project.milestones.map((m) => ({
    id: m.id,
    label: m.name,
    amount: m.amount,
    location: m.location,
    milestoneId: m.id,
  }))
}

export function getHeroFigure(project: Project) {
  if (project.status === 'Funding') return { label: 'Raised', value: project.raised, of: project.principal }
  const inEscrow = project.milestones.filter((m) => m.location === 'In escrow').reduce((s, m) => s + m.amount, 0)
  if (inEscrow > 0) return { label: 'In escrow', value: inEscrow, of: project.principal }
  const released = project.milestones.filter((m) => m.location === 'Released').reduce((s, m) => s + m.amount, 0)
  return { label: 'Released', value: released, of: project.principal }
}

export const TODAY = new Date('2026-10-25T12:00:00')

export function daysUntil(date: string) {
  return Math.round((new Date(`${date} 12:00`).getTime() - TODAY.getTime()) / 86_400_000)
}

export function getLocationSegments(project: Project): MoneySegment[] {
  if (project.status === 'Funding') {
    return [
      { id: 'vault', label: 'In vault', amount: project.raised, location: 'In vault', actions: ['VaultDeposit'] },
      { id: 'open', label: 'To raise', amount: project.principal - project.raised, location: 'To raise' },
    ]
  }
  const { released, inEscrow } = getProjectMoney(project)
  return [
    { id: 'released', label: 'Released', amount: released, location: 'Released', actions: ['EscrowFinish'] },
    { id: 'escrow', label: 'In escrow', amount: inEscrow, location: 'In escrow', actions: ['EscrowCreate'] },
  ]
}

export function getProjectMoney(project: Project) {
  const sum = (loc: MoneyLocation) => project.milestones.filter((m) => m.location === loc).reduce((s, m) => s + m.amount, 0)
  return { released: sum('Released'), inEscrow: sum('In escrow'), inVault: project.status === 'Funding' ? project.raised : 0 }
}

export function getPortfolio(investor = 'Ava Chen') {
  const rows = positions.map((pos) => {
    const project = getProject(pos.projectSlug)!
    const money = getProjectMoney(project)
    return { ...pos, project, ...money, value: pos.invested + pos.interest }
  })
  const totals = rows.reduce(
    (t, r) => ({ invested: t.invested + r.invested, value: t.value + r.value, interest: t.interest + r.interest }),
    { invested: 0, value: 0, interest: 0 },
  )
  const transactions = ledger.filter((tx) => tx.investor === investor || tx.to === wallets.investor.address)
  return { rows, totals, transactions }
}

export type InvestorAction = 'Vault deposit' | 'Interest' | 'Withdrawal'

export function getInvestorTransactions(investor = 'Ava Chen') {
  const address = wallets.investor.address
  return ledger
    .filter((tx) => tx.investor === investor || tx.to === address)
    .map((tx) => {
      const action: InvestorAction = tx.action === 'VaultDeposit' ? 'Vault deposit' : tx.action === 'VaultWithdraw' ? 'Withdrawal' : 'Interest'
      const signed = action === 'Vault deposit' ? -(tx.amount ?? 0) : tx.amount ?? 0
      return { tx, action, signed, date: tx.time.split(' ').slice(0, 3).join(' ') }
    })
    .sort((a, b) => b.tx.ledgerIndex - a.tx.ledgerIndex)
}

export interface PayoutRow {
  tx: LedgerTx
  date: string
  projectSlug: string
  projectName: string
  milestone: string
  signed: number
}

export function toPayoutRow(tx: LedgerTx): PayoutRow {
  const project = getProject(tx.projectSlug)
  const milestone = tx.action === 'LoanPay' ? 'Loan payment' : project?.milestones.find((m) => m.id === tx.milestoneId)?.name ?? tx.label
  return {
    tx,
    date: tx.time.split(' ').slice(0, 3).join(' '),
    projectSlug: tx.projectSlug,
    projectName: project?.name ?? tx.projectSlug,
    milestone,
    signed: tx.action === 'LoanPay' ? -(tx.amount ?? 0) : tx.amount ?? 0,
  }
}

export function getBuilderPayouts() {
  const address = wallets.builder.address
  return ledger
    .filter((tx) => (tx.action === 'EscrowFinish' && tx.to === address) || (tx.action === 'LoanPay' && tx.from === address))
    .sort((a, b) => b.ledgerIndex - a.ledgerIndex)
    .map(toPayoutRow)
}

export function getActiveBuilderProjects() {
  return projects.filter((p) => p.builder === wallets.builder.name && p.status !== 'Completed')
}

export function getReleasedToDate() {
  return getActiveBuilderProjects().reduce((s, p) => s + getProjectMoney(p).released, 0)
}

export function getRequirements(slug: string, milestoneId: string) {
  return evidenceRequirements[slug]?.[milestoneId] ?? []
}

export function getNextMilestone(project: Project) {
  return project.milestones.find((m) => m.status !== 'Released')
}

export function getNextPayment() {
  return nextPayment
}

export function shortFileHash(file: string) {
  let h = 2166136261
  for (const c of file) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return (h >>> 0).toString(16).toUpperCase().padStart(8, '0')
}

export function formatDistance(m: number) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`
}

export function getAuditQueue() {
  return auditQueue
}

export function getSiteVisits() {
  return siteVisitQueue
}

export function getAuditSpec(key: string) {
  return auditSpecs.find((s) => s.key === key)
}

export function getAuditHistory() {
  return auditHistory
}

export function getAuditRecord(id: string) {
  return auditHistory.find((r) => r.id === id)
}

export function shortKey(a: string) {
  return `${a.slice(0, 3)}...${a.slice(-3)}`
}

export function shortDigest(h: string) {
  return `${h.slice(0, 4).toLowerCase()}...${h.slice(-4).toLowerCase()}`
}

export function formatRLUSD(n: number, decimals = 2) {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function formatWhole(n: number) {
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

export function shortAddress(a: string) {
  return `${a.slice(0, 4)}...${a.slice(-4)}`
}

export function shortHash(h: string) {
  return `${h.slice(0, 6)}...${h.slice(-4)}`
}
