import * as React from "react";
import { cn } from "@/lib/utils";

/** Notion-style soft chip. Tone carries state; the label always says it in words. */
export const tagTones = {
  neutral: "bg-neutral-bg text-neutral",
  info: "bg-info-bg text-info",
  pass: "bg-pass-bg text-pass",
  fail: "bg-fail-bg text-fail",
  review: "bg-review-bg text-review",
} as const;

export type Tone = keyof typeof tagTones;

export function Tag({ tone = "neutral", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-tag px-2 text-caption font-medium whitespace-nowrap [&_svg]:size-3.5",
        tagTones[tone],
        className,
      )}
      {...props}
    />
  );
}
