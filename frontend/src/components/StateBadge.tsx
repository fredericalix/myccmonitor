import type { MonitorState } from "@/services/types";

const STYLES: Record<MonitorState, string> = {
  ok: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  warning: "bg-amber-50 text-amber-700 ring-amber-600/30",
  critical: "bg-rose-50 text-rose-700 ring-rose-600/30",
  unknown: "bg-slate-50 text-slate-600 ring-slate-500/20",
};

export function StateBadge({ state }: { state: MonitorState }) {
  const cls = STYLES[state] ?? STYLES.unknown;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold uppercase tracking-wide ring-1 ring-inset ${cls}`}
    >
      {state}
    </span>
  );
}
