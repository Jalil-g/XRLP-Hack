'use client'

import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { useBuilder } from '@/lib/builder-store'
import { cn } from '@/lib/utils'

export function NextActionBand() {
  const framing = useBuilder((s) => s.framing)
  if (framing !== 'failed') return null
  return (
    <div className="mb-8 flex items-center justify-between gap-4 rounded-md bg-ink px-6 py-4">
      <p className="text-[17px] text-white">Maple St · Framing failed 1 check</p>
      <Link href="/builder/projects/maple-st-duplex" className={cn(buttonVariants({ variant: 'secondary' }), 'border-white')}>
        Fix evidence
      </Link>
    </div>
  )
}
