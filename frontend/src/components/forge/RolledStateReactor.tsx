import type { GroupRolledState } from "@/services/types";
import { cn } from "@/lib/cn";

const SHELL: Record<
  GroupRolledState,
  { ring: string; glow: string; core: string; label: string; pulse: string | null }
> = {
  ok: {
    ring: "var(--led-ok)",
    glow: "rgba(34, 197, 94, 0.4)",
    core: "linear-gradient(180deg, #16a34a, #166534)",
    label: "OPERATIONAL",
    pulse: null,
  },
  warning: {
    ring: "var(--led-warn)",
    glow: "rgba(245, 158, 11, 0.4)",
    core: "linear-gradient(180deg, #f59e0b, #92400e)",
    label: "WARNING",
    pulse: "led-pulse-warn",
  },
  critical: {
    ring: "#c44",
    glow: "rgba(239, 68, 68, 0.5)",
    core: "linear-gradient(180deg, #ef4444, #7c1414)",
    label: "CRITICAL",
    pulse: "led-pulse-crit",
  },
  unknown: {
    ring: "var(--forge-rim)",
    glow: "rgba(107, 91, 74, 0.3)",
    core: "linear-gradient(180deg, var(--forge-rim-dim), var(--forge-machine-bottom))",
    label: "UNKNOWN",
    pulse: null,
  },
};

export function RolledStateReactor({
  state,
  size = "lg",
  className,
}: {
  state: GroupRolledState;
  size?: "md" | "lg" | "xl";
  className?: string;
}) {
  const shell = SHELL[state];
  const px = size === "md" ? 80 : size === "xl" ? 140 : 110;

  return (
    <div
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: px, height: px }}
    >
      <div
        aria-hidden
        className={cn("absolute inset-0 rounded-full", shell.pulse)}
        style={{
          background: shell.core,
          border: `2px solid ${shell.ring}`,
          boxShadow: `0 0 24px ${shell.glow}, inset 0 0 ${px / 4}px rgba(0, 0, 0, 0.5)`,
        }}
      />
      <div
        aria-hidden
        className="absolute rounded-full"
        style={{
          inset: 6,
          border: `1px dashed rgba(255, 220, 180, 0.5)`,
        }}
      />
      <div className="relative flex flex-col items-center justify-center text-center px-2">
        <span className="text-[8px] font-bold uppercase tracking-[1.2px] text-[var(--forge-text-accent)]/80">
          Rolled-up
        </span>
        <span className="font-serif text-[16px] leading-tight text-[var(--forge-text)] mt-0.5">
          {shell.label}
        </span>
      </div>
    </div>
  );
}
