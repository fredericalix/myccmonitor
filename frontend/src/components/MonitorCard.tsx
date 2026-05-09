"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "@phosphor-icons/react";
import type { MetricSnapshot, Monitor } from "@/services/types";
import { MetricBar, type MetricBarState } from "./MetricBar";
import { StateBadge } from "./StateBadge";
import { cn } from "@/lib/cn";

const LOADING_FALLBACK_MS = 90_000;

function formatRelative(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return date.toLocaleString();
}

function formatBytesPerSec(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const v = Math.max(0, value);
  if (v < 1024) return `${v.toFixed(0)} B/s`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB/s`;
  if (v < 1024 * 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB/s`;
  return `${(v / 1024 / 1024 / 1024).toFixed(2)} GB/s`;
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
  hydrated = true,
}: {
  monitor: Monitor;
  metrics?: MetricSnapshot;
  hydrated?: boolean;
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

  // Loading fallback: shimmer for at most ~90s after hydration completes, then
  // switch to "no-data". The countdown starts when `hydrated` becomes true —
  // we don't want to time out before the snapshot endpoint has had a chance
  // to respond.
  const [loadExpired, setLoadExpired] = useState(false);
  useEffect(() => {
    if (metrics || !showMetrics || !hydrated) return;
    const t = setTimeout(() => setLoadExpired(true), LOADING_FALLBACK_MS);
    return () => clearTimeout(t);
  }, [metrics, hydrated, showMetrics]);

  let barState: MetricBarState = "data";
  if (!metrics) {
    barState = hydrated && loadExpired ? "no-data" : "loading";
  }

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
          <MetricBar label="CPU" value={metrics?.cpu ?? null} state={barState} />
          <MetricBar label="MEM" value={metrics?.mem ?? null} state={barState} />
          <MetricBar label="DISK" value={metrics?.disk ?? null} state={barState} />
          <NetLine
            netIn={metrics?.net_in ?? null}
            netOut={metrics?.net_out ?? null}
            state={barState}
          />
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

function NetLine({
  netIn,
  netOut,
  state,
}: {
  netIn: number | null;
  netOut: number | null;
  state: MetricBarState;
}) {
  if (state === "loading") {
    return (
      <div className="flex items-center gap-2 text-[11px] text-text-subtle pt-1">
        <span className="w-9 font-mono uppercase tracking-wider">NET</span>
        <div className="h-2 flex-1 overflow-hidden rounded-full ring-1 ring-inset ring-border/60 animate-warm-shimmer" />
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 pt-1 text-[11px] text-text-muted">
      <span className="w-9 font-mono uppercase tracking-wider text-text-subtle">
        NET
      </span>
      <div className="flex flex-1 items-center gap-3 font-mono tabular-nums">
        <span className="inline-flex items-center gap-1">
          <ArrowDown size={11} weight="bold" className="text-accent-strong" />
          <span>{formatBytesPerSec(netIn)}</span>
        </span>
        <span className="text-text-subtle">·</span>
        <span className="inline-flex items-center gap-1">
          <ArrowUp size={11} weight="bold" className="text-warning" />
          <span>{formatBytesPerSec(netOut)}</span>
        </span>
      </div>
    </div>
  );
}
