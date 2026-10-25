'use client'

import { createContext, useContext, useState } from 'react'
import type { LedgerAction } from '@/lib/mock-data'

export interface LedgerFilter {
  id: string
  label: string
  milestoneId?: string
  actions?: LedgerAction[]
}

const Ctx = createContext<{ filter: LedgerFilter | null; setFilter: (f: LedgerFilter | null) => void } | null>(null)

export function LedgerFilterProvider({ children }: { children: React.ReactNode }) {
  const [filter, setFilter] = useState<LedgerFilter | null>(null)
  return <Ctx.Provider value={{ filter, setFilter }}>{children}</Ctx.Provider>
}

export function useLedgerFilter() {
  return useContext(Ctx)
}
