function color(value: number): string {
  if (value >= 90) return "bg-rose-500";
  if (value >= 75) return "bg-amber-500";
  return "bg-emerald-500";
}

export function MetricBar({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-slate-400">
        <span className="w-9 font-mono uppercase">{label}</span>
        <span>—</span>
      </div>
    );
  }
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2">
      <span className="w-9 font-mono text-[11px] uppercase text-slate-500">
        {label}
      </span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full ${color(pct)} transition-[width] duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-10 text-right font-mono text-[11px] tabular-nums text-slate-600">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}
