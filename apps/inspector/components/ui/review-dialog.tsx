"use client";
import { useEffect, useId, useRef } from "react";
import { Button } from "./button";
import { ProcessFeedback } from "@/components/process-feedback";

/** Protected review before a signature. Native dialog supplies focus trapping and inert background. */
export function ReviewDialog({ open, title, children, confirmLabel, busy, onBack, onConfirm }: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  busy: boolean;
  onBack(): void;
  onConfirm(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const node = dialog.current;
    if (open && node && !node.open) node.showModal();
    if (!open && node?.open) node.close();
  }, [open]);
  return (
    <dialog ref={dialog} aria-labelledby={titleId} onCancel={(e) => { e.preventDefault(); if (!busy) onBack(); }}
      className="dialog-enter fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-xl overflow-y-auto rounded-panel bg-page p-6 text-ink shadow-overlay backdrop:bg-black/50 backdrop:backdrop-blur-sm">
      <h2 id={titleId} className="text-heading">{title}</h2>
      <p className="mt-2 text-small text-muted">Check the report below before submitting. Your audit records observations; it does not release funds.</p>
      <div className="my-6 space-y-4 text-small">{busy ? <ProcessFeedback title={confirmLabel} detail="Your audit is being processed. The receipt will appear after submission succeeds." /> : children}</div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button autoFocus variant="secondary" disabled={busy} onClick={onBack}>Back to edit</Button>
        <Button disabled={busy} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </dialog>
  );
}
