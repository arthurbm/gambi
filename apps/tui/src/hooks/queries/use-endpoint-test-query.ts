import { probeEndpoint } from "@gambi/core/endpoint";
import type {
  ParticipantAuthHeaders,
  ParticipantInfo,
} from "@gambi/core/types";
import { useQuery } from "@tanstack/react-query";

interface EndpointTestResult {
  capabilities: ParticipantInfo["capabilities"];
  success: boolean;
  models: string[];
}

async function testEndpoint(endpoint: string): Promise<EndpointTestResult> {
  const probe = await probeEndpoint(endpoint);
  return {
    success: probe.success,
    models: probe.models,
    capabilities: probe.capabilities,
  };
}

async function testAuthenticatedEndpoint(
  endpoint: string,
  authHeaders: ParticipantAuthHeaders
): Promise<EndpointTestResult> {
  const probe = await probeEndpoint(endpoint, { authHeaders });
  return {
    success: probe.success,
    models: probe.models,
    capabilities: probe.capabilities,
  };
}

function hashAuthHeaders(authHeaders: ParticipantAuthHeaders): string {
  const serialized = Object.entries(authHeaders)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => `${name}:${value}`)
    .join("|");

  let hash = 0;
  for (const char of serialized) {
    hash = (hash * 31 + char.charCodeAt(0)) % 4_294_967_296;
  }

  return hash.toString(16);
}

export const endpointKeys = {
  all: ["endpoint"] as const,
  test: (endpoint: string, authHeadersHash = "") =>
    [...endpointKeys.all, "test", endpoint, authHeadersHash] as const,
};

/**
 * Query hook to test an LLM endpoint and discover available models.
 * Only runs when endpoint is a valid URL starting with http.
 */
export function useEndpointTestQuery(
  endpoint: string,
  authHeaders: ParticipantAuthHeaders = {},
  enabled = true
) {
  const isValidUrl = endpoint.trim() !== "" && endpoint.startsWith("http");
  const authHeadersHash = hashAuthHeaders(authHeaders);
  const hasAuthHeaders = Object.keys(authHeaders).length > 0;

  return useQuery({
    queryKey: endpointKeys.test(endpoint, authHeadersHash),
    queryFn: () =>
      hasAuthHeaders
        ? testAuthenticatedEndpoint(endpoint, authHeaders)
        : testEndpoint(endpoint),
    enabled: isValidUrl && enabled,
    staleTime: 30_000, // Cache for 30 seconds
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export type { EndpointTestResult };
