import { useHubStore } from "../store/hub-store";

export type { HubOptions as UseHubServerOptions } from "../store/hub-store";

type HubOptions = import("../store/hub-store").HubOptions;

export interface UseHubServerReturn {
  running: boolean;
  status: "stopped" | "starting" | "running" | "stopping" | "error";
  url: string | null;
  mdnsName: string | null;
  error: string | null;
  port: number;
  hostname: string;
  mdns: boolean;
  start: (options?: HubOptions) => void;
  stop: () => void;
  setConfig: (options: HubOptions) => void;
}

/**
 * Hook to manage the hub server lifecycle.
 * Now uses the global hub-store for persistence across navigation.
 */
export function useHubServer(): UseHubServerReturn {
  const status = useHubStore((s) => s.status);
  const url = useHubStore((s) => s.url);
  const mdnsName = useHubStore((s) => s.mdnsName);
  const error = useHubStore((s) => s.error);
  const port = useHubStore((s) => s.port);
  const hostname = useHubStore((s) => s.hostname);
  const mdns = useHubStore((s) => s.mdns);
  const start = useHubStore((s) => s.start);
  const stop = useHubStore((s) => s.stop);
  const setConfig = useHubStore((s) => s.setConfig);

  return {
    running: status === "running",
    status,
    url,
    mdnsName,
    error,
    port,
    hostname,
    mdns,
    start,
    stop,
    setConfig,
  };
}
