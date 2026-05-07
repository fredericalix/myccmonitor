"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { api, ApiError } from "@/services/api";
import type {
  MetricSnapshot,
  Monitor,
  MonitorState,
  WsFrame,
} from "@/services/types";
import { MonitorCard } from "@/components/MonitorCard";
import { useOrgWebSocket } from "@/hooks/useOrgWebSocket";

export default function OrgDashboard() {
  const params = useParams<{ ccOrgId: string }>();
  const ccOrgId = decodeURIComponent(params.ccOrgId);

  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [metrics, setMetrics] = useState<Record<string, MetricSnapshot>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .listMonitors(ccOrgId)
      .then((rows) => {
        if (active) setMonitors(rows);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 401) {
          window.location.href = "/auth/login";
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ccOrgId]);

  const onFrame = useCallback((frame: WsFrame) => {
    if (frame.type === "monitor_state") {
      setMonitors((prev) =>
        prev.map((m) =>
          m.id === frame.monitor_id
            ? {
                ...m,
                current_state: frame.state as MonitorState,
                current_message: frame.message,
                current_state_since: frame.since,
              }
            : m,
        ),
      );
    } else if (frame.type === "metrics_snapshot") {
      setMetrics((prev) => ({
        ...prev,
        [frame.monitor_id]: {
          cpu: frame.cpu,
          mem: frame.mem,
          ts: frame.ts,
        },
      }));
    }
  }, []);

  useOrgWebSocket(ccOrgId, onFrame);

  const apps = useMemo(
    () => monitors.filter((m) => m.kind === "cc_application"),
    [monitors],
  );
  const addons = useMemo(
    () => monitors.filter((m) => m.kind === "cc_addon"),
    [monitors],
  );
  const synthetics = useMemo(
    () => monitors.filter((m) => m.kind === "synthetic"),
    [monitors],
  );

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            {ccOrgId}
          </h1>
          <p className="mt-1 font-mono text-xs text-slate-500">
            {monitors.length} monitor{monitors.length === 1 ? "" : "s"}
          </p>
        </div>
        <Link
          href="/orgs"
          className="text-sm text-slate-500 hover:text-slate-900"
        >
          ← Organisations
        </Link>
      </div>

      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {error && (
        <p className="mb-6 text-sm text-rose-600">
          {error}. If the org is missing a webhook, click{" "}
          <span className="italic">Setup webhook</span> from the orgs list.
        </p>
      )}

      {apps.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
            Applications
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {apps.map((m) => (
              <MonitorCard key={m.id} monitor={m} metrics={metrics[m.id]} />
            ))}
          </div>
        </section>
      )}

      {addons.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
            Add-ons
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {addons.map((m) => (
              <MonitorCard key={m.id} monitor={m} metrics={metrics[m.id]} />
            ))}
          </div>
        </section>
      )}

      {synthetics.length > 0 && (
        <section className="mb-10">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
            Synthetic monitors
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {synthetics.map((m) => (
              <MonitorCard key={m.id} monitor={m} />
            ))}
          </div>
        </section>
      )}

      {!loading && monitors.length === 0 && !error && (
        <p className="text-sm text-slate-500">
          No monitors yet. Synthetic monitors come in Phase 6 (workflow engine);
          CC apps and addons appear here automatically as they&apos;re discovered or
          when CC fires a webhook.
        </p>
      )}
    </main>
  );
}
