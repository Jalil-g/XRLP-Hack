"use client";
// Progressive note: shown (and required) once the answer is not a clear yes. For a clear yes it hides behind "Add note",
// and stays visible if a note was already typed so nothing the inspector wrote is hidden or dropped.
import { useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export function NoteField({ label, value, onChange, required, invalid, placeholder }: {
  label: string;
  value: string;
  onChange(next: string): void;
  required: boolean;
  invalid: boolean;
  placeholder: string;
}) {
  const [opened, setOpened] = useState(false);
  if (!required && !opened && !value) {
    return (
      <button type="button" onClick={() => setOpened(true)} className="-my-2 inline-flex min-h-11 items-center gap-1 text-caption font-medium text-ink-2 hover:text-ink">
        <Plus className="size-3.5" aria-hidden /> Add note
      </button>
    );
  }
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label}
      aria-invalid={invalid}
      required={required}
      autoFocus={opened && !required}
      className={cn(
        "min-h-11 w-full rounded-control border bg-surface px-3 text-small placeholder:text-ink-3",
        invalid ? "border-fail" : "border-line-2",
      )}
    />
  );
}
