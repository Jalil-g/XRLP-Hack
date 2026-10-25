import * as React from "react";
import { cn } from "@/lib/utils";

const variants = {
  primary: "bg-ink text-white hover:bg-ink/90 shadow-sm",
  brand: "bg-brand text-white hover:bg-brand-600 shadow-sm",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-subtle shadow-xs",
  ghost: "text-ink-2 hover:bg-subtle hover:text-ink",
  success: "bg-ok text-white hover:bg-ok/90 shadow-sm",
  danger: "bg-surface text-bad border border-bad-line hover:bg-bad-bg",
} as const;

const sizes = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-md",
  md: "h-9 px-4 text-sm gap-2 rounded-lg",
  lg: "h-11 px-5 text-[15px] gap-2 rounded-lg",
  icon: "h-8 w-8 rounded-md",
} as const;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export const buttonClass = (variant: keyof typeof variants = "primary", size: keyof typeof sizes = "md", className?: string) =>
  cn(
    "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
    variants[variant],
    sizes[size],
    className,
  );

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", ...props },
  ref,
) {
  return <button ref={ref} className={buttonClass(variant, size, className)} {...props} />;
});
