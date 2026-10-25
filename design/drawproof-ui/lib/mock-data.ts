// All people, registries and licence numbers are MOCK. RLUSD is a devnet test token.

export type Role = 'investor' | 'builder' | 'inspector'

export type ProjectStatus =
  | 'Verifying'
  | 'Verified'
  | 'Funding'
  | 'Building'
  | 'Repaying'
  | 'Stalled'
  | 'Completed'

export type MilestoneStatus =
  | 'Waiting for evidence'
  | 'Evidence in'
  | 'Audited'
  | 'Checks passed'
  | 'Released'
  | 'Failed'
  | 'Needs review'
  | 'Expired'
  | 'Returned'

export type StatusWord = ProjectStatus | MilestoneStatus

export type MoneyLocation = 'In vault' | 'Lent' | 'In escrow' | 'Released' | 'Returned'

export type LedgerAction =
  | 'Payment'
  | 'VaultDeposit'
  | 'LoanSet'
  | 'EscrowCreate'
  | 'EscrowFinish'
  | 'EscrowCancel'
  | 'LoanPay'
  | 'VaultWithdraw'
  | 'Audit attestation'
  | 'Verdict attestation'

export type Scenario = 'honest' | 'reused'

export interface Wallet {
  role: Role
  name: string
  initials: string
  roleLabel: string
  address: string
  credential: 'KYC investor' | 'Verified builder' | 'Verified inspector'
  credentialTx: string
  credentialDetail?: string
  rlusd: number
  xrp: number
}

export interface EvidencePhoto {
  file: string
  src: string
  captured: string
  distanceM: number
  sample: true
  flipped?: boolean
}

export interface Milestone {
  id: string
  number: number
  name: string
  amount: number
  status: MilestoneStatus
  location: MoneyLocation
  due: string
  escrowSequence?: number
  evidence: string[]
}

export interface Project {
  slug: string
  name: string
  street: string
  town: string
  category: 'New build' | 'Renovation' | 'ADU'
  builder: string
  status: ProjectStatus
  principal: number
  raised: number
  ratePct: number
  termDays: number
  minInvestment: number
  cover: { tone: 'slate' | 'clay'; photo?: string }
  sample?: boolean
  closes: string
  inspector: string
  payments: string
  shareToken: string
  projectAccount: string
  vaultId: string
  loanId?: string
  signers: { role: 'Platform' | 'Builder' | 'Inspector' | 'Trustee'; address: string }[]
  milestones: Milestone[]
}

export interface LedgerTx {
  hash: string
  action: LedgerAction
  label: string
  from: string
  fromName: string
  to: string
  toName: string
  amount: number | null
  currency: 'RLUSD' | 'XRP'
  time: string
  ledgerIndex: number
  projectSlug: string
  milestoneId?: string
  investor?: string
  mock: boolean
}

export type CheckState = 'pass' | 'fail' | 'pending'

export interface Check {
  id: string
  name: string
  ai: boolean
  state: CheckState
  reason: string
  txHash?: string
  compare?: boolean
}

export interface CheckRun {
  projectSlug: string
  milestoneId: string
  scenario: Scenario
  checks: Check[]
  verdict: { state: CheckState; confidence: number; txHash?: string; reason: string }
}

export interface PhotoMatch {
  submitted: { file: string; project: string; src: string; captured: string }
  archive: { file: string; project: string; src: string; captured: string }
  distance: number
  bits: number
  threshold: number
}

export interface Position {
  projectSlug: string
  invested: number
  shares: number
  interest: number
  withdrawable: number
  depositTx: string
}

export type LineState = 'Done' | 'Partial' | 'Not started'

export interface AuditLine {
  id: string
  trade: string
  amount?: number
}

export interface Invoice {
  number: string
  vendor: string
  description: string
  amount: number
}

export interface EvidenceSet {
  version: number
  hash: string
  photos: string[]
  invoices: Invoice[]
}

export interface AuditSpec {
  kind: 'milestone' | 'visit'
  key: string
  projectSlug: string
  subject: string
  kicker: string
  evidence?: EvidenceSet
  evidenceNext?: EvidenceSet
  site?: [string, string][]
  lines: AuditLine[]
  photoCandidates: string[]
}

export interface QueueItem {
  key: string
  projectSlug: string
  subject: string
  site: string
  evidence: string
  due: string
  status: string
  href?: string
}

export interface AuditRecord {
  id: string
  key: string
  projectSlug: string
  subject: string
  filed: string
  lines: { trade: string; state: LineState; note?: string }[]
  sitePhotos: string[]
  evidenceVersion: number | null
  outcome: 'Released' | 'Failed' | 'Waiting'
  tx: LedgerTx
}

export const network = {
  name: 'XRPL Devnet',
  explorer: 'https://devnet.xrpl.org/transactions/',
  fee: '0.000012 XRP',
  verificationFee: 250,
}

export const addresses = {
  platform: 'rRQsHU57dfc9RsFQsXkefT89WHY3zMbR1',
  builder: 'rGtMxWPiuzaEZAB2AJvM7px9ekQhZTdKS',
  inspector: 'rLcziAFhZpkoTJf4Sz9ohrVqXnYwSjCKZ',
  trustee: 'rJxvM52wxnyCib3UX5qDCDTN1VAdYap9a',
  ava: 'rHb9xVqT2mPLc7d5NwYfRk8sEaJu43kQe',
  marcus: 'rUcyZJCu3Thbcntw1xZs3d5dyS5oSpe3U',
  priya: 'rcDrnFFJPfA7QKMR2nkzhDUWHzGMweAQP',
  kestrel: 'rB3mRTSFvwooSW8uXeajtVKieYp8eE6Kj',
  mapleAccount: 'rxM6R8UodZExoJrJZ1MbeJzrRrnFn2AHq',
  mapleVault: 'rx3kHobeny3kzskLZnPdZP8am5TRENLeX',
  oakAccount: 'rkrNhDhpKm3MQWadxu17JSpAvxqw6V5N6',
  oakVault: 'rN4wPq8aTzKe2vXcY7sLmB9dHf3jUo6Rg',
  willowAccount: 'rPz7KcVn3eWq9XtLm2aGbY8sHd4fJu5Tr',
  willowVault: 'rEw2LmQx8bN5cVz7KtYp3sHj9dFg4aUo6',
}

export const wallets: Record<Role, Wallet> = {
  investor: {
    role: 'investor',
    name: 'Ava Chen',
    initials: 'AC',
    roleLabel: 'Investor',
    address: addresses.ava,
    credential: 'KYC investor',
    credentialTx: '817E0D66746A471AC4E8B218087CAC773E765B948EC78FE64DA08D680C531354',
    rlusd: 25_000,
    xrp: 96.4,
  },
  builder: {
    role: 'builder',
    name: 'Hudson Valley Builders',
    initials: 'HV',
    roleLabel: 'Builder',
    address: addresses.builder,
    credential: 'Verified builder',
    credentialTx: '588447986F147EE565339B48FFBF33E208EA05E2A7935D9D427F7DAFFA966716',
    rlusd: 36_118.4,
    xrp: 54.2,
  },
  inspector: {
    role: 'inspector',
    name: 'Dana Ruiz',
    initials: 'DR',
    roleLabel: 'Hudson Code Inspections',
    address: addresses.inspector,
    credential: 'Verified inspector',
    credentialDetail: 'NYS-CEO-3341',
    credentialTx: 'C7FD855544FF2C4EBE1756FA7FE4A7A0BD330ECB115925B58C69D1F8FF2C47B9',
    rlusd: 1_840,
    xrp: 31.75,
  },
}

export const investors = [
  { name: 'Ava Chen', address: addresses.ava },
  { name: 'Marcus Johnson', address: addresses.marcus },
  { name: 'Priya Patel', address: addresses.priya },
  { name: 'Kestrel Family Trust', address: addresses.kestrel },
]

export const navByRole: Record<Role, { label: string; href: string }[]> = {
  investor: [
    { label: 'Home', href: '/' },
    { label: 'Invest', href: '/invest' },
    { label: 'Portfolio', href: '/portfolio' },
    { label: 'Transactions', href: '/transactions' },
  ],
  builder: [
    { label: 'Home', href: '/builder' },
    { label: 'Projects', href: '/builder/projects' },
    { label: 'Payouts', href: '/builder/payouts' },
  ],
  inspector: [
    { label: 'Queue', href: '/inspector' },
    { label: 'Site visits', href: '/inspector/site-visits' },
    { label: 'History', href: '/inspector/history' },
  ],
}

export const roleHome: Record<Role, string> = {
  investor: '/',
  builder: '/builder',
  inspector: '/inspector',
}

export const photos: Record<string, EvidencePhoto> = {
  'IMG_2214.jpg': { file: 'IMG_2214.jpg', src: '/photos/foundation.png', captured: 'Sep 29, 2026 09:12', distanceM: 14, sample: true },
  'IMG_2228.jpg': { file: 'IMG_2228.jpg', src: '/photos/framing-wall.png', captured: 'Oct 19, 2026 10:14', distanceM: 18, sample: true },
  'IMG_2230.jpg': { file: 'IMG_2230.jpg', src: '/photos/framing-sheathing.png', captured: 'Oct 20, 2026 14:02', distanceM: 9, sample: true },
  'IMG_2231.jpg': { file: 'IMG_2231.jpg', src: '/photos/framing-joists.png', captured: 'Oct 21, 2026 10:33', distanceM: 31, sample: true },
  'IMG_2232.jpg': { file: 'IMG_2232.jpg', src: '/photos/framing-bracing.png', captured: 'Oct 24, 2026 11:47', distanceM: 12, sample: true },
  'IMG_0417.jpg': { file: 'IMG_0417.jpg', src: '/photos/framing-joists.png', captured: 'Mar 14, 2026 15:20', distanceM: 22, sample: true, flipped: true },
  'IMG_0388.jpg': { file: 'IMG_0388.jpg', src: '/photos/renovation.png', captured: 'Feb 27, 2026 12:05', distanceM: 16, sample: true },
  'IMG_2235.jpg': { file: 'IMG_2235.jpg', src: '/photos/framing-wall.png', captured: 'Oct 25, 2026 09:18', distanceM: 42, sample: true, flipped: true },
  'IMG_2236.jpg': { file: 'IMG_2236.jpg', src: '/photos/framing-sheathing.png', captured: 'Oct 25, 2026 09:26', distanceM: 3100, sample: true, flipped: true },
  'DR_3301.jpg': { file: 'DR_3301.jpg', src: '/photos/framing-wall.png', captured: 'Oct 25, 2026 14:06', distanceM: 8, sample: true },
  'DR_3302.jpg': { file: 'DR_3302.jpg', src: '/photos/framing-joists.png', captured: 'Oct 25, 2026 14:11', distanceM: 12, sample: true },
  'DR_3303.jpg': { file: 'DR_3303.jpg', src: '/photos/framing-bracing.png', captured: 'Oct 25, 2026 14:18', distanceM: 5, sample: true },
  'DR_3304.jpg': { file: 'DR_3304.jpg', src: '/photos/framing-sheathing.png', captured: 'Oct 25, 2026 14:24', distanceM: 19, sample: true },
  'DR_3401.jpg': { file: 'DR_3401.jpg', src: '/photos/foundation.png', captured: 'Oct 28, 2026 09:40', distanceM: 6, sample: true },
  'DR_3402.jpg': { file: 'DR_3402.jpg', src: '/photos/foundation.png', captured: 'Oct 28, 2026 09:47', distanceM: 14, sample: true, flipped: true },
  'DR_3403.jpg': { file: 'DR_3403.jpg', src: '/photos/renovation.png', captured: 'Oct 28, 2026 09:55', distanceM: 21, sample: true },
  'DR_2901.jpg': { file: 'DR_2901.jpg', src: '/photos/foundation.png', captured: 'Oct 2, 2026 14:40', distanceM: 7, sample: true },
  'DR_2902.jpg': { file: 'DR_2902.jpg', src: '/photos/foundation.png', captured: 'Oct 2, 2026 14:52', distanceM: 11, sample: true, flipped: true },
  'DR_3201.jpg': { file: 'DR_3201.jpg', src: '/photos/framing-wall.png', captured: 'Oct 23, 2026 14:21', distanceM: 9, sample: true, flipped: true },
  'DR_3202.jpg': { file: 'DR_3202.jpg', src: '/photos/framing-bracing.png', captured: 'Oct 23, 2026 14:30', distanceM: 6, sample: true, flipped: true },
  'DR_1101.jpg': { file: 'DR_1101.jpg', src: '/photos/renovation.png', captured: 'Apr 9, 2026 11:02', distanceM: 4, sample: true },
}

export const SITE_RADIUS_M = 150

export const uploadCandidates = ['IMG_2228.jpg', 'IMG_2230.jpg', 'IMG_2232.jpg', 'IMG_2235.jpg', 'IMG_2236.jpg']

export interface EvidenceRequirement {
  id: string
  label: string
  unit: 'photo' | 'invoice' | 'audit'
  need: number
  have: number
}

export const evidenceRequirements: Record<string, Record<string, EvidenceRequirement[]>> = {
  'maple-st-duplex': {
    foundation: [
      { id: 'footings', label: 'Footings and walls, all sides', unit: 'photo', need: 1, have: 1 },
      { id: 'concrete-invoice', label: 'Concrete invoice', unit: 'invoice', need: 1, have: 1 },
      { id: 'audit', label: 'Inspector audit', unit: 'audit', need: 1, have: 1 },
    ],
    framing: [
      { id: 'walls', label: 'Wall framing, all sides', unit: 'photo', need: 4, have: 3 },
      { id: 'lumber-invoice', label: 'Lumber invoice', unit: 'invoice', need: 1, have: 1 },
      { id: 'audit', label: 'Inspector audit', unit: 'audit', need: 1, have: 1 },
    ],
    roof: [
      { id: 'roof-deck', label: 'Roof deck and underlayment', unit: 'photo', need: 4, have: 0 },
      { id: 'windows', label: 'Windows and doors installed', unit: 'photo', need: 2, have: 0 },
      { id: 'roof-invoice', label: 'Roofing invoice', unit: 'invoice', need: 1, have: 0 },
      { id: 'audit', label: 'Inspector audit', unit: 'audit', need: 1, have: 0 },
    ],
  },
}

export interface SovLine {
  id: string
  trade: string
  amount: number
  evidence: string
}

export const sovTemplates: Record<string, { name: string; lines: SovLine[] }> = {
  'New build': {
    name: 'Residential new build',
    lines: [
      { id: 'l1', trade: 'Foundation', amount: 24_000, evidence: 'Footings and walls, all sides: 4 photos; concrete invoice' },
      { id: 'l2', trade: 'Framing', amount: 30_000, evidence: 'Wall framing, all sides: 4 photos; lumber invoice' },
      { id: 'l3', trade: 'Roof and Dry-in', amount: 18_000, evidence: 'Roof deck and windows: 6 photos; roofing invoice' },
      { id: 'l4', trade: 'Mechanical rough-in', amount: 24_000, evidence: 'Plumbing, electrical, HVAC: 6 photos; rough-in permit sign-off' },
      { id: 'l5', trade: 'Finishes', amount: 24_000, evidence: 'Each room: 1 photo; certificate of occupancy' },
    ],
  },
}

export const builderDocuments = [
  { id: 'license', label: 'Contractor license', sample: 'HIC-38812-license.pdf' },
  { id: 'insurance', label: 'Insurance certificate', sample: 'COI-general-liability-2026.pdf' },
  { id: 'llc', label: 'LLC good standing', sample: 'NY-DOS-good-standing.pdf' },
  { id: 'permit', label: 'Building permit', sample: 'Beacon-BP-2026-0418.pdf' },
] as const

export const nextPayment = { projectSlug: 'maple-st-duplex', amount: 1_000, due: 'Nov 18, 2026', basis: 'Interest, illustrative' }

const mapleSigners: Project['signers'] = [
  { role: 'Platform', address: addresses.platform },
  { role: 'Builder', address: addresses.builder },
  { role: 'Inspector', address: addresses.inspector },
  { role: 'Trustee', address: addresses.trustee },
]

export const projects: Project[] = [
  {
    slug: 'maple-st-duplex',
    name: 'Maple St Duplex',
    street: '48 Maple St',
    town: 'Beacon, NY',
    category: 'New build',
    builder: 'Hudson Valley Builders',
    status: 'Building',
    principal: 120_000,
    raised: 120_000,
    ratePct: 10,
    termDays: 180,
    minInvestment: 100,
    cover: { tone: 'slate', photo: '/photos/framing-wall.png' },
    closes: 'Sep 15, 2026',
    inspector: 'Dana Ruiz',
    payments: 'Interest and principal at maturity',
    shareToken: '0000A1F3C2E9B47D58A60E3B9C14F27D86E05B3A91C7F4D2',
    projectAccount: addresses.mapleAccount,
    vaultId: addresses.mapleVault,
    loanId: '9F3C21A0E4B7D6185C2A44F0B91E7D3A6C85F2E1B0D94A7C3E6F18B25D07A9C4',
    signers: mapleSigners,
    milestones: [
      { id: 'foundation', number: 1, name: 'Foundation', amount: 36_000, status: 'Released', location: 'Released', due: 'Oct 3, 2026', escrowSequence: 4182211, evidence: ['IMG_2214.jpg'] },
      { id: 'framing', number: 2, name: 'Framing', amount: 48_000, status: 'Failed', location: 'In escrow', due: 'Nov 7, 2026', escrowSequence: 4182212, evidence: ['IMG_2228.jpg', 'IMG_2230.jpg', 'IMG_2231.jpg'] },
      { id: 'roof', number: 3, name: 'Roof and Dry-in', amount: 36_000, status: 'Waiting for evidence', location: 'In escrow', due: 'Dec 12, 2026', escrowSequence: 4182213, evidence: [] },
    ],
  },
  {
    slug: 'oak-ave-renovation',
    name: 'Oak Ave Renovation',
    street: '112 Oak Ave',
    town: 'Kingston, NY',
    category: 'Renovation',
    builder: 'Hudson Valley Builders',
    status: 'Completed',
    principal: 40_000,
    raised: 40_000,
    ratePct: 11,
    termDays: 90,
    minInvestment: 100,
    cover: { tone: 'clay', photo: '/photos/renovation.png' },
    closes: 'Feb 6, 2026',
    inspector: 'Dana Ruiz',
    payments: 'Interest and principal at maturity',
    shareToken: '0000B7E21D4C93F06A8B5E2D17C46F90A3E8B15C72D4F6A0',
    projectAccount: addresses.oakAccount,
    vaultId: addresses.oakVault,
    loanId: '4D8E0A7C19B3F2654E0D7A1C93B8F6E2D5A0C47B1E9F38D6A2C05B74E91F3A8D',
    signers: mapleSigners,
    milestones: [
      { id: 'demolition', number: 1, name: 'Demolition', amount: 12_000, status: 'Released', location: 'Released', due: 'Feb 20, 2026', evidence: ['IMG_0388.jpg'] },
      { id: 'rough-in', number: 2, name: 'Rough-in', amount: 16_000, status: 'Released', location: 'Released', due: 'Mar 16, 2026', evidence: ['IMG_0417.jpg'] },
      { id: 'finishes', number: 3, name: 'Finishes', amount: 12_000, status: 'Released', location: 'Released', due: 'Apr 10, 2026', evidence: [] },
    ],
  },
  {
    slug: 'willow-rd-adu',
    name: 'Willow Rd ADU',
    street: '7 Willow Rd',
    town: 'Rhinebeck, NY',
    category: 'ADU',
    builder: 'Hudson Valley Builders',
    status: 'Funding',
    principal: 60_000,
    raised: 41_500,
    ratePct: 9.5,
    termDays: 120,
    minInvestment: 100,
    cover: { tone: 'slate', photo: '/photos/foundation.png' },
    sample: true,
    closes: 'Nov 8, 2026',
    inspector: 'Dana Ruiz',
    payments: 'Interest and principal at maturity',
    shareToken: '0000C4A9E7B2D51F83C06E4A29B7D15F8E3C60A4B9D27E1F',
    projectAccount: addresses.willowAccount,
    vaultId: addresses.willowVault,
    signers: mapleSigners,
    milestones: [
      { id: 'foundation', number: 1, name: 'Foundation', amount: 18_000, status: 'Waiting for evidence', location: 'In vault', due: 'Jan 15, 2027', evidence: [] },
      { id: 'framing', number: 2, name: 'Framing', amount: 24_000, status: 'Waiting for evidence', location: 'In vault', due: 'Feb 19, 2027', evidence: [] },
      { id: 'finishes', number: 3, name: 'Finishes', amount: 18_000, status: 'Waiting for evidence', location: 'In vault', due: 'Mar 26, 2027', evidence: [] },
    ],
  },
]

const P = 'Platform'
const MA = 'Maple St Duplex account'
const MV = 'Maple St Duplex vault'
const HV = 'Hudson Valley Builders'

export const ledger: LedgerTx[] = [
  { hash: 'D6340424D20224853873360874CDC87681EF41F3CE9B4B1EA586273C3CC237B6', action: 'Payment', label: 'Verification fee', from: addresses.builder, fromName: HV, to: addresses.platform, toName: P, amount: 250, currency: 'RLUSD', time: 'Sep 2, 2026 09:41', ledgerIndex: 4181022, projectSlug: 'maple-st-duplex', mock: false },
  { hash: '2763B4E63B2E8B5FB45A888411C8DDD5159A5C36135B76C77711A81DC1B63436', action: 'VaultDeposit', label: 'Vault deposit', from: addresses.ava, fromName: 'Ava Chen', to: addresses.mapleVault, toName: MV, amount: 10_000, currency: 'RLUSD', time: 'Sep 10, 2026 18:03', ledgerIndex: 4181560, projectSlug: 'maple-st-duplex', investor: 'Ava Chen', mock: false },
  { hash: '331E1AB88F476A447837AE609F1D817E908D2E81C9F68E4EED59D1F333FC43F0', action: 'VaultDeposit', label: 'Vault deposit', from: addresses.marcus, fromName: 'Marcus Johnson', to: addresses.mapleVault, toName: MV, amount: 40_000, currency: 'RLUSD', time: 'Sep 11, 2026 11:20', ledgerIndex: 4181644, projectSlug: 'maple-st-duplex', investor: 'Marcus Johnson', mock: false },
  { hash: '8301D619C039839ABF755BBC07FB3899DC4761ADD232C7C1093C914B01993A74', action: 'VaultDeposit', label: 'Vault deposit', from: addresses.priya, fromName: 'Priya Patel', to: addresses.mapleVault, toName: MV, amount: 30_000, currency: 'RLUSD', time: 'Sep 12, 2026 08:55', ledgerIndex: 4181712, projectSlug: 'maple-st-duplex', investor: 'Priya Patel', mock: false },
  { hash: 'F4A8E5B11493EB4D00BEB59BF072B0DD06F1A0274B1598B82D4E92C3BC0F9699', action: 'VaultDeposit', label: 'Vault deposit', from: addresses.kestrel, fromName: 'Kestrel Family Trust', to: addresses.mapleVault, toName: MV, amount: 40_000, currency: 'RLUSD', time: 'Sep 15, 2026 16:37', ledgerIndex: 4181901, projectSlug: 'maple-st-duplex', investor: 'Kestrel Family Trust', mock: false },
  { hash: '9372681ABAE1EC0E97C1D38AEF0C60602165DC3B5AF74F2327E078DD146A3A23', action: 'LoanSet', label: 'Loan set', from: addresses.mapleVault, fromName: MV, to: addresses.mapleAccount, toName: MA, amount: 120_000, currency: 'RLUSD', time: 'Sep 18, 2026 10:00', ledgerIndex: 4182200, projectSlug: 'maple-st-duplex', mock: false },
  { hash: 'BEB22940DAF5DE66E739E1F1FAFFB3C869A52CA3578504F85BCBD46155816738', action: 'EscrowCreate', label: 'Escrow create', from: addresses.mapleAccount, fromName: MA, to: addresses.builder, toName: HV, amount: 36_000, currency: 'RLUSD', time: 'Sep 18, 2026 10:02', ledgerIndex: 4182211, projectSlug: 'maple-st-duplex', milestoneId: 'foundation', mock: false },
  { hash: '3D7A5FEF5D9F416004E2730D43EC192317392712E7F49EE573005521A0B10332', action: 'EscrowCreate', label: 'Escrow create', from: addresses.mapleAccount, fromName: MA, to: addresses.builder, toName: HV, amount: 48_000, currency: 'RLUSD', time: 'Sep 18, 2026 10:02', ledgerIndex: 4182212, projectSlug: 'maple-st-duplex', milestoneId: 'framing', mock: false },
  { hash: '374BD18A63EBEAEB88F0E9FB3C1DB51FDC85AF700D1376A98A65FE7CF3573C79', action: 'EscrowCreate', label: 'Escrow create', from: addresses.mapleAccount, fromName: MA, to: addresses.builder, toName: HV, amount: 36_000, currency: 'RLUSD', time: 'Sep 18, 2026 10:03', ledgerIndex: 4182213, projectSlug: 'maple-st-duplex', milestoneId: 'roof', mock: false },
  { hash: 'B3FC14E3810EFD46B363B4905CB6E9D8B95D75A69E623AFA28648CCAFD494D39', action: 'Audit attestation', label: 'Audit filed', from: addresses.inspector, fromName: 'Dana Ruiz', to: addresses.mapleAccount, toName: MA, amount: null, currency: 'RLUSD', time: 'Oct 2, 2026 15:12', ledgerIndex: 4183340, projectSlug: 'maple-st-duplex', milestoneId: 'foundation', mock: true },
  { hash: '070B66285F1564DEAC258E52AC3D8AA91F4FCD651E865353598A3DC70D0BC806', action: 'Verdict attestation', label: 'Verdict filed', from: addresses.platform, fromName: P, to: addresses.mapleAccount, toName: MA, amount: null, currency: 'RLUSD', time: 'Oct 2, 2026 15:20', ledgerIndex: 4183347, projectSlug: 'maple-st-duplex', milestoneId: 'foundation', mock: true },
  { hash: 'EA4C90D837A868243617F3A5A11B40A3A0D3D9618B8F79C3A0AAB93F9B9A8CBA', action: 'EscrowFinish', label: 'Released', from: addresses.mapleAccount, fromName: MA, to: addresses.builder, toName: HV, amount: 36_000, currency: 'RLUSD', time: 'Oct 3, 2026 09:05', ledgerIndex: 4183402, projectSlug: 'maple-st-duplex', milestoneId: 'foundation', mock: false },
  { hash: '2D4373CB4848D83627620573A68D207407012685F78E954F662AE345326E495B', action: 'Audit attestation', label: 'Audit filed', from: addresses.inspector, fromName: 'Dana Ruiz', to: addresses.mapleAccount, toName: MA, amount: null, currency: 'RLUSD', time: 'Oct 23, 2026 14:48', ledgerIndex: 4185017, projectSlug: 'maple-st-duplex', milestoneId: 'framing', mock: true },
  { hash: '5C0E7A93D1F84B26A0E3C79D5B18F42A6E0D93C7B15A84F2D6E09C3B7A41F8E2', action: 'LoanPay', label: 'Loan payment', from: addresses.builder, fromName: HV, to: addresses.mapleVault, toName: MV, amount: 1_000, currency: 'RLUSD', time: 'Oct 18, 2026 09:00', ledgerIndex: 4184520, projectSlug: 'maple-st-duplex', mock: true },
  { hash: 'B42484FD259922604A75C7CFC5733F366B0A97D4D404099C903909E49CEACA86', action: 'Verdict attestation', label: 'Verdict filed', from: addresses.platform, fromName: P, to: addresses.mapleAccount, toName: MA, amount: null, currency: 'RLUSD', time: 'Oct 23, 2026 15:02', ledgerIndex: 4185029, projectSlug: 'maple-st-duplex', milestoneId: 'framing', mock: true },

  { hash: '3086047CCB5F80C41BBC9D7A34B3FCC0C9C59B7E9C29F99D57EAC0E976993A77', action: 'VaultDeposit', label: 'Vault deposit', from: addresses.ava, fromName: 'Ava Chen', to: addresses.oakVault, toName: 'Oak Ave Renovation vault', amount: 10_000, currency: 'RLUSD', time: 'Feb 3, 2026 12:30', ledgerIndex: 4102230, projectSlug: 'oak-ave-renovation', investor: 'Ava Chen', mock: true },
  { hash: '2EE97056B15EC54FD64A77CD9C1CAC4A609124A2ED8694D472FE9328F8985B52', action: 'LoanSet', label: 'Loan set', from: addresses.oakVault, fromName: 'Oak Ave Renovation vault', to: addresses.oakAccount, toName: 'Oak Ave Renovation account', amount: 40_000, currency: 'RLUSD', time: 'Feb 9, 2026 10:00', ledgerIndex: 4102811, projectSlug: 'oak-ave-renovation', mock: true },
  { hash: 'A84D1F6C3E92B07D5A1C48E6F3B29D07C5E81A4F6B3D92E0C7A15F48B6D3E2A9', action: 'EscrowFinish', label: 'Released', from: addresses.oakAccount, fromName: 'Oak Ave Renovation account', to: addresses.builder, toName: HV, amount: 12_000, currency: 'RLUSD', time: 'Feb 21, 2026 10:15', ledgerIndex: 4104410, projectSlug: 'oak-ave-renovation', milestoneId: 'demolition', mock: true },
  { hash: 'D16BF6A2E4B48A7943899322E3788A145526EC1485CD639CDF1E9DBABB25D3B8', action: 'EscrowFinish', label: 'Released', from: addresses.oakAccount, fromName: 'Oak Ave Renovation account', to: addresses.builder, toName: HV, amount: 16_000, currency: 'RLUSD', time: 'Mar 17, 2026 09:40', ledgerIndex: 4110022, projectSlug: 'oak-ave-renovation', milestoneId: 'rough-in', mock: true },
  { hash: 'E39C7A1F5D02B84E6C3A91F7D25B0E48A6C13F9D7B2E50A4C8F16D3B9E07A2C5', action: 'EscrowFinish', label: 'Released', from: addresses.oakAccount, fromName: 'Oak Ave Renovation account', to: addresses.builder, toName: HV, amount: 12_000, currency: 'RLUSD', time: 'Apr 11, 2026 11:30', ledgerIndex: 4114980, projectSlug: 'oak-ave-renovation', milestoneId: 'finishes', mock: true },
  { hash: '1DF210E0EB9B77E9C36F470BB8570F08049E49464A0001379844DBCD435897C8', action: 'LoanPay', label: 'Loan payment', from: addresses.oakAccount, fromName: 'Oak Ave Renovation account', to: addresses.oakVault, toName: 'Oak Ave Renovation vault', amount: 12_000, currency: 'RLUSD', time: 'Oct 1, 2026 09:00', ledgerIndex: 4183120, projectSlug: 'oak-ave-renovation', mock: true },
  { hash: '1DF210E0EB9B77E9C36F470BB8570F08049E49464A0001379844DBCD435897D9', action: 'LoanPay', label: 'Loan repaid', from: addresses.oakAccount, fromName: 'Oak Ave Renovation account', to: addresses.oakVault, toName: 'Oak Ave Renovation vault', amount: 29_084.93, currency: 'RLUSD', time: 'Oct 9, 2026 09:00', ledgerIndex: 4183890, projectSlug: 'oak-ave-renovation', mock: true },
  { hash: '6B1E4C02A9F37D58E0B4C61A27F9D3E85C0A4B71D29E6F3A8C5B07D14E92A6F1', action: 'Payment', label: 'Interest', from: addresses.oakVault, fromName: 'Oak Ave Renovation vault', to: addresses.ava, toName: 'Ava Chen', amount: 412.5, currency: 'RLUSD', time: 'Oct 10, 2026 12:00', ledgerIndex: 4183955, projectSlug: 'oak-ave-renovation', investor: 'Ava Chen', mock: true },
  { hash: '800929FF7065458BCDFB20962CAD43B49FFA2941E922C64C1B0341424F90A4F2', action: 'VaultDeposit', label: 'Vault deposit', from: addresses.priya, fromName: 'Priya Patel', to: addresses.willowVault, toName: 'Willow Rd ADU vault', amount: 31_500, currency: 'RLUSD', time: 'Oct 20, 2026 13:15', ledgerIndex: 4184702, projectSlug: 'willow-rd-adu', investor: 'Priya Patel', mock: true },
]

const auditHash = '2D4373CB4848D83627620573A68D207407012685F78E954F662AE345326E495B'
const verdictHash = 'B42484FD259922604A75C7CFC5733F366B0A97D4D404099C903909E49CEACA86'

function framingChecks(scenario: Scenario): Check[] {
  const reused = scenario === 'reused'
  return [
    { id: 'audit-signed', name: 'Inspector audit signed', ai: false, state: 'pass', reason: 'Dana Ruiz signed Oct 23, 2026', txHash: auditHash },
    { id: 'checklist', name: 'Audit checklist complete', ai: false, state: 'pass', reason: '12 of 12 framing items recorded' },
    { id: 'evidence', name: 'Required evidence present', ai: false, state: 'pass', reason: '3 photos and 1 invoice attached' },
    { id: 'on-site', name: 'Photos taken on site', ai: false, state: 'pass', reason: 'All within 40 m of 48 Maple St' },
    { id: 'recent', name: 'Photos are recent', ai: false, state: 'pass', reason: 'Taken Oct 19 to 21, after the escrow opened' },
    reused
      ? { id: 'reused', name: 'No reused photos', ai: false, state: 'fail', reason: 'IMG_2231.jpg matches a photo from Oak Ave Renovation', compare: true }
      : { id: 'reused', name: 'No reused photos', ai: false, state: 'pass', reason: 'No match in 1,284 archived photos' },
    { id: 'invoice', name: 'Invoice matches budget', ai: false, state: 'pass', reason: 'Beacon Lumber 47,610.00 against 48,000.00' },
    { id: 'stage', name: 'Stage matches photos', ai: true, state: 'pass', reason: 'Wall framing and sheathing visible' },
    { id: 'audit-evidence', name: 'Audit matches evidence', ai: true, state: 'pass', reason: 'Audit notes agree with the photos' },
    { id: 'documents', name: 'Documents consistent', ai: true, state: 'pass', reason: 'Names, dates and amounts agree' },
  ]
}

export const checkRuns: CheckRun[] = (['reused', 'honest'] as Scenario[]).map((scenario) => ({
  projectSlug: 'maple-st-duplex',
  milestoneId: 'framing',
  scenario,
  checks: framingChecks(scenario),
  verdict:
    scenario === 'reused'
      ? { state: 'fail', confidence: 0.98, txHash: verdictHash, reason: 'Release blocked until the photo is replaced' }
      : { state: 'pass', confidence: 0.94, reason: 'Release approved by all checks' },
}))

export const photoMatch: PhotoMatch = {
  submitted: { file: 'IMG_2231.jpg', project: 'Maple St Duplex', src: '/photos/framing-joists.png', captured: 'Oct 21, 2026 10:33' },
  archive: { file: 'IMG_0417.jpg', project: 'Oak Ave Renovation', src: '/photos/framing-joists.png', captured: 'Mar 14, 2026 15:20' },
  distance: 4,
  bits: 64,
  threshold: 10,
}

export const positions: Position[] = [
  { projectSlug: 'maple-st-duplex', invested: 10_000, shares: 10_000, interest: 0, withdrawable: 0, depositTx: '2763B4E63B2E8B5FB45A888411C8DDD5159A5C36135B76C77711A81DC1B63436' },
  { projectSlug: 'oak-ave-renovation', invested: 10_000, shares: 10_000, interest: 412.5, withdrawable: 10_412.5, depositTx: '3086047CCB5F80C41BBC9D7A34B3FCC0C9C59B7E9C29F99D57EAC0E976993A77' },
]

export const inspectorProfile = {
  firm: 'Hudson Code Inspections',
  license: 'NYS-CEO-3341',
  mismatchAddress: 'rPq4Wz7Jd2KcVn9XtLm3aGbY5sHf6k8Lm',
}

const framingInvoices: Invoice[] = [
  { number: 'INV-4471', vendor: 'Hudson Lumber Co.', description: 'Framing lumber package', amount: 21_480 },
  { number: 'INV-0932', vendor: 'Catskill Fastener Supply', description: 'Hangers, ties and fasteners', amount: 2_316.4 },
  { number: 'INV-118', vendor: 'Ridge Framing Crew', description: 'Framing labor, weeks 1 to 3', amount: 18_900 },
]

export const auditSpecs: AuditSpec[] = [
  {
    kind: 'milestone',
    key: 'maple-st-duplex/framing',
    projectSlug: 'maple-st-duplex',
    subject: 'Framing',
    kicker: 'Framing · 48,000 RLUSD in escrow',
    evidence: {
      version: 2,
      hash: 'A91F4E07C2B85D3196E0AB72F4C81D65E9A30B7C2F18D64E5A09B3C7D21EC03E',
      photos: ['IMG_2228.jpg', 'IMG_2230.jpg', 'IMG_2231.jpg', 'IMG_2232.jpg'],
      invoices: framingInvoices,
    },
    evidenceNext: {
      version: 3,
      hash: '5E0794C1A2D8B36F0E71C95A4B28D3E6F1A07C4B9E52D8316AF0C27B49E1B81D',
      photos: ['IMG_2228.jpg', 'IMG_2230.jpg', 'IMG_2232.jpg', 'IMG_2235.jpg'],
      invoices: framingInvoices,
    },
    lines: [
      { id: 'ext', trade: 'Exterior wall framing', amount: 18_000 },
      { id: 'int', trade: 'Interior partitions', amount: 9_000 },
      { id: 'floor', trade: 'Floor and roof framing', amount: 14_000 },
      { id: 'sheath', trade: 'Sheathing and bracing', amount: 7_000 },
    ],
    photoCandidates: ['DR_3301.jpg', 'DR_3302.jpg', 'DR_3303.jpg', 'DR_3304.jpg'],
  },
  {
    kind: 'visit',
    key: 'willow-rd-adu/pre-construction',
    projectSlug: 'willow-rd-adu',
    subject: 'Pre-construction',
    kicker: 'Pre-construction visit · 60,000 RLUSD principal',
    site: [
      ['Address', '7 Willow Rd, Rhinebeck, NY'],
      ['Parcel', 'SBL 135.17-1-22'],
      ['Building permit', 'BP-2026-0418'],
      ['Site GPS', '41.9271, -73.9124'],
      ['Builder', 'Hudson Valley Builders'],
      ['Scheduled', 'Oct 28, 2026, 9:30 AM'],
    ],
    lines: [
      { id: 'stakes', trade: 'Lot staked to survey' },
      { id: 'setbacks', trade: 'Setbacks match site plan' },
      { id: 'erosion', trade: 'Erosion control installed' },
      { id: 'permit', trade: 'Permit posted on site' },
    ],
    photoCandidates: ['DR_3401.jpg', 'DR_3402.jpg', 'DR_3403.jpg'],
  },
]

export const auditQueue: QueueItem[] = [
  { key: 'maple-st-duplex/framing', projectSlug: 'maple-st-duplex', subject: 'Framing', site: '48 Maple St, Beacon', evidence: '7 files · v2', due: 'Today', status: 'Evidence in', href: '/inspector/audit/maple-st-duplex/framing' },
  { key: 'maple-st-duplex/roof', projectSlug: 'maple-st-duplex', subject: 'Roof and Dry-in', site: '48 Maple St, Beacon', evidence: 'None yet', due: 'Dec 12, 2026', status: 'Waiting for evidence' },
  { key: 'willow-rd-adu/foundation', projectSlug: 'willow-rd-adu', subject: 'Foundation', site: '7 Willow Rd, Rhinebeck', evidence: 'None yet', due: 'Jan 15, 2027', status: 'Waiting for evidence' },
]

export const siteVisitQueue: QueueItem[] = [
  { key: 'willow-rd-adu/pre-construction', projectSlug: 'willow-rd-adu', subject: 'Pre-construction', site: '7 Willow Rd, Rhinebeck', evidence: 'Site plan · permit', due: 'Oct 28, 2026', status: 'Scheduled', href: '/inspector/site-visits/willow-rd-adu' },
]

const oakAuditTx = (hash: string, milestoneId: string, time: string, ledgerIndex: number): LedgerTx => ({
  hash,
  action: 'Audit attestation',
  label: 'Audit filed',
  from: addresses.inspector,
  fromName: 'Dana Ruiz',
  to: addresses.oakAccount,
  toName: 'Oak Ave Renovation account',
  amount: null,
  currency: 'RLUSD',
  time,
  ledgerIndex,
  projectSlug: 'oak-ave-renovation',
  milestoneId,
  mock: true,
})

const allDone = (trades: string[]) => trades.map((trade) => ({ trade, state: 'Done' as LineState }))

export const auditHistory: AuditRecord[] = [
  {
    id: '2D4373CB4848D83627620573A68D207407012685F78E954F662AE345326E495B',
    key: 'maple-st-duplex/framing',
    projectSlug: 'maple-st-duplex',
    subject: 'Framing',
    filed: 'Oct 23, 2026',
    lines: allDone(['Exterior wall framing', 'Interior partitions', 'Floor and roof framing', 'Sheathing and bracing']),
    sitePhotos: ['DR_3201.jpg', 'DR_3202.jpg'],
    evidenceVersion: 1,
    outcome: 'Failed',
    tx: oakAuditTx('2D4373CB4848D83627620573A68D207407012685F78E954F662AE345326E495B', 'framing', 'Oct 23, 2026 14:48', 4185017),
  },
  {
    id: 'B3FC14E3810EFD46B363B4905CB6E9D8B95D75A69E623AFA28648CCAFD494D39',
    key: 'maple-st-duplex/foundation',
    projectSlug: 'maple-st-duplex',
    subject: 'Foundation',
    filed: 'Oct 2, 2026',
    lines: allDone(['Footings', 'Foundation walls', 'Waterproofing', 'Backfill']),
    sitePhotos: ['DR_2901.jpg', 'DR_2902.jpg'],
    evidenceVersion: 1,
    outcome: 'Released',
    tx: oakAuditTx('B3FC14E3810EFD46B363B4905CB6E9D8B95D75A69E623AFA28648CCAFD494D39', 'foundation', 'Oct 2, 2026 15:12', 4183340),
  },
  {
    id: '7A1E93C04B6D28F5E1A07C39B4D82E6F05C1A9B37D4E82F60A5C13B9E7D24F18',
    key: 'oak-ave-renovation/finishes',
    projectSlug: 'oak-ave-renovation',
    subject: 'Finishes',
    filed: 'Apr 9, 2026',
    lines: allDone(['Drywall and paint', 'Flooring', 'Kitchen and bath fixtures']),
    sitePhotos: ['DR_1101.jpg'],
    evidenceVersion: 1,
    outcome: 'Released',
    tx: oakAuditTx('7A1E93C04B6D28F5E1A07C39B4D82E6F05C1A9B37D4E82F60A5C13B9E7D24F18', 'finishes', 'Apr 9, 2026 11:20', 4140212),
  },
]

for (const r of auditHistory) {
  const onLedger = ledger.find((t) => t.hash === r.id)
  if (onLedger) r.tx = onLedger
}

export interface VerificationCheck {
  name: string
  reason: string
}

export const verificationGroups: { group: 'Identity' | 'Feasibility' | 'Capability'; checks: VerificationCheck[] }[] = [
  {
    group: 'Identity',
    checks: [
      { name: 'Business registered', reason: 'NY DOS entity 5820417, active since 2014 (mock)' },
      { name: 'Contractor licence', reason: 'Dutchess County HIC-38812, valid to Jun 2027 (mock)' },
      { name: 'Principal identity', reason: 'Owner passed KYC, matched to the registration' },
    ],
  },
  {
    group: 'Feasibility',
    checks: [
      { name: 'Title and permits', reason: 'Clear title, building permit issued' },
      { name: 'Budget against comparables', reason: 'Within 6% of 14 local builds' },
      { name: 'Site matches parcel', reason: 'Address, lot lines and plans agree' },
    ],
  },
  {
    group: 'Capability',
    checks: [
      { name: 'Completed projects', reason: '11 finished builds in 5 years' },
      { name: 'Insurance in force', reason: 'General liability 2M, builder’s risk active' },
      { name: 'References', reason: '3 of 3 past clients confirmed' },
    ],
  },
]

export const verificationFeeTx = 'D6340424D20224853873360874CDC87681EF41F3CE9B4B1EA586273C3CC237B6'

export const memberSince = 2026

export const loadingLines = {
  checks: 'Squinting at the photos',
}

export const emptyLines = {
  queue: 'Queue is clear. Go look at a building.',
  transactions: 'No transactions yet. The ledger is waiting, politely.',
  auditFiled: 'Audit filed. The money still waits for the checks.',
}

export const disclaimer = 'XRPL Devnet. RLUSD is a devnet test token. Not an offer to sell securities.'
