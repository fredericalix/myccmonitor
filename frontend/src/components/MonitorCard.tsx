import type { Monitor } from "@/services/types";
import { StateBadge } from "./StateBadge";

function formatRelative(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return date.toLocaleString();
}

export function MonitorCard({ monitor }: { monitor: Monitor }) {
  const since = formatRelative(monitor.current_state_since);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-slate-300">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-900">
            {monitor.display_name}
          </h3>
          <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
            {monitor.cc_resource_id ?? monitor.kind}
          </p>
        </div>
        <StateBadge state={monitor.current_state} />
      </div>
      {monitor.current_message && (
        <p className="mt-2 text-xs text-slate-600">
          {monitor.current_message}
        </p>
      )}
      {since && (
        <p className="mt-1 text-[11px] text-slate-400">since {since}</p>
      )}
    </div>
  );
}
