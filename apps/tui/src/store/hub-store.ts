import { createHub, type HostedHub } from "gambi-sdk/hub";
import { create } from "zustand";

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
// Settles when the start under way has ended, whichever way.
let starting: Promise<void> | null = null;

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

    // The hub's log lines go nowhere: the terminal belongs to the TUI.
    const thisStart = createHub(config).then(
      (hub) => {
        hubInstance = hub;
        set({
          status: "running",
          url: hub.url,
          mdnsName: hub.mdnsName ?? null,
          error: null,
        });
      },
      (err) => {
        set({ status: "error", error: messageOf(err, "Failed to start hub") });
      }
    );
    // Kept before `starting` is published: whoever reacts to that status by
    // stopping the hub must find the start to wait for.
    starting = thisStart;
    set({ status: "starting", error: null, ...config });

    await thisStart;
    if (starting === thisStart) {
      starting = null;
    }
  },

  stop: async () => {
    // A hub that is still starting is stopped once it has started: stopping
    // before that would return with nothing to stop and leave it listening.
    await starting;
    const hub = hubInstance;
    if (!hub) {
      return;
    }
    hubInstance = null;

    set({ status: "stopping" });

    try {
      await hub.close();
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
