import { create } from "zustand";
import { type HostedHub, hostHub } from "../hosting/hub";

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
  /** Resolves when the hub is running, or when starting it failed. */
  start: (options?: HubOptions) => Promise<void>;
  /** Resolves when the hub has stopped. */
  stop: () => Promise<void>;
  setConfig: (options: HubOptions) => void;
}

// The hub this process hosts - persists across React re-renders and navigation
let hubInstance: HostedHub | null = null;

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

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

  start: async (options) => {
    const { status } = get();
    if (hubInstance || status === "starting" || status === "stopping") {
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
      const hub = await hostHub(config);
      hubInstance = hub;
      set({
        status: "running",
        url: hub.url,
        mdnsName: hub.mdnsName ?? null,
        error: null,
      });
    } catch (err) {
      set({ status: "error", error: messageOf(err, "Failed to start hub") });
    }
  },

  stop: async () => {
    const hub = hubInstance;
    if (!hub) {
      return;
    }
    hubInstance = null;

    set({ status: "stopping" });

    try {
      await hub.stop();
      set({
        status: "stopped",
        url: null,
        mdnsName: null,
        error: null,
      });
    } catch (err) {
      set({ status: "error", error: messageOf(err, "Failed to stop hub") });
    }
  },
}));

// Utility to check if hub is active (for external use)
export function isHubRunning(): boolean {
  return hubInstance !== null;
}

// Cleanup function for app shutdown
export function shutdownHub(): Promise<void> {
  return useHubStore.getState().stop();
}
