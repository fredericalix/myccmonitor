import { cn } from "@/lib/cn";

/**
 * Animated belt segment. Place between two machines on the assembly line.
 */
export function Conveyor({
  width = 32,
  active = true,
  className,
}: {
  width?: number;
  active?: boolean;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "relative h-5 overflow-hidden border-y",
        "border-t-[var(--forge-rim-bright)] border-b-[var(--forge-floor-deep)]",
        "bg-[linear-gradient(180deg,var(--forge-machine-bottom),var(--forge-floor))]",
        className,
      )}
      style={{ width }}
    >
      <div
        className={cn(
          "absolute inset-0",
          active && "animate-conveyor",
          !active && "opacity-50",
        )}
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, rgba(255, 220, 180, 0.18) 0 6px, transparent 6px 12px)",
        }}
      />
    </div>
  );
}
