'use client'

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { Chip } from '@/components/status-tag'
import { cn } from '@/lib/utils'

export function SideSheet<S extends string>({
  open,
  onOpenChange,
  busy = false,
  title,
  description,
  sample,
  steps,
  step,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  busy?: boolean
  title: string
  description: string
  sample?: boolean
  steps: { id: S; label: string }[]
  step: S
  children: React.ReactNode
}) {
  const currentIndex = steps.findIndex((s) => s.id === step)
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-ink/20 motion-safe:transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <DialogPrimitive.Popup className="fixed top-0 right-0 z-50 flex h-full w-full max-w-[520px] flex-col border-l border-hairline bg-white outline-none motion-safe:transition-transform motion-safe:duration-200 data-ending-style:translate-x-full data-starting-style:translate-x-full">
          <div className="flex items-start justify-between gap-4 border-b border-hairline px-6 py-5">
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <DialogPrimitive.Title className="t-card">{title}</DialogPrimitive.Title>
                {sample && <Chip>Sample</Chip>}
              </div>
              <DialogPrimitive.Description className="t-label">{description}</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              disabled={busy}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-md hover:bg-accent disabled:opacity-40"
              aria-label="Close"
            >
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>
          <ol className="flex border-b border-hairline px-6" aria-label="Steps">
            {steps.map((s, i) => {
              const current = i === currentIndex
              return (
                <li
                  key={s.id}
                  aria-current={current ? 'step' : undefined}
                  className={cn(
                    'relative flex h-12 flex-1 items-center gap-2 text-[14px]',
                    current
                      ? 'text-ink after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-clay'
                      : i < currentIndex
                        ? 'text-ink'
                        : 'text-label',
                  )}
                >
                  <span className="font-mono text-[12px]">{i + 1}</span>
                  {s.label}
                </li>
              )
            })}
          </ol>
          <div className="flex flex-1 flex-col overflow-y-auto px-6 py-6">{children}</div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
