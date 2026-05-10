import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * A folded "blueprint" card — paper-on-metal aesthetic, with a subtle
 * top-right corner crease. Used for the Rules list.
 */
export function BlueprintCard({
  className,
  ...rest
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "relative rounded-[6px] border border-[var(--forge-rim)] surface-rivet",
        "bg-[linear-gradient(135deg,#3a2e22_0%,#2a1d10_100%)]",
        "text-[var(--forge-text)]",
        "before:absolute before:top-0 before:right-0 before:h-5 before:w-5",
        "before:bg-[linear-gradient(225deg,var(--forge-rim-bright)_0_50%,transparent_50%)]",
        "before:rounded-tr-[5px]",
        // dimmed graph-paper grid overlay
        "after:absolute after:inset-0 after:rounded-[5px] after:pointer-events-none",
        "after:bg-[linear-gradient(rgba(245,158,71,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(245,158,71,0.04)_1px,transparent_1px)]",
        "after:bg-[length:14px_14px]",
        className,
      )}
      {...rest}
    />
  );
}
