"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Bug } from "@phosphor-icons/react";
import type { MetricSnapshot, Monitor } from "@/services/types";
import { MachineCard, MachineLabel } from "./MachineCard";
import { MachineGauge, type GaugeState } from "./MachineGauge";
import { LedIndicator } from "./LedIndicator";
import { MonitorDebugDialog } from "@/components/MonitorDebugDialog";
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

export function MachineUnit({
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

  const cardRef = useRef<HTMLDivElement | null>(null);

  // Spark on fresh metrics frame.
  const lastTsRef = useRef<string | null>(null);
  useEffect(() => {
    if (!metrics?.ts) return;
    if (lastTsRef.current === metrics.ts) return;
    lastTsRef.current = metrics.ts;
    const node = cardRef.current;
    if (!node) return;
    node.classList.remove("animate-forge-spark");
    void node.offsetWidth;
    node.classList.add("animate-forge-spark");
  }, [metrics?.ts]);

  // Spark on state change.
  const lastStateRef = useRef<string | null>(monitor.current_state);
  useEffect(() => {
    if (lastStateRef.current === monitor.current_state) return;
    lastStateRef.current = monitor.current_state;
    const node = cardRef.current;
    if (!node) return;
    node.classList.remove("animate-forge-spark");
    void node.offsetWidth;
    node.classList.add("animate-forge-spark");
  }, [monitor.current_state]);

  const [loadExpired, setLoadExpired] = useState(false);
  useEffect(() => {
    if (metrics || !showMetrics || !hydrated) return;
    const t = setTimeout(() => setLoadExpired(true), LOADING_FALLBACK_MS);
    return () => clearTimeout(t);
  }, [metrics, hydrated, showMetrics]);

  const globalState: GaugeState = !metrics
    ? hydrated && loadExpired
      ? "no-data"
      : "loading"
    : "data";

  const perMetric = (v: number | null | undefined): GaugeState =>
    metrics === undefined
      ? globalState
      : v === null || v === undefined
        ? "unavailable"
        : "data";

  const [debugOpen, setDebugOpen] = useState(false);

  return (
    <MachineCard
      ref={cardRef}
      variant={monitor.current_state === "critical" ? "action" : "default"}
      className={cn(
        "relative p-3 group transition-[transform,filter] duration-150",
        "hover:-translate-y-0.5 hover:brightness-110",
      )}
    >
      <MachineLabel>
        <span className="flex items-center gap-2 normal-case tracking-normal">
          <LedIndicator state={monitor.current_state} size="md" />
          <span className="font-serif text-[15px] leading-tight text-[var(--forge-text)] truncate">
            {monitor.display_name}
          </span>
        </span>
        <span className="rounded-[3px] border border-[var(--forge-rim-dim)] bg-[var(--forge-floor-deep)]/70 px-1.5 py-0.5 text-[9px] tracking-[0.5px] text-[var(--forge-text-muted)]">
          {monitor.kind === "cc_application"
            ? "APP"
            : monitor.kind === "cc_addon"
              ? "ADDON"
              : "SYNTH"}
        </span>
      </MachineLabel>

      {showMetrics ? (
        <div className="space-y-1.5">
          <MachineGauge label="CPU" value={metrics?.cpu ?? null} state={perMetric(metrics?.cpu)} />
          <MachineGauge label="MEM" value={metrics?.mem ?? null} state={perMetric(metrics?.mem)} />
          <MachineGauge
            label="DISK"
            value={metrics?.disk ?? null}
            state={perMetric(metrics?.disk)}
          />
          <NetLine
            netIn={metrics?.net_in ?? null}
            netOut={metrics?.net_out ?? null}
            state={
              metrics === undefined
                ? globalState
                : metrics.net_in === null && metrics.net_out === null
                  ? "unavailable"
                  : "data"
            }
          />
        </div>
      ) : null}

      {monitor.current_message ? (
        <p className="mt-2.5 line-clamp-2 text-[11px] leading-snug text-[var(--forge-text-muted)]">
          {monitor.current_message}
        </p>
      ) : null}

      {since ? (
        <p className="mt-2 text-[10px] text-[var(--forge-text-dim)]">since {since}</p>
      ) : null}

      {monitor.cc_org_id && monitor.kind !== "synthetic" ? (
        <button
          type="button"
          onClick={() => setDebugOpen(true)}
          aria-label="Diagnose monitor"
          className="absolute bottom-1.5 right-1.5 rounded-[3px] border border-transparent p-1 text-[var(--forge-text-dim)] opacity-0 transition-opacity hover:border-[var(--forge-rim-dim)] hover:bg-[var(--forge-floor-deep)] hover:text-[var(--forge-text-accent)] group-hover:opacity-100"
        >
          <Bug weight="duotone" size={13} />
        </button>
      ) : null}

      {monitor.cc_org_id ? (
        <MonitorDebugDialog
          ccOrgId={monitor.cc_org_id}
          monitorId={monitor.id}
          monitorName={monitor.display_name}
          open={debugOpen}
          onClose={() => setDebugOpen(false)}
        />
      ) : null}
    </MachineCard>
  );
}

function NetLine({
  netIn,
  netOut,
  state,
}: {
  netIn: number | null;
  netOut: number | null;
  state: GaugeState;
}) {
  if (state === "loading") {
    return (
      <div className="flex items-center gap-2 pt-1">
        <span className="w-9 font-mono text-[10px] uppercase tracking-[0.6px] text-[var(--forge-text-muted)]">
          NET
        </span>
        <div className="h-1.5 flex-1 overflow-hidden rounded-sm border border-[var(--forge-rim-dim)] animate-forge-shimmer" />
      </div>
    );
  }
  if (state === "unavailable") {
    return (
      <div className="flex items-center gap-2 pt-1">
        <span className="w-9 font-mono text-[10px] uppercase tracking-[0.6px] text-[var(--forge-text-muted)]">
          NET
        </span>
        <span className="font-mono text-[10px] italic text-[var(--forge-text-dim)]">
          n/a
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 pt-1 font-mono text-[10px] tabular-nums">
      <span className="w-9 uppercase tracking-[0.6px] text-[var(--forge-text-muted)]">
        NET
      </span>
      <span className="inline-flex items-center gap-1 text-[var(--forge-text-accent)]">
        <ArrowDown size={10} weight="bold" />
        {formatBytesPerSec(netIn)}
      </span>
      <span className="text-[var(--forge-text-dim)]">·</span>
      <span className="inline-flex items-center gap-1 text-[var(--copper-glow)]">
        <ArrowUp size={10} weight="bold" />
        {formatBytesPerSec(netOut)}
      </span>
    </div>
  );
}
