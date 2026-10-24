import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink shadow-xs placeholder:text-faint focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...props },
  ref,
) {
  return (
    <textarea
      ref={ref}
      className={cn(
        "min-h-20 w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink shadow-xs placeholder:text-faint focus:border-brand focus:ring-2 focus:ring-brand/20 focus:outline-none",
        className,
      )}
      {...props}
    />
  );
});

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label className={cn("text-[13px] font-medium text-ink-2", className)} {...props} />;
}
