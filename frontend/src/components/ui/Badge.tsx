import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant =
  | "neutral"
  | "accent"
  | "ok"
  | "warning"
  | "critical"
  | "unknown";

const variants: Record<Variant, string> = {
  neutral: "bg-surface text-text-muted border border-border",
  accent: "bg-accent-soft text-accent-strong border border-accent/20",
  ok: "bg-ok-soft text-ok border border-ok/30",
  warning: "bg-warning-soft text-warning border border-warning/30",
  critical: "bg-critical-soft text-critical border border-critical/30",
  unknown: "bg-unknown-soft text-text-muted border border-unknown/30",
};

export function Badge({
  variant = "neutral",
  className,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide",
        variants[variant],
        className,
      )}
      {...rest}
    />
  );
}
