import * as React from "react";
import { cn } from "@/lib/utils";

export const tones = {
  neutral: "bg-subtle text-ink-2 ring-line",
  brand: "bg-brand-50 text-brand ring-brand-100",
  ok: "bg-ok-bg text-ok ring-ok-line",
  warn: "bg-warn-bg text-warn ring-warn-line",
  bad: "bg-bad-bg text-bad ring-bad-line",
  info: "bg-info-bg text-info ring-info-line",
  lock: "bg-lock-bg text-lock ring-lock-line",
} as const;

export type Tone = keyof typeof tones;

export function Badge({
  tone = "neutral",
  className,
  dot,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone; dot?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset [&_svg]:size-3.5",
        tones[tone],
        className,
      )}
      {...props}
    >
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {props.children}
    </span>
  );
}
