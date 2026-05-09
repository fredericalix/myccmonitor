"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { CloudArrowDown, Globe, Sparkle } from "@phosphor-icons/react";
import { api, ApiError } from "@/services/api";
import type {
  MetricSnapshot,
  Monitor,
  MonitorState,
  WsFrame,
} from "@/services/types";
import { MonitorCard } from "@/components/MonitorCard";
import { useOrgWebSocket } from "@/hooks/useOrgWebSocket";
import { PageHeader } from "@/components/layout/PageHeader";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import {
  WebSocketIndicator,
  publishWsState,
} from "@/components/layout/WebSocketIndicator";

const SECTIONS: {
  key: "cc_application" | "cc_addon" | "synthetic";
  label: string;
  icon: React.ReactNode;
}[] = [
  { key: "cc_application", label: "Applications", icon: <Globe weight="duotone" size={16} /> },
  { key: "cc_addon", label: "Add-ons", icon: <CloudArrowDown weight="duotone" size={16} /> },
  { key: "synthetic", label: "Synthetic monitors", icon: <Sparkle weight="duotone" size={16} /> },
];

export default function OrgDashboard() {
  const params = useParams<{ ccOrgId: string }>();
  const ccOrgId = decodeURIComponent(params.ccOrgId);

  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [metrics, setMetrics] = useState<Record<string, MetricSnapshot>>({});
  const [loading, setLoading] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.listMonitors(ccOrgId),
      // Snapshots are best-effort: if the endpoint 404s (older backend) or
      // fails for any other reason, we degrade to WS-only hydration.
      api.listSnapshots(ccOrgId).catch((err) => {
        console.warn("listSnapshots failed; falling back to WS hydration", err);
        return [];
      }),
    ])
      .then(([rows, snaps]) => {
        if (!active) return;
        setMonitors(rows);
        if (snaps.length > 0) {
          const seeded: Record<string, MetricSnapshot> = {};
          for (const s of snaps) {
            seeded[s.monitor_id] = {
              cpu: s.cpu,
              mem: s.mem,
              disk: s.disk,
              net_in: s.net_in,
              net_out: s.net_out,
              ts: s.ts,
            };
          }
          setMetrics(seeded);
        }
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
        if (!active) return;
        setLoading(false);
        setHydrated(true);
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
          disk: frame.disk,
          net_in: frame.net_in,
          net_out: frame.net_out,
          ts: frame.ts,
        },
      }));
    }
  }, []);

  const wsState = useOrgWebSocket(ccOrgId, onFrame);
  useEffect(() => {
    publishWsState(wsState);
  }, [wsState]);

  const grouped = useMemo(() => {
    const out: Record<string, Monitor[]> = {
      cc_application: [],
      cc_addon: [],
      synthetic: [],
    };
    for (const m of monitors) {
      out[m.kind]?.push(m);
    }
    return out;
  }, [monitors]);

  return (
    <>
      <PageHeader
        title={ccOrgId}
        description={`${monitors.length} monitor${monitors.length === 1 ? "" : "s"} in this organisation. State updates stream live over WebSocket.`}
        breadcrumbs={[
          { label: "Organisations", href: "/orgs" },
          { label: ccOrgId },
        ]}
        badge={<WebSocketIndicator state={wsState} />}
      />

      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : error ? (
        <Card className="p-5 border-critical/30 bg-critical-soft">
          <p className="text-sm text-critical">
            {error}. If the org is missing a webhook, click{" "}
            <span className="italic">Setup webhook</span> from the orgs list.
          </p>
        </Card>
      ) : monitors.length === 0 ? (
        <EmptyState
          icon={<Globe weight="duotone" size={28} />}
          title="No monitors yet"
          description="Apps and addons appear here once they're synced from Clever Cloud or when CC fires its first webhook."
        />
      ) : (
        <div className="space-y-10">
          {SECTIONS.map(({ key, label, icon }) => {
            const list = grouped[key] ?? [];
            if (list.length === 0) return null;
            return (
              <section key={key}>
                <h2 className="mb-4 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">
                  <span className="text-accent-strong">{icon}</span>
                  {label}
                  <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-bold text-accent-strong">
                    {list.length}
                  </span>
                </h2>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((m) => (
                    <MonitorCard
                      key={m.id}
                      monitor={m}
                      metrics={metrics[m.id]}
                      hydrated={hydrated}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}
