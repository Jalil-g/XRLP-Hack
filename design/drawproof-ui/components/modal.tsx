'use client'

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export function Modal({
  open,
  onOpenChange,
  title,
  meta,
  children,
  className,
  dismissible = true,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  meta?: string
  children: React.ReactNode
  className?: string
  dismissible?: boolean
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(o) => (dismissible || o ? onOpenChange(o) : undefined)}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-ink/30" />
        <DialogPrimitive.Popup
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100vh-48px)] w-[calc(100%-32px)] max-w-[520px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-md border border-hairline bg-white text-ink outline-none',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-hairline px-6 py-5">
            <div>
              <DialogPrimitive.Title className="t-card">{title}</DialogPrimitive.Title>
              {meta && <p className="t-label mt-0.5">{meta}</p>}
            </div>
            {dismissible && (
              <DialogPrimitive.Close
                className="-mr-2 inline-flex size-9 items-center justify-center rounded-md hover:bg-accent"
                aria-label="Close"
              >
                <X className="size-5" />
              </DialogPrimitive.Close>
            )}
          </div>
          <div className="overflow-y-auto">{children}</div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
