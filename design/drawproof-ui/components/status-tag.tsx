import { cn } from '@/lib/utils'

const GREEN = new Set(['Released', 'Checks passed', 'Verified', 'Complete', 'Accepted', 'RLUSD ready', 'Paid'])
const RED = new Set(['Failed', 'Missing'])
const AMBER = new Set(['Needs review', 'Expired', 'Stalled'])

export function toneFor(status: string) {
  if (GREEN.has(status)) return 'bg-ok-bg text-ok'
  if (RED.has(status) || status.startsWith('Failed')) return 'bg-bad-bg text-bad'
  if (AMBER.has(status)) return 'bg-warn-bg text-warn'
  return 'bg-neutral-bg text-neutral'
}

export function StatusTag({ status, className }: { status: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded-sm px-2 text-[13px] font-medium leading-none whitespace-nowrap',
        toneFor(status),
        className,
      )}
    >
      {status}
    </span>
  )
}

export function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded-sm bg-neutral-bg px-2 text-[13px] font-medium leading-none text-neutral',
        className,
      )}
    >
      {children}
    </span>
  )
}
