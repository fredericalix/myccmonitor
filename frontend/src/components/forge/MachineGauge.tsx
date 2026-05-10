export type GaugeState = "loading" | "no-data" | "data" | "unavailable";

function gradient(value: number): string {
  if (value >= 90)
    return "linear-gradient(90deg, var(--led-warn), var(--led-crit))";
  if (value >= 75)
    return "linear-gradient(90deg, var(--copper-glow), var(--led-warn))";
  return "linear-gradient(90deg, #16a34a, var(--led-ok))";
}

export function MachineGauge({
  label,
  value,
  state = "data",
}: {
  label: string;
  value: number | null;
  state?: GaugeState;
}) {
  const effective: GaugeState =
    value === null || value === undefined || Number.isNaN(value)
      ? state === "loading"
        ? "loading"
        : state === "unavailable"
          ? "unavailable"
          : "no-data"
      : "data";

  const labelEl = (
    <span className="w-9 font-mono text-[10px] uppercase tracking-[0.6px] text-[var(--forge-text-muted)]">
      {label}
    </span>
  );

  if (effective === "unavailable") {
    return (
      <div className="flex items-center gap-2">
        {labelEl}
        <div className="h-1.5 flex-1 rounded-sm border border-[var(--forge-rim-dim)] bg-[var(--forge-floor-deep)]/60" />
        <span className="w-10 text-right font-mono text-[10px] italic text-[var(--forge-text-dim)]">
          n/a
        </span>
      </div>
    );
  }

  if (effective === "loading") {
    return (
      <div className="flex items-center gap-2">
        {labelEl}
        <div className="h-1.5 flex-1 overflow-hidden rounded-sm border border-[var(--forge-rim-dim)] animate-forge-shimmer" />
        <span className="w-10 text-right font-mono text-[10px] text-[var(--forge-text-dim)] opacity-60">
          …
        </span>
      </div>
    );
  }

  if (effective === "no-data") {
    return (
      <div className="flex items-center gap-2">
        {labelEl}
        <div className="h-1.5 flex-1 rounded-sm border border-[var(--forge-rim-dim)] bg-[var(--forge-floor-deep)]/60" />
        <span className="w-10 text-right font-mono text-[10px] text-[var(--forge-text-dim)]">
          —
        </span>
      </div>
    );
  }

  const pct = Math.max(0, Math.min(100, value as number));

  return (
    <div className="flex items-center gap-2" title={`${label}: ${pct.toFixed(2)}%`}>
      {labelEl}
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-sm border border-[var(--forge-rim-dim)] bg-[var(--forge-floor-deep)]">
        <div
          className="h-full rounded-sm transition-[width] duration-700 ease-out"
          style={{ width: `${pct}%`, background: gradient(pct) }}
        />
      </div>
      <span className="w-10 text-right font-mono text-[10px] tabular-nums text-[var(--forge-text)]">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}
