import * as React from "react";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded-control border border-line-2 bg-surface px-3 text-body text-ink placeholder:text-ink-3 transition-colors duration-150 hover:border-ink-3 focus:border-action focus:outline-none focus-visible:outline-none focus:ring-3 focus:ring-action/15 disabled:bg-band disabled:text-ink-2";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(field, "h-11", className)} {...props} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return <textarea ref={ref} className={cn(field, "min-h-24 py-2.5", className)} {...props} />;
});

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...props }, ref) {
  return <select ref={ref} className={cn(field, "h-11 pr-8", className)} {...props} />;
});

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-small font-medium text-ink", className)} {...props} />;
}
