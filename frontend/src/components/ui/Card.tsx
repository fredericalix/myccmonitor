import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

type Variant = "default" | "elevated" | "interactive" | "muted";

const variants: Record<Variant, string> = {
  default: "bg-surface border border-border shadow-warm-sm",
  elevated: "bg-elevated border border-border shadow-warm-md",
  interactive:
    "bg-surface border border-border shadow-warm-sm hover:shadow-warm-md hover:border-accent transition-all duration-200",
  muted: "bg-bg border border-border/60",
};

export function Card({
  variant = "default",
  className,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { variant?: Variant }) {
  return (
    <div
      className={cn("rounded-2xl", variants[variant], className)}
      {...rest}
    />
  );
}

export function CardHeader({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pt-5 pb-3", className)} {...rest} />;
}

export function CardBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 py-3", className)} {...rest} />;
}

export function CardFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "px-5 pt-3 pb-5 border-t border-border/60",
        className,
      )}
      {...rest}
    />
  );
}
