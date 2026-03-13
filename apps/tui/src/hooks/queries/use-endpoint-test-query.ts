import { probeEndpoint } from "@gambiarra/core/endpoint";
import type { ParticipantInfo } from "@gambiarra/core/types";
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

export const endpointKeys = {
  all: ["endpoint"] as const,
  test: (endpoint: string) => [...endpointKeys.all, "test", endpoint] as const,
};

/**
 * Query hook to test an LLM endpoint and discover available models.
 * Only runs when endpoint is a valid URL starting with http.
 */
export function useEndpointTestQuery(endpoint: string) {
  const isValidUrl = endpoint.trim() !== "" && endpoint.startsWith("http");

  return useQuery({
    queryKey: endpointKeys.test(endpoint),
    queryFn: () => testEndpoint(endpoint),
    enabled: isValidUrl,
    staleTime: 30_000, // Cache for 30 seconds
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export type { EndpointTestResult };
