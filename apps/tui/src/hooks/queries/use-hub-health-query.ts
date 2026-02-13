import { useQuery } from "@tanstack/react-query";
import { useHubStore } from "../../store/hub-store";

const HEALTH_CHECK_INTERVAL = 30_000; // 30 seconds
const UNHEALTHY_THRESHOLD = 3;

interface HubHealthResult {
  healthy: boolean;
}

async function checkHubHealth(url: string): Promise<HubHealthResult> {
  const response = await fetch(`${url}/health`, {
    method: "GET",
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Health check failed: ${response.status}`);
  }

  return { healthy: true };
}

export const hubHealthKeys = {
  all: ["hubHealth"] as const,
  check: (url: string) => [...hubHealthKeys.all, "check", url] as const,
};

/**
 * Query hook that periodically checks the health of the local hub.
 * Only runs when hub status is "running".
 * Updates hub store to 'error' after consecutive failures.
 */
export function useHubHealthQuery() {
  const status = useHubStore((s) => s.status);
  const url = useHubStore((s) => s.url);

  const query = useQuery({
    queryKey: hubHealthKeys.check(url ?? ""),
    queryFn: () => {
      if (!url) {
        throw new Error("No hub URL");
      }
      return checkHubHealth(url);
    },
    enabled: status === "running" && url !== null,
    refetchInterval: HEALTH_CHECK_INTERVAL,
    retry: UNHEALTHY_THRESHOLD - 1, // Retry twice before failing (3 total attempts)
    retryDelay: 2000,
    staleTime: HEALTH_CHECK_INTERVAL - 5000, // Consider stale just before next refetch
  });

  // Update hub store on repeated failures
  if (query.failureCount >= UNHEALTHY_THRESHOLD) {
    useHubStore.setState({
      status: "error",
      error: `Hub health check failed ${UNHEALTHY_THRESHOLD} times`,
    });
  }

  return query;
}

export type { HubHealthResult };
