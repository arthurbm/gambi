import { useQuery } from "@tanstack/react-query";

interface EndpointTestResult {
  success: boolean;
  models: string[];
  type: "ollama" | "openai" | "unknown";
}

const TRAILING_SLASH_REGEX = /\/$/;

async function testEndpoint(endpoint: string): Promise<EndpointTestResult> {
  const baseUrl = endpoint.replace(TRAILING_SLASH_REGEX, "");

  // Try Ollama first
  try {
    const ollamaRes = await fetch(`${baseUrl}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (ollamaRes.ok) {
      const data = (await ollamaRes.json()) as { models?: { name: string }[] };
      return {
        success: true,
        models: data.models?.map((m) => m.name) ?? [],
        type: "ollama",
      };
    }
  } catch {
    // Ignore, try OpenAI next
  }

  // Try OpenAI-compatible
  try {
    const openaiRes = await fetch(`${baseUrl}/v1/models`, {
      signal: AbortSignal.timeout(5000),
    });
    if (openaiRes.ok) {
      const data = (await openaiRes.json()) as { data?: { id: string }[] };
      return {
        success: true,
        models: data.data?.map((m) => m.id) ?? [],
        type: "openai",
      };
    }
  } catch {
    // Ignore
  }

  return { success: false, models: [], type: "unknown" };
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
