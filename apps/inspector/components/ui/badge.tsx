import * as React from "react";
import { cn } from "@/lib/utils";

/** Small soft chip (apps/web Tag). Tone carries state; the label always says it in words. Use only when state differs between rows. */
export const tones = {
  neutral: "bg-neutral-bg text-neutral",
  brand: "bg-neutral-bg text-ink",
  ok: "bg-pass-bg text-pass",
  warn: "bg-review-bg text-review",
  bad: "bg-fail-bg text-fail",
  info: "bg-info-bg text-info",
  lock: "bg-neutral-bg text-neutral",
} as const;

export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1 rounded-full px-2.5 text-[12px] font-medium whitespace-nowrap [&_svg]:size-3.5",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
