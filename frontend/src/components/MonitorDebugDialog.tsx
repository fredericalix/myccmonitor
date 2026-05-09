"use client";

import { useEffect, useState } from "react";
import {
  ArrowsCounterClockwise,
  CheckCircle,
  Database,
  WarningCircle,
} from "@phosphor-icons/react";
import { api } from "@/services/api";
import type { MonitorDebugResponse } from "@/services/types";
import { Dialog } from "@/components/ui/Dialog";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/cn";

interface MonitorDebugDialogProps {
  ccOrgId: string;
  monitorId: string;
  monitorName: string;
  open: boolean;
  onClose: () => void;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function formatNumber(v: number | null | undefined, suffix = ""): string {
  if (v === null || v === undefined) return "n/a";
  return `${v.toFixed(2)}${suffix}`;
}

export function MonitorDebugDialog({
  ccOrgId,
  monitorId,
  monitorName,
  open,
  onClose,
}: MonitorDebugDialogProps) {
  const [data, setData] = useState<MonitorDebugResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reqTick, setReqTick] = useState(0);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .monitorDebug(ccOrgId, monitorId)
      .then((r) => {
        if (!cancelled) setData(r);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, ccOrgId, monitorId, reqTick]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <span className="inline-flex items-center gap-2">
          <Database weight="duotone" size={20} className="text-accent-strong" />
          Debug · {monitorName}
        </span>
      }
      description="What CC's Warp10 actually has for this monitor."
      footer={
        <>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setReqTick((n) => n + 1)}
            disabled={loading}
          >
            <ArrowsCounterClockwise weight="bold" size={14} />
            Refresh
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      {loading && !data ? (
        <div className="space-y-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-32" />
          <Skeleton className="h-24" />
        </div>
      ) : error ? (
        <Card className="p-4 border-critical/30 bg-critical-soft text-sm text-critical">
          {error}
        </Card>
      ) : data ? (
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
          <Section title="Monitor">
            <KV label="ID" value={<code className="text-[11px]">{data.monitor.id}</code>} />
            <KV label="Kind" value={data.monitor.kind} />
            <KV
              label="State"
              value={
                <Badge variant={stateVariant(data.monitor.current_state)}>
                  {data.monitor.current_state}
                </Badge>
              }
            />
            <KV
              label="cc_resource_id"
              value={
                <code className="text-[11px]">
                  {data.monitor.cc_resource_id ?? "—"}
                </code>
              }
            />
            <KV
              label="cc_metrics_id"
              value={
                <code className="text-[11px]">
                  {data.cc_metrics_id ?? "—"}
                </code>
              }
            />
            <KV label="Last poll" value={formatTimestamp(data.last_poll_at)} />
            {data.note ? (
              <p className="mt-2 rounded-lg bg-warning-soft p-2 text-[12px] text-warning">
                {data.note}
              </p>
            ) : null}
          </Section>

          <Section title="Warp10 metric availability">
            <p className="mb-2 text-[12px] text-text-muted">
              The 5 classes the poller queries on every cycle. A red chip means
              CC is not emitting that class for this app — the corresponding
              bar will stay <em>n/a</em> (it&apos;s a CC-side limitation, not a
              myccmonitor bug).
            </p>
            <div className="flex flex-wrap gap-1.5">
              {data.expected_classes.map((c) => {
                const present = !data.missing_classes.includes(c);
                return (
                  <span
                    key={c}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-mono",
                      present
                        ? "border-ok/40 bg-ok-soft text-ok"
                        : "border-critical/40 bg-critical-soft text-critical",
                    )}
                  >
                    {present ? (
                      <CheckCircle weight="bold" size={11} />
                    ) : (
                      <WarningCircle weight="bold" size={11} />
                    )}
                    {c}
                  </span>
                );
              })}
            </div>
          </Section>

          <Section
            title={`All Warp10 classes (${data.warp10_classes.length})`}
            description="Every GTS class CC has data for this app over the last hour, including system metrics not consumed by the poller."
          >
            {data.warp10_classes.length === 0 ? (
              <p className="text-[12px] text-text-subtle">
                Warp10 has no data at all for this app over the last hour.
                Either the app is fully stopped, or CC&apos;s metrics agent
                isn&apos;t running on this runtime.
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {data.warp10_classes.map((c) => (
                  <code
                    key={c}
                    className="rounded-md border border-border bg-bg/40 px-2 py-0.5 text-[11px]"
                  >
                    {c}
                  </code>
                ))}
              </div>
            )}
          </Section>

          <Section title="Latest sample">
            {data.latest_sample ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12px]">
                <KV
                  label="ts"
                  value={formatTimestamp(data.latest_sample.ts)}
                />
                <KV
                  label="cpu"
                  value={formatNumber(data.latest_sample.cpu, " %")}
                />
                <KV
                  label="mem"
                  value={formatNumber(data.latest_sample.mem, " %")}
                />
                <KV
                  label="disk"
                  value={formatNumber(data.latest_sample.disk, " %")}
                />
                <KV
                  label="net_in"
                  value={formatNumber(data.latest_sample.net_in, " B/s")}
                />
                <KV
                  label="net_out"
                  value={formatNumber(data.latest_sample.net_out, " B/s")}
                />
              </div>
            ) : (
              <p className="text-[12px] text-text-subtle">
                No sample written to metric_samples yet.
              </p>
            )}
          </Section>
        </div>
      ) : null}
    </Dialog>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-muted">
        {title}
      </h3>
      {description ? (
        <p className="mb-2 text-[11px] text-text-subtle">{description}</p>
      ) : null}
      {children}
    </Card>
  );
}

function KV({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2 text-[12px]">
      <span className="w-32 shrink-0 text-text-muted">{label}</span>
      <span className="min-w-0 break-all">{value}</span>
    </div>
  );
}

function stateVariant(
  state: string,
): "ok" | "warning" | "critical" | "unknown" {
  if (state === "ok" || state === "warning" || state === "critical")
    return state;
  return "unknown";
}
