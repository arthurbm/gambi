import type {
  ParticipantAuthHeaders,
  ParticipantCapabilities,
} from "./types.ts";

export interface EndpointProbeResult {
  success: boolean;
  models: string[];
  capabilities: ParticipantCapabilities;
}

export interface EndpointProbeOptions {
  authHeaders?: ParticipantAuthHeaders;
}

const TRAILING_SLASH_REGEX = /\/$/;
const REQUEST_TIMEOUT_MS = 5000;

function createTimeoutSignal(): AbortSignal {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

function createProbeHeaders(
  authHeaders: ParticipantAuthHeaders = {},
  contentType = false
): Headers {
  const headers = new Headers(authHeaders);
  if (contentType) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

async function probePostEndpoint(
  url: string,
  authHeaders: ParticipantAuthHeaders = {}
): Promise<boolean | "unknown"> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: createProbeHeaders(authHeaders, true),
      body: "{}",
      signal: createTimeoutSignal(),
    });

    if (
      response.status === 401 ||
      response.status === 403 ||
      response.status === 404 ||
      response.status === 405 ||
      response.status === 501
    ) {
      return false;
    }

    return true;
  } catch {
    return "unknown";
  }
}

export async function probeEndpoint(
  endpoint: string,
  options: EndpointProbeOptions = {}
): Promise<EndpointProbeResult> {
  const baseUrl = endpoint.replace(TRAILING_SLASH_REGEX, "");
  const authHeaders = options.authHeaders ?? {};
  let models: string[] = [];
  try {
    const tagsResponse = await fetch(`${baseUrl}/api/tags`, {
      headers: createProbeHeaders(authHeaders),
      signal: createTimeoutSignal(),
    });

    if (tagsResponse.ok) {
      const data = (await tagsResponse.json()) as {
        models?: Array<{ name: string }>;
      };

      models = data.models?.map((model) => model.name) ?? [];
    }
  } catch {
    // Ignore and probe the protocol-specific surfaces next.
  }

  try {
    const modelsResponse = await fetch(`${baseUrl}/v1/models`, {
      headers: createProbeHeaders(authHeaders),
      signal: createTimeoutSignal(),
    });

    if (modelsResponse.ok) {
      const data = (await modelsResponse.json()) as {
        data?: Array<{ id: string }>;
      };

      if (models.length === 0) {
        models = data.data?.map((model) => model.id) ?? [];
      }
    }
  } catch {
    // Ignore and rely on the explicit endpoint probes below.
  }

  const [chatCompletionsProbe, responsesProbe] = await Promise.all([
    probePostEndpoint(`${baseUrl}/v1/chat/completions`, authHeaders),
    probePostEndpoint(`${baseUrl}/v1/responses`, authHeaders),
  ]);

  let chatCompletions: ParticipantCapabilities["chatCompletions"] = "unknown";
  if (chatCompletionsProbe === "unknown") {
    chatCompletions = models.length > 0 ? "supported" : "unknown";
  } else if (chatCompletionsProbe) {
    chatCompletions = "supported";
  } else {
    chatCompletions = "unsupported";
  }

  let openResponses: ParticipantCapabilities["openResponses"] = "unknown";
  if (responsesProbe === "unknown") {
    openResponses = "unknown";
  } else if (responsesProbe) {
    openResponses = "supported";
  } else {
    openResponses = "unsupported";
  }

  const capabilities: ParticipantCapabilities = {
    chatCompletions,
    openResponses,
  };

  return {
    success:
      models.length > 0 ||
      capabilities.chatCompletions === "supported" ||
      capabilities.openResponses === "supported",
    models,
    capabilities,
  };
}
