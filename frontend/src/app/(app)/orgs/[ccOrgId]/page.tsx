"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { CloudArrowDown, Cube, Globe, Sparkle } from "@phosphor-icons/react";
import { api, ApiError } from "@/services/api";
import type {
  MetricSnapshot,
  Monitor,
  MonitorState,
  WsFrame,
} from "@/services/types";
import { MachineUnit } from "@/components/forge/MachineUnit";
import { Sector } from "@/components/forge/Sector";
import { WSPill, publishWsState } from "@/components/forge/WSPill";
import { useOrgWebSocket } from "@/hooks/useOrgWebSocket";
import { PageHeader } from "@/components/layout/PageHeader";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { MachineCard } from "@/components/forge/MachineCard";

const SECTIONS: {
  key: "cc_application" | "cc_addon" | "synthetic";
  label: string;
  icon: React.ReactNode;
}[] = [
  {
    key: "cc_application",
    label: "Sector A · Applications",
    icon: <Globe weight="duotone" size={14} />,
  },
  {
    key: "cc_addon",
    label: "Sector B · Add-ons",
    icon: <CloudArrowDown weight="duotone" size={14} />,
  },
  {
    key: "synthetic",
    label: "Sector S · Synthetic",
    icon: <Sparkle weight="duotone" size={14} />,
  },
];

export default function ControlRoom() {
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

  const totalsByState = useMemo(() => {
    const t = { ok: 0, warning: 0, critical: 0, unknown: 0 };
    for (const m of monitors) t[m.current_state]++;
    return t;
  }, [monitors]);

  return (
    <>
      <PageHeader
        title={
          <span>
            <span className="text-[var(--forge-text)]">{ccOrgId}</span>{" "}
            <span className="text-[var(--forge-text-dim)]">·</span>{" "}
            <span className="font-serif italic text-[var(--forge-text-accent)]">
              Control Room
            </span>
          </span>
        }
        description={`${monitors.length} machine${monitors.length === 1 ? "" : "s"} on the floor. Frames stream live over the bus.`}
        breadcrumbs={[
          { label: "Workshops", href: "/orgs" },
          { label: ccOrgId },
        ]}
        badge={<WSPill state={wsState} />}
      />

      {/* Live floor totals */}
      {!loading && monitors.length > 0 ? (
        <div className="mb-6 flex flex-wrap gap-2 text-[11px] font-mono">
          <FloorChip label="OK" count={totalsByState.ok} dotColor="var(--led-ok)" />
          <FloorChip
            label="WARN"
            count={totalsByState.warning}
            dotColor="var(--led-warn)"
          />
          <FloorChip
            label="CRIT"
            count={totalsByState.critical}
            dotColor="var(--led-crit)"
          />
          <FloorChip
            label="UNKNOWN"
            count={totalsByState.unknown}
            dotColor="var(--led-dim)"
          />
        </div>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : error ? (
        <MachineCard variant="action" className="p-4">
          <p className="text-[12px] text-[var(--forge-text)]">
            {error}. If the workshop is missing a webhook hook-up, click{" "}
            <span className="italic text-[var(--forge-text-accent)]">
              Setup webhook
            </span>{" "}
            from the Workshops page.
          </p>
        </MachineCard>
      ) : monitors.length === 0 ? (
        <EmptyState
          icon={<Cube weight="duotone" size={28} />}
          title="No machines yet"
          description="Apps and addons appear here once they're synced from Clever Cloud or when CC fires its first webhook."
        />
      ) : (
        <div className="space-y-8">
          {SECTIONS.map(({ key, label, icon }) => {
            const list = grouped[key] ?? [];
            if (list.length === 0) return null;
            return (
              <Sector
                key={key}
                label={label}
                icon={icon}
                count={list.length}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((m) => (
                    <MachineUnit
                      key={m.id}
                      monitor={m}
                      metrics={metrics[m.id]}
                      hydrated={hydrated}
                    />
                  ))}
                </div>
              </Sector>
            );
          })}
        </div>
      )}
    </>
  );
}

function FloorChip({
  label,
  count,
  dotColor,
}: {
  label: string;
  count: number;
  dotColor: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-[3px] border border-[var(--forge-rim-dim)] bg-[var(--forge-floor-deep)]/70 px-2 py-1 ${
        count === 0 ? "opacity-50" : ""
      }`}
    >
      <span
        className="inline-block h-2 w-2 rounded-full"
        style={{
          background: dotColor,
          boxShadow: count > 0 ? `0 0 6px ${dotColor}` : "none",
        }}
      />
      <span className="uppercase tracking-[0.5px] text-[var(--forge-text-muted)]">
        {label}
      </span>
      <span className="tabular-nums text-[var(--forge-text)]">{count}</span>
    </span>
  );
}
