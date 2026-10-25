'use client'

import { useSyncExternalStore } from 'react'
import { sovTemplates, type LedgerTx, type SovLine } from './mock-data'

export type FramingStage = 'failed' | 'queued' | 'checking' | 'passed'
export type DocStatus = 'Checking' | 'Accepted'
export type WizardStep = 'project' | 'sov' | 'documents' | 'fee' | 'review'

export interface Draft {
  step: WizardStep
  completed: WizardStep[]
  name: string
  address: string
  category: 'New build' | 'Renovation' | 'ADU'
  principal: string
  termDays: string
  lines: SovLine[]
  docs: Record<string, { file: string; status: DocStatus }>
  feeTx: LedgerTx | null
  submitted: boolean
  verified: boolean
  credentialTx: LedgerTx | null
}

interface State {
  framing: FramingStage
  framingFiles: string[]
  upload: { milestoneId: string } | null
  txs: LedgerTx[]
  draft: Draft
}

const freshDraft = (): Draft => ({
  step: 'project',
  completed: [],
  name: '',
  address: '',
  category: 'New build',
  principal: '120,000',
  termDays: '180',
  lines: sovTemplates['New build'].lines.map((l) => ({ ...l })),
  docs: {},
  feeTx: null,
  submitted: false,
  verified: false,
  credentialTx: null,
})

const initial: State = {
  framing: 'failed',
  framingFiles: ['IMG_2228.jpg', 'IMG_2230.jpg', 'IMG_2231.jpg'],
  upload: null,
  txs: [],
  draft: freshDraft(),
}

let state = initial
const listeners = new Set<() => void>()

function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useBuilder<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(state),
    () => select(initial),
  )
}

export const builderActions = {
  openUpload(milestoneId: string) {
    set({ upload: { milestoneId } })
  },
  closeUpload() {
    set({ upload: null })
  },
  submitEvidence(milestoneId: string, files: string[]) {
    if (milestoneId !== 'framing') return set({ upload: null })
    set({ upload: null, framing: 'queued', framingFiles: files })
    setTimeout(() => set({ framing: 'checking' }), 1600)
  },
  finishChecks() {
    set({ framing: 'passed' })
  },
  addTx(tx: LedgerTx) {
    set((s) => ({ txs: [tx, ...s.txs] }))
  },
  updateDraft(patch: Partial<Draft>) {
    set((s) => ({ draft: { ...s.draft, ...patch } }))
  },
  getDraft() {
    return state.draft
  },
  resetDraft() {
    set({ draft: freshDraft() })
  },
}
