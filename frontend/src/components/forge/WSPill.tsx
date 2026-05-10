"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { WsConnectionState } from "@/hooks/useOrgWebSocket";
import { LedIndicator } from "./LedIndicator";

const CFG: Record<
  WsConnectionState,
  { label: string; severity: "ok" | "warning" | "critical" | "unknown" }
> = {
  connecting: { label: "Connecting", severity: "warning" },
  connected: { label: "Bus live", severity: "ok" },
  reconnecting: { label: "Reconnecting", severity: "warning" },
  offline: { label: "Bus offline", severity: "critical" },
};

const STORAGE_BUS_KEY = "myccmonitor.ws.global";

/**
 * Inline pill showing the WS bus state. With `state` prop renders that
 * directly; otherwise polls a sessionStorage-backed global (same pattern as
 * the legacy WebSocketIndicator) so per-org pages can publish their state
 * up to the shell.
 */
export function WSPill({
  state,
  compact = false,
  className,
}: {
  state?: WsConnectionState;
  compact?: boolean;
  className?: string;
}) {
  const [globalState, setGlobalState] = useState<WsConnectionState | null>(
    null,
  );

  useEffect(() => {
    if (state) return;
    const update = () => {
      const v = window.sessionStorage.getItem(
        STORAGE_BUS_KEY,
      ) as WsConnectionState | null;
      setGlobalState(
        v && ["connecting", "connected", "reconnecting", "offline"].includes(v)
          ? v
          : null,
      );
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [state]);

  const effective = state ?? globalState;
  if (!effective) return null;
  const cfg = CFG[effective];

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-[4px] border border-[var(--forge-rim-dim)] bg-[var(--forge-floor-deep)] px-2.5 py-1 text-[11px] uppercase tracking-[0.5px] text-[var(--forge-text-accent)]",
        compact && "px-1.5 py-0.5",
        className,
      )}
      title={`WebSocket: ${cfg.label}`}
    >
      <LedIndicator state={cfg.severity} size="xs" />
      {!compact && <span>{cfg.label}</span>}
    </div>
  );
}

export function publishWsState(state: WsConnectionState) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_BUS_KEY, state);
  } catch {
    // ignore
  }
}
