import { useEffect } from "react";
import { wsUrl } from "@/api/client";
import { useExecutionStore } from "@/store/executionStore";
import type { ExecutionEvent } from "@/types/execution";

/** Opens (and, on drop, transparently reconnects) a WebSocket for the given
 * run and streams every event into the execution store. Pass `null` to
 * stay disconnected. */
export function useExecutionSocket(runId: string | null) {
  const applyEvent = useExecutionStore((s) => s.applyEvent);
  const setWsConnected = useExecutionStore((s) => s.setWsConnected);

  useEffect(() => {
    if (!runId) return;

    let socket: WebSocket | null = null;
    let closedByCleanup = false;
    let retryDelayMs = 1000;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      socket = new WebSocket(wsUrl(runId as string));

      socket.onopen = () => {
        setWsConnected(true);
        retryDelayMs = 1000;
      };

      socket.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as ExecutionEvent;
          applyEvent(data);
        } catch (err) {
          console.error("Unparseable execution event", err);
        }
      };

      socket.onclose = () => {
        setWsConnected(false);
        if (!closedByCleanup) {
          retryTimer = setTimeout(connect, retryDelayMs);
          retryDelayMs = Math.min(retryDelayMs * 1.6, 8000);
        }
      };

      socket.onerror = () => {
        socket?.close();
      };
    }

    connect();

    return () => {
      closedByCleanup = true;
      if (retryTimer) clearTimeout(retryTimer);
      socket?.close();
      setWsConnected(false);
    };
  }, [runId, applyEvent, setWsConnected]);
}
