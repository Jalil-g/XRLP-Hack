import * as React from "react";
import { cn } from "@/lib/utils";

// Same shape and weights as apps/web/components/ui/button.tsx: black pill primary, grey-band secondary.
const variants = {
  primary: "bg-action text-white hover:bg-action-hover active:bg-action-press",
  brand: "bg-action text-white hover:bg-action-hover active:bg-action-press",
  secondary: "border border-line-2 bg-surface text-ink hover:bg-band",
  ghost: "text-ink hover:bg-band",
  success: "bg-pass text-white hover:bg-pass/90",
  danger: "bg-band text-fail hover:bg-fail-bg",
} as const;

const sizes = {
  sm: "min-h-11 px-3.5 text-caption font-normal gap-1.5 rounded-control",
  md: "min-h-11 px-5 text-small font-normal gap-2 rounded-control",
  lg: "min-h-12 px-6 py-2 text-body font-normal gap-2 rounded-control",
  icon: "size-11 rounded-control",
} as const;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export const buttonClass = (variant: keyof typeof variants = "primary", size: keyof typeof sizes = "md", className?: string) =>
  cn(
    "inline-flex shrink-0 items-center justify-center whitespace-nowrap transition-[background-color,transform] duration-150 ease-out active:scale-[0.98]",
    "disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0",
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
