import { Buffer } from "node:buffer";
import { probeEndpoint } from "./endpoint-capabilities.ts";
import {
  type TunnelRequestMessage,
  TunnelServerMessage,
} from "./tunnel-protocol.ts";
import type {
  MachineSpecs,
  ParticipantAuthHeaders,
  ParticipantCapabilities,
  ParticipantConnection,
  ParticipantSummary,
  RuntimeConfig,
  TunnelBootstrap,
} from "./types.ts";
import { HEALTH_CHECK_INTERVAL } from "./types.ts";

const TRAILING_SLASH_REGEX = /\/$/;
const DEFAULT_HUB_URL = "http://localhost:3000";

function ignorePromise(promise: Promise<unknown>): void {
  promise.catch(() => undefined);
}

function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(TRAILING_SLASH_REGEX, "");
}

function encodeChunk(chunk: Uint8Array): string {
  return Buffer.from(chunk).toString("base64");
}

function createProviderHeaders(
  authHeaders: ParticipantAuthHeaders,
  extraHeaders: Record<string, string>
): Headers {
  return new Headers({
    ...authHeaders,
    ...extraHeaders,
  });
}

function createTunnelUrl(bootstrap: TunnelBootstrap): string {
  const url = new URL(bootstrap.url);
  url.searchParams.set("token", bootstrap.token);
  return url.toString();
}

interface HubApiResult<T> {
  data: T;
}

interface HubApiError {
  error?: {
    message?: string;
  };
}

export interface ParticipantSessionRegistration {
  participant: ParticipantSummary & { connection: ParticipantConnection };
  roomId: string;
  tunnel: TunnelBootstrap;
}

function isHubApiResult<T>(value: unknown): value is HubApiResult<T> {
  return typeof value === "object" && value !== null && "data" in value;
}

function getHubErrorMessage(value: unknown, fallback: string): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as HubApiError).error?.message === "string"
  ) {
    return (value as HubApiError).error?.message ?? fallback;
  }

  return fallback;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function requestHub<T>(
  hubUrl: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${hubUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch {
    throw new Error("Failed to reach hub.");
  }

  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      getHubErrorMessage(body, `Request failed: ${response.statusText}`)
    );
  }

  if (!isHubApiResult<T>(body)) {
    throw new Error("Invalid JSON response from hub.");
  }

  return body.data;
}

function upsertParticipant(
  hubUrl: string,
  roomCode: string,
  participantId: string,
  input: {
    capabilities?: ParticipantCapabilities;
    config?: RuntimeConfig;
    endpoint: string;
    model: string;
    nickname: string;
    password?: string;
    specs?: MachineSpecs;
  }
): Promise<ParticipantSessionRegistration> {
  return requestHub<ParticipantSessionRegistration>(
    hubUrl,
    `/v1/rooms/${roomCode}/participants/${participantId}`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    }
  );
}

function heartbeatParticipant(
  hubUrl: string,
  roomCode: string,
  participantId: string
): Promise<unknown> {
  return requestHub(
    hubUrl,
    `/v1/rooms/${roomCode}/participants/${participantId}/heartbeat`,
    {
      method: "POST",
    }
  );
}

function removeParticipant(
  hubUrl: string,
  roomCode: string,
  participantId: string
): Promise<unknown> {
  return requestHub(
    hubUrl,
    `/v1/rooms/${roomCode}/participants/${participantId}`,
    {
      method: "DELETE",
    }
  );
}

function openParticipantTunnel(bootstrap: TunnelBootstrap): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(createTunnelUrl(bootstrap));
    let settled = false;

    const cleanup = () => {
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("error", handleError);
      socket.removeEventListener("close", handleClose);
    };

    const settle = (callback: () => void) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      callback();
    };

    const handleOpen = () => {
      settle(() => resolve(socket));
    };
    const handleError = () => {
      settle(() => reject(new Error("Failed to open participant tunnel.")));
    };
    const handleClose = () => {
      settle(() =>
        reject(new Error("Participant tunnel closed before opening."))
      );
    };

    socket.addEventListener("open", handleOpen, { once: true });
    socket.addEventListener("error", handleError, { once: true });
    socket.addEventListener("close", handleClose, { once: true });
  });
}

export interface ParticipantSessionOptions {
  authHeaders?: ParticipantAuthHeaders;
  capabilities?: ParticipantCapabilities;
  config?: RuntimeConfig;
  endpoint: string;
  hubUrl?: string;
  model: string;
  nickname: string;
  participantId: string;
  password?: string;
  roomCode: string;
  specs?: MachineSpecs;
}

export interface ParticipantSessionCloseEvent {
  error?: Error;
  reason: "closed" | "heartbeat_failed" | "tunnel_closed";
}

export interface ParticipantSession {
  close: () => Promise<ParticipantSessionCloseEvent>;
  participant: ParticipantSessionRegistration["participant"];
  roomId: string;
  tunnel: TunnelBootstrap;
  waitUntilClosed: () => Promise<ParticipantSessionCloseEvent>;
}

class ManagedParticipantSession implements ParticipantSession {
  readonly participant: ParticipantSessionRegistration["participant"];
  readonly roomId: string;
  readonly tunnel: TunnelBootstrap;

  readonly #authHeaders: ParticipantAuthHeaders;
  readonly #closePromise: Promise<ParticipantSessionCloseEvent>;
  readonly #endpoint: string;
  readonly #heartbeatInterval?: ReturnType<typeof setInterval>;
  readonly #hubUrl: string;
  readonly #pingInterval?: ReturnType<typeof setInterval>;
  #resolveClose!: (event: ParticipantSessionCloseEvent) => void;
  readonly #roomCode: string;
  readonly #participantId: string;
  #stopping = false;
  readonly #ws: WebSocket;

  constructor(params: {
    authHeaders: ParticipantAuthHeaders;
    endpoint: string;
    hubUrl: string;
    participant: ParticipantSessionRegistration["participant"];
    participantId: string;
    roomCode: string;
    roomId: string;
    tunnel: TunnelBootstrap;
    ws: WebSocket;
  }) {
    this.#authHeaders = params.authHeaders;
    this.#endpoint = normalizeEndpoint(params.endpoint);
    this.#hubUrl = params.hubUrl;
    this.participant = params.participant;
    this.#participantId = params.participantId;
    this.#roomCode = params.roomCode;
    this.roomId = params.roomId;
    this.tunnel = params.tunnel;
    this.#ws = params.ws;
    this.#closePromise = new Promise((resolve) => {
      this.#resolveClose = resolve;
    });

    this.#ws.addEventListener("message", (event) => {
      ignorePromise(this.#handleMessage(event.data));
    });
    this.#ws.addEventListener("close", () => {
      ignorePromise(this.#stop("tunnel_closed"));
    });
    this.#ws.addEventListener("error", () => {
      ignorePromise(
        this.#stop("tunnel_closed", new Error("Participant tunnel errored."))
      );
    });

    this.#pingInterval = setInterval(() => {
      if (this.#ws.readyState !== WebSocket.OPEN) {
        return;
      }
      this.#ws.send(
        JSON.stringify({
          type: "tunnel.ping",
          timestamp: Date.now(),
        })
      );
    }, HEALTH_CHECK_INTERVAL);

    this.#heartbeatInterval = setInterval(() => {
      ignorePromise(this.#sendHeartbeat());
    }, HEALTH_CHECK_INTERVAL);
  }

  waitUntilClosed(): Promise<ParticipantSessionCloseEvent> {
    return this.#closePromise;
  }

  async close(): Promise<ParticipantSessionCloseEvent> {
    return await this.#stop("closed");
  }

  async #sendHeartbeat(): Promise<void> {
    try {
      await heartbeatParticipant(
        this.#hubUrl,
        this.#roomCode,
        this.#participantId
      );
    } catch (error) {
      await this.#stop(
        "heartbeat_failed",
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  async #handleMessage(rawData: MessageEvent["data"]): Promise<void> {
    const text =
      typeof rawData === "string"
        ? rawData
        : Buffer.from(rawData as ArrayBuffer).toString("utf8");
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return;
    }

    const parsed = TunnelServerMessage.safeParse(value);
    if (!parsed.success) {
      return;
    }

    if (parsed.data.type === "tunnel.pong") {
      return;
    }

    await this.#handleTunnelRequest(parsed.data);
  }

  async #handleTunnelRequest(message: TunnelRequestMessage): Promise<void> {
    try {
      const response = await fetch(`${this.#endpoint}${message.path}`, {
        method: message.method,
        headers: createProviderHeaders(this.#authHeaders, message.headers),
        body:
          message.body === undefined ? undefined : JSON.stringify(message.body),
      });

      this.#ws.send(
        JSON.stringify({
          type: "tunnel.response.start",
          requestId: message.requestId,
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
        })
      );

      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          if (value) {
            this.#ws.send(
              JSON.stringify({
                type: "tunnel.response.chunk",
                requestId: message.requestId,
                chunk: encodeChunk(value),
              })
            );
          }
        }
      }

      this.#ws.send(
        JSON.stringify({
          type: "tunnel.response.end",
          requestId: message.requestId,
        })
      );
    } catch (error) {
      if (this.#ws.readyState === WebSocket.OPEN) {
        this.#ws.send(
          JSON.stringify({
            type: "tunnel.response.error",
            requestId: message.requestId,
            stage: "proxy",
            message: error instanceof Error ? error.message : String(error),
          })
        );
      }
    }
  }

  async #stop(
    reason: ParticipantSessionCloseEvent["reason"],
    error?: Error
  ): Promise<ParticipantSessionCloseEvent> {
    if (this.#stopping) {
      return await this.#closePromise;
    }

    this.#stopping = true;
    if (this.#heartbeatInterval) {
      clearInterval(this.#heartbeatInterval);
    }
    if (this.#pingInterval) {
      clearInterval(this.#pingInterval);
    }

    if (this.#ws.readyState === WebSocket.OPEN) {
      this.#ws.close();
    }

    if (reason !== "tunnel_closed") {
      try {
        await removeParticipant(
          this.#hubUrl,
          this.#roomCode,
          this.#participantId
        );
      } catch {
        // Best effort cleanup only.
      }
    }

    const closeEvent = { reason, error };
    this.#resolveClose(closeEvent);
    return closeEvent;
  }
}

export async function createParticipantSession(
  options: ParticipantSessionOptions
): Promise<ParticipantSession> {
  const authHeaders = options.authHeaders ?? {};
  const probe = await probeEndpoint(options.endpoint, { authHeaders });
  if (!probe.models.includes(options.model)) {
    throw new Error(
      `Model '${options.model}' not found on ${options.endpoint}. Available models: ${probe.models.join(", ")}`
    );
  }

  const hubUrl = normalizeEndpoint(options.hubUrl ?? DEFAULT_HUB_URL);
  const registration = await upsertParticipant(
    hubUrl,
    options.roomCode,
    options.participantId,
    {
      nickname: options.nickname,
      model: options.model,
      endpoint: options.endpoint,
      password: options.password,
      specs: options.specs,
      config: options.config,
      capabilities: options.capabilities ?? probe.capabilities,
    }
  );

  try {
    const ws = await openParticipantTunnel(registration.tunnel);

    return new ManagedParticipantSession({
      authHeaders,
      endpoint: options.endpoint,
      hubUrl,
      participant: registration.participant,
      participantId: options.participantId,
      roomCode: options.roomCode,
      roomId: registration.roomId,
      tunnel: registration.tunnel,
      ws,
    });
  } catch (error) {
    try {
      await removeParticipant(hubUrl, options.roomCode, options.participantId);
    } catch {
      // Best effort cleanup only.
    }

    throw error;
  }
}
