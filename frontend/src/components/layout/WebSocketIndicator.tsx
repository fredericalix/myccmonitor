"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { WsConnectionState } from "@/hooks/useOrgWebSocket";

const indicatorStates: Record<
  WsConnectionState,
  { label: string; dot: string; ring: string; ping: boolean }
> = {
  connecting: {
    label: "Connecting",
    dot: "bg-warning",
    ring: "bg-warning/40",
    ping: true,
  },
  connected: {
    label: "Live",
    dot: "bg-ok",
    ring: "bg-ok/30",
    ping: true,
  },
  reconnecting: {
    label: "Reconnecting",
    dot: "bg-warning",
    ring: "bg-warning/40",
    ping: true,
  },
  offline: {
    label: "Offline",
    dot: "bg-critical",
    ring: "bg-critical/40",
    ping: false,
  },
};

interface Props {
  state?: WsConnectionState;
  compact?: boolean;
}

const STORAGE_BUS_KEY = "myccmonitor.ws.global";

/**
 * The sidebar indicator. When a state prop is provided we render that;
 * otherwise we read a global state published via window storage events,
 * which lets a per-org page broadcast its own ws state to the shell.
 */
export function WebSocketIndicator({ state, compact = false }: Props) {
  const [globalState, setGlobalState] = useState<WsConnectionState | null>(null);

  useEffect(() => {
    if (state) return;
    const update = () => {
      const v = window.sessionStorage.getItem(STORAGE_BUS_KEY) as WsConnectionState | null;
      setGlobalState(v && ["connecting", "connected", "reconnecting", "offline"].includes(v) ? v : null);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [state]);

  const effective = state ?? globalState;
  if (!effective) return null;
  const cfg = indicatorStates[effective];

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full bg-surface px-2.5 py-1 text-[11px] font-medium text-text-muted border border-border",
        compact && "px-2 py-0.5",
      )}
      title={`WebSocket: ${cfg.label}`}
    >
      <span className="relative inline-flex h-2 w-2 items-center justify-center">
        <span className={cn("absolute inset-0 rounded-full", cfg.ring, cfg.ping && "animate-dot-ping")} />
        <span className={cn("relative h-2 w-2 rounded-full", cfg.dot)} />
      </span>
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
