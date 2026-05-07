"use client";

import { useEffect, useRef } from "react";
import type { WsFrame } from "@/services/types";

/**
 * Open a WebSocket to /ws?org={ccOrgId} and call `onFrame` for each frame.
 * Auto-reconnects with exponential backoff (max 30s). Closes cleanly on unmount.
 */
export function useOrgWebSocket(
  ccOrgId: string,
  onFrame: (frame: WsFrame) => void,
) {
  // Stash the latest callback so reconnects don't cancel/restart on every render.
  const onFrameRef = useRef(onFrame);
  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    let closed = false;
    let attempt = 0;
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (closed) return;
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${window.location.host}/ws?org=${encodeURIComponent(ccOrgId)}`;
      ws = new WebSocket(url);

      ws.onopen = () => {
        attempt = 0;
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
      ws?.close();
    };
  }, [ccOrgId]);
}
