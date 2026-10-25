'use client'

import { Check, KeyRound, Loader2, TriangleAlert } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/components/modal'
import { Button } from '@/components/ui/button'
import { shortKey } from '@/lib/api'
import { inspectorActions, useInspector } from '@/lib/inspector-store'
import { addresses, inspectorProfile } from '@/lib/mock-data'
import { cn } from '@/lib/utils'

type Phase = 'idle' | 'deriving' | 'ok' | 'mismatch'

export function KeyTag() {
  const loaded = useInspector((s) => s.keyLoaded)
  return (
    <>
      <button
        type="button"
        onClick={() => inspectorActions.openKeyDialog()}
        className={cn(
          'inline-flex h-7 items-center gap-1.5 rounded-sm px-2 text-[13px] font-medium',
          loaded ? 'bg-ok-bg text-ok' : 'bg-warn-bg text-warn hover:underline',
        )}
      >
        <KeyRound className="size-3.5" strokeWidth={1.75} aria-hidden />
        {loaded ? 'Key loaded' : 'Load key'}
      </button>
      <KeyDialog />
    </>
  )
}

function KeyDialog() {
  const open = useInspector((s) => s.keyDialogOpen)
  const loaded = useInspector((s) => s.keyLoaded)
  const [phase, setPhase] = useState<Phase>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  function useDemoKey() {
    const mismatch = new URLSearchParams(window.location.search).get('key') === 'mismatch'
    setPhase('deriving')
    timer.current = setTimeout(() => {
      if (mismatch) return setPhase('mismatch')
      inspectorActions.loadKey()
      setPhase('ok')
    }, 700)
  }

  function onOpenChange(o: boolean) {
    inspectorActions.setKeyDialog(o)
    if (!o) setPhase('idle')
  }

  const shown: Phase = loaded && phase === 'idle' ? 'ok' : phase

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Load signing key" meta="Dana Ruiz">
      <div className="flex flex-col gap-5">
        <p className="text-[15px] text-label">
          Your key signs each audit you file. It stays in this browser and is never sent to Drawproof.
        </p>

        {shown === 'ok' ? (
          <div className="flex items-center gap-3 rounded-md border border-hairline px-4 py-3">
            <span className="flex size-7 items-center justify-center rounded-full bg-ok-bg text-ok">
              <Check className="size-4" strokeWidth={2} aria-hidden />
            </span>
            <div className="flex flex-col">
              <span className="t-mono" title={addresses.inspector}>
                {shortKey(addresses.inspector)}
              </span>
              <span className="t-caption text-label">Matches Dana Ruiz, Verified inspector</span>
            </div>
          </div>
        ) : shown === 'mismatch' ? (
          <div className="flex items-start gap-3 rounded-md bg-bad-bg px-4 py-3 text-bad" role="alert">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
            <p className="text-[15px]">
              This key belongs to <span className="t-mono">{shortKey(inspectorProfile.mismatchAddress)}</span>, not Dana Ruiz.
            </p>
          </div>
        ) : (
          <p className="flex items-start gap-2 rounded-md bg-warn-bg px-4 py-3 text-[15px] text-warn">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} aria-hidden />
            Devnet test key only. Never paste a real wallet phrase.
          </p>
        )}

        <div className="flex justify-end gap-3">
          {shown === 'ok' ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={useDemoKey} disabled={shown === 'deriving'}>
                {shown === 'deriving' && <Loader2 className="animate-spin" aria-hidden />}
                {shown === 'mismatch' ? 'Try again' : 'Use demo inspector key'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
