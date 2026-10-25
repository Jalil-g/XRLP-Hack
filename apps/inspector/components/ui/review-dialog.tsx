"use client";
import { useEffect, useId, useRef } from "react";
import { Button } from "./button";

/** Protected review before a signature. Native dialog supplies focus trapping and inert background. */
export function ReviewDialog({ open, title, note, children, confirmLabel, busy, onBack, onConfirm }: {
  open: boolean;
  title: string;
  /** One consequence line under the title (R2: confirmation before a signature). */
  note?: string;
  children: React.ReactNode;
  confirmLabel: string;
  busy: boolean;
  onBack(): void;
  onConfirm(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    const node = dialog.current;
    if (open && node && !node.open) {
      node.showModal();
      back.current?.focus(); // Back, not the first focusable (Proof), takes initial focus.
    }
    if (!open && node?.open) node.close();
  }, [open]);
  return (
    <dialog ref={dialog} aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); if (!busy) onBack(); }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-[520px] overflow-y-auto rounded-panel bg-surface p-0 text-ink shadow-overlay backdrop:bg-black/30">
      <div className="px-6 pt-6">
        <h2 id={titleId} className="text-heading">{title}</h2>
        {note && <p className="mt-1 text-small text-ink-2">{note}</p>}
      </div>
      <div className="space-y-5 px-6 py-5 text-small">{children}</div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-line px-6 py-4">
        <Button ref={back} autoFocus variant="secondary" disabled={busy} onClick={onBack}>Back to edit</Button>
        <Button disabled={busy} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </dialog>
  );
}
