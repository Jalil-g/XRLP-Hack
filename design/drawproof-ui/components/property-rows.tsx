import { cn } from '@/lib/utils'

export interface PropertyRow {
  label: string
  value: React.ReactNode
}

export function PropertyRows({ rows, className }: { rows: PropertyRow[]; className?: string }) {
  return (
    <dl className={cn('divide-y divide-hairline', className)}>
      {rows.map((row) => (
        <div key={row.label} className="flex min-h-11 items-center justify-between gap-4 py-2.5">
          <dt className="t-label">{row.label}</dt>
          <dd className="tnum text-right text-[15px] text-ink">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}
