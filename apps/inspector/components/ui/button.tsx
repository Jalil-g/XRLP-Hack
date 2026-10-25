import * as React from "react";
import { cn } from "@/lib/utils";

const variants = {
  primary: "bg-brand text-white hover:bg-brand-600 ",
  brand: "bg-brand text-white hover:bg-brand-600 ",
  secondary: "border border-line-2 bg-surface text-ink hover:bg-subtle ",
  ghost: "text-ink-2 hover:bg-subtle hover:text-ink",
  success: "bg-ok text-white hover:bg-ok/90 ",
  danger: "bg-surface text-bad border border-bad-line hover:bg-bad-bg",
} as const;

const sizes = {
  sm: "min-h-11 px-3 text-caption gap-1.5 rounded-control",
  md: "min-h-11 px-4 text-small gap-2 rounded-control",
  lg: "min-h-11 px-5 py-2 text-small gap-2 rounded-control",
  icon: "h-11 w-11 rounded-control",
} as const;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export const buttonClass = (variant: keyof typeof variants = "primary", size: keyof typeof sizes = "md", className?: string) =>
  cn(
    "inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
    variants[variant],
    sizes[size],
    className,
  );

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "primary", size = "md", type = "button", ...props },
  ref,
) {
  return <button ref={ref} type={type} className={buttonClass(variant, size, className)} {...props} />;
});
