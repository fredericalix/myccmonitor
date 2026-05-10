import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Antenna({
  icon,
  size = "md",
  className,
}: {
  icon: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const dims = size === "sm" ? "h-9 w-9" : size === "lg" ? "h-14 w-14" : "h-11 w-11";
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex items-center justify-center rounded-[4px]",
        "bg-[linear-gradient(180deg,var(--forge-rim-dim),var(--forge-floor-deep))]",
        "border border-[var(--forge-rim-bright)] surface-rivet",
        "text-[var(--copper-glow-strong)]",
        dims,
        className,
      )}
    >
      {icon}
    </span>
  );
}
