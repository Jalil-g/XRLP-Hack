import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

export function PlainSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  className?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full appearance-none rounded-md border border-control bg-white pr-9 pl-3 text-[15px] text-ink outline-none focus-visible:border-ink focus-visible:ring-2 focus-visible:ring-ink/20"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink" aria-hidden />
    </div>
  )
}
