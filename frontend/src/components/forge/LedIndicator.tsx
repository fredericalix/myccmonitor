import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import type { MonitorState } from "@/services/types";

type Severity = MonitorState | "dim";

const COLORS: Record<Severity, { bg: string; glow: string; pulse: string | null }> = {
  ok: { bg: "var(--led-ok)", glow: "var(--led-ok)", pulse: null },
  warning: { bg: "var(--led-warn)", glow: "var(--led-warn)", pulse: "led-pulse-warn" },
  critical: { bg: "var(--led-crit)", glow: "var(--led-crit)", pulse: "led-pulse-crit" },
  unknown: { bg: "var(--led-dim)", glow: "var(--led-dim)", pulse: null },
  dim: { bg: "var(--led-dim)", glow: "transparent", pulse: null },
};

const SIZES = {
  xs: 6,
  sm: 8,
  md: 10,
  lg: 14,
} as const;

export type LedSize = keyof typeof SIZES;

export function LedIndicator({
  state,
  size = "sm",
  className,
  pulse: pulseOverride,
}: {
  state: Severity;
  size?: LedSize;
  className?: string;
  /** Force pulse on/off; defaults to severity-driven (warn=1.5s, crit=0.5s, others=static). */
  pulse?: boolean;
}) {
  const cfg = COLORS[state];
  const px = SIZES[size];
  const pulseClass =
    pulseOverride === false
      ? null
      : pulseOverride === true
        ? state === "critical"
          ? "led-pulse-crit"
          : "led-pulse-warn"
        : cfg.pulse;

  const style: CSSProperties = {
    width: px,
    height: px,
    background: cfg.bg,
    boxShadow:
      cfg.glow === "transparent"
        ? "inset 0 0 2px rgba(255, 255, 255, 0.4)"
        : `0 0 ${Math.round(px * 0.9)}px ${cfg.glow}, inset 0 0 2px rgba(255, 255, 255, 0.6)`,
    color: cfg.glow,
  };

  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        "inline-block rounded-full align-middle",
        pulseClass,
        className,
      )}
    />
  );
}
