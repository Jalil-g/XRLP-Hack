"use client";
// Progressive note: shown (and required) once the answer is not a clear yes. For a clear yes it hides behind "Add note",
// and stays visible if a note was already typed so nothing the inspector wrote is hidden or dropped.
import { useState } from "react";
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
      <button type="button" onClick={() => setOpened(true)} className="min-h-11 text-caption font-medium text-brand hover:underline">
        Add note
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
        "min-h-11 w-full rounded-control border bg-surface px-3 py-1.5 text-small placeholder:text-faint focus:ring-2 focus:border-brand",
        invalid ? "border-bad" : "border-line",
      )}
    />
  );
}
