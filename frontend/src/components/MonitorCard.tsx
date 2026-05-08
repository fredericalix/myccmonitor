"use client";

import { useEffect, useRef } from "react";
import type { MetricSnapshot, Monitor } from "@/services/types";
import { MetricBar } from "./MetricBar";
import { StateBadge } from "./StateBadge";
import { cn } from "@/lib/cn";

function formatRelative(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return date.toLocaleString();
}

const dotByState = {
  ok: "bg-ok",
  warning: "bg-warning",
  critical: "bg-critical",
  unknown: "bg-unknown",
} as const;

export function MonitorCard({
  monitor,
  metrics,
}: {
  monitor: Monitor;
  metrics?: MetricSnapshot;
}) {
  const since = formatRelative(monitor.current_state_since);
  const showMetrics = monitor.kind !== "synthetic";

  // Pulse on fresh metrics frames
  const cardRef = useRef<HTMLDivElement | null>(null);
  const lastTsRef = useRef<string | null>(null);
  useEffect(() => {
    if (!metrics?.ts) return;
    if (lastTsRef.current === metrics.ts) return;
    lastTsRef.current = metrics.ts;
    const node = cardRef.current;
    if (!node) return;
    node.classList.remove("animate-warm-pulse");
    // restart animation
    void node.offsetWidth;
    node.classList.add("animate-warm-pulse");
  }, [metrics?.ts]);

  // Pulse on state change
  const lastStateRef = useRef<string | null>(monitor.current_state);
  useEffect(() => {
    if (lastStateRef.current === monitor.current_state) return;
    lastStateRef.current = monitor.current_state;
    const node = cardRef.current;
    if (!node) return;
    node.classList.remove("animate-warm-pulse");
    void node.offsetWidth;
    node.classList.add("animate-warm-pulse");
  }, [monitor.current_state]);

  return (
    <div
      ref={cardRef}
      className="rounded-2xl border border-border bg-surface shadow-warm-sm hover:shadow-warm-md hover:border-accent transition-all duration-200 p-5 group relative overflow-hidden"
    >
      {/* Live state ribbon */}
      <span
        className={cn(
          "absolute left-0 top-0 h-full w-1 rounded-l-2xl",
          dotByState[monitor.current_state],
        )}
        aria-hidden
      />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 pr-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "relative inline-flex h-2 w-2 items-center justify-center",
              )}
              aria-hidden
            >
              <span
                className={cn(
                  "absolute inset-0 rounded-full opacity-50",
                  dotByState[monitor.current_state],
                  monitor.current_state === "critical" && "animate-dot-ping",
                )}
              />
              <span
                className={cn(
                  "relative h-2 w-2 rounded-full",
                  dotByState[monitor.current_state],
                )}
              />
            </span>
            <h3 className="truncate font-serif text-lg leading-tight text-text">
              {monitor.display_name}
            </h3>
          </div>
          <p className="mt-1 truncate font-mono text-[11px] text-text-subtle">
            {monitor.cc_resource_id ?? monitor.kind}
          </p>
        </div>
        <StateBadge state={monitor.current_state} />
      </div>

      {showMetrics ? (
        <div className="mt-4 space-y-2">
          <MetricBar label="CPU" value={metrics?.cpu ?? null} />
          <MetricBar label="MEM" value={metrics?.mem ?? null} />
        </div>
      ) : null}

      {monitor.current_message ? (
        <p className="mt-3 line-clamp-2 text-xs text-text-muted leading-relaxed">
          {monitor.current_message}
        </p>
      ) : null}

      {since ? (
        <p className="mt-2 text-[11px] text-text-subtle">since {since}</p>
      ) : null}
    </div>
  );
}
