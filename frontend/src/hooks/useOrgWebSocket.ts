"use client";

import { useEffect, useRef, useState } from "react";
import type { WsFrame } from "@/services/types";

export type WsConnectionState = "connecting" | "connected" | "reconnecting" | "offline";

/**
 * Open a WebSocket to /ws?org={ccOrgId} and call `onFrame` for each frame.
 * Auto-reconnects with exponential backoff (max 30s). Closes cleanly on unmount.
 * Returns the live connection state for indicators.
 */
export function useOrgWebSocket(
  ccOrgId: string,
  onFrame: (frame: WsFrame) => void,
): WsConnectionState {
  const onFrameRef = useRef(onFrame);
  const [state, setState] = useState<WsConnectionState>("connecting");

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    let closed = false;
    let attempt = 0;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let offlineTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${window.location.host}/ws?org=${encodeURIComponent(ccOrgId)}`;
      setState((prev) => (prev === "connected" ? "reconnecting" : prev));
      ws = new WebSocket(url);

      ws.onopen = () => {
        attempt = 0;
        setState("connected");
        if (offlineTimer) {
          clearTimeout(offlineTimer);
          offlineTimer = null;
        }
      };
      ws.onmessage = (ev) => {
        try {
          const frame = JSON.parse(ev.data) as WsFrame;
          onFrameRef.current(frame);
        } catch (err) {
          console.error("bad WS frame", err);
        }
      };
      ws.onclose = () => {
        if (closed) return;
        attempt += 1;
        setState("reconnecting");
        // Promote to "offline" if reconnects keep failing for >15s.
        if (!offlineTimer) {
          offlineTimer = setTimeout(() => setState("offline"), 15_000);
        }
        const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempt - 1, 5));
        reconnectTimer = setTimeout(connect, delay);
      };
      ws.onerror = () => {
        // onclose will fire; let it handle reconnect.
      };
    };
    connect();

    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (offlineTimer) clearTimeout(offlineTimer);
      ws?.close();
    };
  }, [ccOrgId]);

  return state;
}
