import { cn } from "@/lib/cn";

export type MetricBarState = "loading" | "no-data" | "data" | "unavailable";

function gradient(value: number): string {
  if (value >= 90) return "from-critical/80 to-critical";
  if (value >= 75) return "from-warning/80 to-warning";
  return "from-accent/80 to-accent";
}

export function MetricBar({
  label,
  value,
  state = "data",
}: {
  label: string;
  value: number | null;
  state?: MetricBarState;
}) {
  // The caller's `state` decides loading / unavailable / data; if the value
  // is null we override to whichever "no-value" variant best matches.
  const effectiveState: MetricBarState =
    value === null || value === undefined || Number.isNaN(value)
      ? state === "loading"
        ? "loading"
        : state === "unavailable"
          ? "unavailable"
          : "no-data"
      : "data";

  if (effectiveState === "unavailable") {
    return (
      <div className="flex items-center gap-2 text-[11px] text-text-subtle">
        <span className="w-9 font-mono uppercase tracking-wider">{label}</span>
        <div className="h-2 flex-1 rounded-full bg-bg/40 ring-1 ring-inset ring-border/30" />
        <span className="w-10 text-right font-mono italic">n/a</span>
      </div>
    );
  }

  if (effectiveState === "loading") {
    return (
      <div className="flex items-center gap-2 text-[11px] text-text-subtle">
        <span className="w-9 font-mono uppercase tracking-wider">{label}</span>
        <div className="h-2 flex-1 overflow-hidden rounded-full ring-1 ring-inset ring-border/60 animate-warm-shimmer" />
        <span className="w-10 text-right font-mono opacity-60">…</span>
      </div>
    );
  }
  if (effectiveState === "no-data") {
    return (
      <div className="flex items-center gap-2 text-[11px] text-text-subtle">
        <span className="w-9 font-mono uppercase tracking-wider">{label}</span>
        <div className="h-2 flex-1 rounded-full bg-bg/60" />
        <span className="w-10 text-right font-mono">—</span>
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, value as number));
  return (
    <div
      className="flex items-center gap-2 group"
      title={`${label}: ${pct.toFixed(2)}%`}
    >
      <span className="w-9 font-mono text-[11px] uppercase tracking-wider text-text-muted">
        {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg/70 ring-1 ring-inset ring-border/60">
        <div
          className={cn(
            "h-full rounded-full bg-gradient-to-r transition-[width] duration-700 ease-out",
            gradient(pct),
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-10 text-right font-mono text-[11px] tabular-nums text-text-muted">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}
