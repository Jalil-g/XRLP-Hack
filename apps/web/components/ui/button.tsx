import * as React from "react";
import { cn } from "@/lib/utils";

const variants = {
  primary: "bg-action text-white hover:bg-action-hover active:bg-action-press",
  secondary: "bg-band text-ink hover:bg-band-2",
  quiet: "text-ink hover:bg-band",
  danger: "bg-band text-fail hover:bg-fail-bg",
} as const;

const sizes = {
  sm: "min-h-11 px-3.5 text-caption font-semibold gap-1.5",
  md: "min-h-11 px-5 text-small font-semibold gap-2",
  lg: "min-h-12 px-6 py-2 text-body font-semibold gap-2",
} as const;

export type ButtonVariant = keyof typeof variants;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: keyof typeof sizes;
}

export const buttonClass = (variant: ButtonVariant = "primary", size: keyof typeof sizes = "md", className?: string) =>
  cn(
    "inline-flex shrink-0 items-center justify-center rounded-full whitespace-nowrap transition-[background-color,transform] duration-150 ease-out active:scale-[0.98]",
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
