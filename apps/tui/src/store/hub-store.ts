import { createHub } from "@gambiarra/core/hub";
import { create } from "zustand";

interface HubServer {
  server: { stop: () => void };
  url: string;
  mdnsName?: string;
  close: () => void;
}

export type HubStatus =
  | "stopped"
  | "starting"
  | "running"
  | "stopping"
  | "error";

export interface HubOptions {
  port?: number;
  hostname?: string;
  mdns?: boolean;
}

interface HubState {
  status: HubStatus;
  url: string | null;
  port: number;
  hostname: string;
  mdns: boolean;
  mdnsName: string | null;
  error: string | null;
  start: (options?: HubOptions) => void;
  stop: () => void;
  setConfig: (options: HubOptions) => void;
}

// Global hub reference - persists across React re-renders and navigation
let hubInstance: HubServer | null = null;

export const useHubStore = create<HubState>((set, get) => ({
  status: "stopped",
  url: null,
  port: 3000,
  hostname: "0.0.0.0",
  mdns: false,
  mdnsName: null,
  error: null,

  setConfig: (options) =>
    set({
      port: options.port ?? get().port,
      hostname: options.hostname ?? get().hostname,
      mdns: options.mdns ?? get().mdns,
    }),

  start: (options) => {
    if (hubInstance) {
      set({ error: "Hub already running" });
      return;
    }

    const config = {
      port: options?.port ?? get().port,
      hostname: options?.hostname ?? get().hostname,
      mdns: options?.mdns ?? get().mdns,
    };

    set({ status: "starting", error: null, ...config });

    try {
      const hub = createHub(config);
      hubInstance = hub;
      set({
        status: "running",
        url: hub.url,
        mdnsName: hub.mdnsName ?? null,
        error: null,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to start hub";
      set({ status: "error", error: message });
    }
  },

  stop: () => {
    if (!hubInstance) {
      return;
    }

    set({ status: "stopping" });

    try {
      hubInstance.close();
      hubInstance = null;
      set({
        status: "stopped",
        url: null,
        mdnsName: null,
        error: null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to stop hub";
      set({ status: "error", error: message });
    }
  },
}));

// Utility to check if hub is active (for external use)
export function isHubRunning(): boolean {
  return hubInstance !== null;
}

// Cleanup function for app shutdown
export function shutdownHub(): void {
  if (hubInstance) {
    hubInstance.close();
    hubInstance = null;
  }
}
