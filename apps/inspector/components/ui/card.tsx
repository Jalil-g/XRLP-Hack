import * as React from "react";
import { cn } from "@/lib/utils";

/** Kept for the groups that are one task (checklist, questions, re-audit) and the receipt. Everything else sits on the canvas. */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0 overflow-hidden rounded-panel border border-line bg-surface", className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex min-h-16 items-center justify-between gap-4 border-b border-line px-5 py-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-[17px] leading-6 font-semibold tracking-[-0.01em] text-ink", className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-5", className)} {...props} />;
}
