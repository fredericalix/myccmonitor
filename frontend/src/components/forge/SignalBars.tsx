import { cn } from "@/lib/cn";

/**
 * Channel-health visualization. Maps `failureCount` (and optionally a recent
 * success flag) to a 5-bar signal indicator. Dark/critical when failing.
 */
export function SignalBars({
  failureCount,
  hasRecentSuccess = true,
  disabled = false,
  className,
}: {
  failureCount: number;
  hasRecentSuccess?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  // 5 bars; signal strength inversely proportional to failures; capped at 5.
  const cap = 5;
  const strength = disabled
    ? 0
    : Math.max(0, Math.min(cap, cap - failureCount));
  const failing = failureCount > 0 && !hasRecentSuccess;

  const color = disabled
    ? "var(--led-dim)"
    : failing
      ? "var(--led-crit)"
      : strength === cap
        ? "var(--led-ok)"
        : "var(--led-warn)";

  return (
    <span
      aria-hidden
      className={cn("inline-flex items-end gap-[2px] h-4", className)}
    >
      {Array.from({ length: cap }, (_, i) => {
        const active = i < strength;
        const height = 30 + i * 17.5; // 30, 47.5, 65, 82.5, 100%
        return (
          <span
            key={i}
            className="w-[3px] rounded-[1px]"
            style={{
              height: `${height}%`,
              background: active ? color : "var(--forge-rim-dim)",
              boxShadow: active && !disabled ? `0 0 4px ${color}` : "none",
              opacity: active ? 1 : 0.4,
            }}
          />
        );
      })}
    </span>
  );
}
