import type { QueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

export type BoardConnectionStatus = "connected" | "reconnecting" | "offline";

let connectionStatus: BoardConnectionStatus = "offline";
const statusListeners = new Set<() => void>();

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
  setConnectionStatus("reconnecting");

  return () => {
    clearOfflineTimer();
    source.close();
    setConnectionStatus("offline");
  };
}
