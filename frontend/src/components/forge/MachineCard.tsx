import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

type Variant = "default" | "action" | "logic";

const VARIANTS: Record<Variant, string> = {
  default: "bg-forge-machine border-[var(--forge-rim)]",
  action: "bg-forge-machine-action border-[#c44]",
  logic: "bg-forge-machine-logic border-[var(--forge-rim)]",
};

export function MachineCard({
  variant = "default",
  className,
  ...rest
}: ComponentProps<"div"> & { variant?: Variant }) {
  return (
    <div
      className={cn(
        "rounded-[8px] border-2 surface-rivet text-[var(--forge-text)]",
        VARIANTS[variant],
        className,
      )}
      {...rest}
    />
  );
}

export function MachineLabel({
  className,
  ...rest
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "text-[10px] font-bold uppercase tracking-[0.6px] text-[var(--forge-text-accent)]",
        "border-b border-[var(--forge-rim-dim)] pb-1.5 mb-2",
        "flex items-center justify-between gap-2",
        className,
      )}
      {...rest}
    />
  );
}
