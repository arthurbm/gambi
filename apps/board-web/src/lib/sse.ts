import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

export type BoardConnectionStatus = "connected" | "reconnecting" | "offline";

let connectionStatus: BoardConnectionStatus = "offline";
const statusListeners = new Set<() => void>();
export interface HarnessStreamItem {
  key: string;
  squadId: string;
  participantId: string;
  sessionId: string;
  event: {
    type: string;
    text?: string;
    toolName?: string;
    path?: string;
    files?: Array<{ path: string }>;
    status?: string;
    message?: string;
  };
}
const EMPTY_HARNESS_EVENTS: HarnessStreamItem[] = [];
const harnessEvents = new Map<string, HarnessStreamItem[]>();
const harnessListeners = new Set<() => void>();

function setConnectionStatus(next: BoardConnectionStatus) {
  if (connectionStatus === next) {
    return;
  }
  connectionStatus = next;
  for (const listener of statusListeners) {
    listener();
  }
}

export function useBoardConnectionStatus() {
  return useSyncExternalStore(
    (listener) => {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    () => connectionStatus,
    () => "offline" as BoardConnectionStatus
  );
}

export function useHarnessStream(squadId: string) {
  return useSyncExternalStore(
    (listener) => {
      harnessListeners.add(listener);
      return () => harnessListeners.delete(listener);
    },
    () => harnessEvents.get(squadId) ?? EMPTY_HARNESS_EVENTS,
    () => [] as HarnessStreamItem[]
  );
}

export function subscribeToBoard(queryClient: QueryClient) {
  const source = new EventSource("/events");
  let offlineTimer: ReturnType<typeof setTimeout> | undefined;
  const invalidate = () =>
    queryClient.invalidateQueries({ refetchType: "all" });
  const clearOfflineTimer = () => {
    if (offlineTimer) {
      clearTimeout(offlineTimer);
      offlineTimer = undefined;
    }
  };

  source.addEventListener("open", () => {
    clearOfflineTimer();
    setConnectionStatus("connected");
  });
  source.addEventListener("error", () => {
    setConnectionStatus("reconnecting");
    clearOfflineTimer();
    offlineTimer = setTimeout(() => setConnectionStatus("offline"), 5000);
  });
  source.addEventListener("board.snapshot", invalidate);
  source.addEventListener("board.changed", invalidate);
  source.addEventListener("harness.stream", (rawEvent) => {
    try {
      const event = JSON.parse((rawEvent as MessageEvent).data) as Omit<
        HarnessStreamItem,
        "key"
      >;
      const current = harnessEvents.get(event.squadId) ?? EMPTY_HARNESS_EVENTS;
      harnessEvents.set(event.squadId, [
        ...current.slice(-199),
        { ...event, key: crypto.randomUUID() },
      ]);
      for (const listener of harnessListeners) {
        listener();
      }
    } catch {
      // A later event remains usable when one transient frame is malformed.
    }
  });
  setConnectionStatus("reconnecting");

  return () => {
    clearOfflineTimer();
    source.close();
    setConnectionStatus("offline");
  };
}
