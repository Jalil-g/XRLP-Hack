'use client'

import { useSyncExternalStore } from 'react'
import type { AuditRecord } from './mock-data'

interface State {
  keyLoaded: boolean
  keyDialogOpen: boolean
  filed: AuditRecord[]
}

const initial: State = { keyLoaded: false, keyDialogOpen: false, filed: [] }

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

export function useInspector<T>(select: (s: State) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(state),
    () => select(initial),
  )
}

export const inspectorActions = {
  openKeyDialog() {
    set({ keyDialogOpen: true })
  },
  setKeyDialog(open: boolean) {
    set({ keyDialogOpen: open })
  },
  loadKey() {
    set({ keyLoaded: true })
  },
  file(record: AuditRecord) {
    set((s) => ({ filed: [record, ...s.filed.filter((r) => r.key !== record.key)] }))
  },
}
