"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "icon";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 font-medium tracking-tight transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg select-none";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-on hover:bg-accent-strong shadow-warm-sm hover:shadow-warm-md active:translate-y-px",
  secondary:
    "bg-surface text-text border border-border-strong hover:bg-elevated hover:border-accent shadow-warm-sm",
  ghost:
    "bg-transparent text-text-muted hover:bg-accent-soft hover:text-text",
  danger:
    "bg-critical-soft text-critical border border-critical/30 hover:bg-critical hover:text-elevated",
  icon: "bg-transparent text-text-muted hover:bg-accent-soft hover:text-text",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-xs rounded-md",
  md: "h-10 px-4 text-sm rounded-md",
  lg: "h-12 px-6 text-base rounded-lg",
};

const iconSizes: Record<Size, string> = {
  sm: "h-8 w-8 rounded-md",
  md: "h-10 w-10 rounded-md",
  lg: "h-12 w-12 rounded-lg",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "secondary", size = "md", type = "button", ...rest }, ref) => {
    const sizeCls = variant === "icon" ? iconSizes[size] : sizes[size];
    return (
      <button
        ref={ref}
        type={type}
        className={cn(base, variants[variant], sizeCls, className)}
        {...rest}
      />
    );
  },
);
Button.displayName = "Button";
