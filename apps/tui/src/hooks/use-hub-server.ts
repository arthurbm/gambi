import { createHub } from "@gambiarra/core/hub";
import { useCallback, useEffect, useRef, useState } from "react";

interface HubServer {
  server: { stop: () => void };
  url: string;
  mdnsName?: string;
  close: () => void;
}

export interface UseHubServerOptions {
  port?: number;
  hostname?: string;
  mdns?: boolean;
}

export interface UseHubServerReturn {
  running: boolean;
  url: string | null;
  mdnsName: string | null;
  error: string | null;
  start: (options?: UseHubServerOptions) => void;
  stop: () => void;
}

export function useHubServer(): UseHubServerReturn {
  const [running, setRunning] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [mdnsName, setMdnsName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const hubRef = useRef<HubServer | null>(null);

  const start = useCallback((options: UseHubServerOptions = {}) => {
    if (hubRef.current) {
      setError("Hub already running");
      return;
    }

    try {
      const hub = createHub({
        port: options.port ?? 3000,
        hostname: options.hostname ?? "0.0.0.0",
        mdns: options.mdns ?? false,
      });

      hubRef.current = hub;
      setUrl(hub.url);
      setMdnsName(hub.mdnsName ?? null);
      setRunning(true);
      setError(null);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to start hub";
      setError(message);
    }
  }, []);

  const stop = useCallback(() => {
    if (hubRef.current) {
      hubRef.current.close();
      hubRef.current = null;
      setRunning(false);
      setUrl(null);
      setMdnsName(null);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (hubRef.current) {
        hubRef.current.close();
      }
    };
  }, []);

  return {
    running,
    url,
    mdnsName,
    error,
    start,
    stop,
  };
}
