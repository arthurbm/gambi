import { Buffer } from "node:buffer";
import { probeEndpoint } from "@gambi/core/endpoint";
import {
  TunnelRequestMessage,
  TunnelServerMessage,
} from "@gambi/core/tunnel-protocol";
import { HEALTH_CHECK_INTERVAL, type ParticipantAuthHeaders } from "./types.ts";
import { createClient, type UpsertParticipantResult } from "./client.ts";
import type {
  MachineSpecs,
  ParticipantCapabilities,
  RuntimeConfig,
  TunnelBootstrap,
} from "./types.ts";

const TRAILING_SLASH_REGEX = /\/$/;

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
  participant: UpsertParticipantResult["participant"];
  roomId: string;
  tunnel: TunnelBootstrap;
  waitUntilClosed: () => Promise<ParticipantSessionCloseEvent>;
}

class ManagedParticipantSession implements ParticipantSession {
  readonly participant: UpsertParticipantResult["participant"];
  readonly roomId: string;
  readonly tunnel: TunnelBootstrap;

  #authHeaders: ParticipantAuthHeaders;
  #client: ReturnType<typeof createClient>;
  #closePromise: Promise<ParticipantSessionCloseEvent>;
  #endpoint: string;
  #heartbeatInterval?: ReturnType<typeof setInterval>;
  #pingInterval?: ReturnType<typeof setInterval>;
  #resolveClose!: (event: ParticipantSessionCloseEvent) => void;
  #roomCode: string;
  #participantId: string;
  #stopping = false;
  #ws: WebSocket;

  constructor(params: {
    authHeaders: ParticipantAuthHeaders;
    client: ReturnType<typeof createClient>;
    endpoint: string;
    participant: UpsertParticipantResult["participant"];
    participantId: string;
    roomCode: string;
    roomId: string;
    tunnel: TunnelBootstrap;
    ws: WebSocket;
  }) {
    this.#authHeaders = params.authHeaders;
    this.#client = params.client;
    this.#endpoint = normalizeEndpoint(params.endpoint);
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
      void this.#handleMessage(event.data);
    });
    this.#ws.addEventListener("close", () => {
      void this.#stop("tunnel_closed");
    });
    this.#ws.addEventListener("error", () => {
      void this.#stop("tunnel_closed", new Error("Participant tunnel errored."));
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
      void this.#sendHeartbeat();
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
      await this.#client.participants.heartbeat(this.#roomCode, this.#participantId);
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
        await this.#client.participants.remove(this.#roomCode, this.#participantId);
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

  const client = createClient({ hubUrl: options.hubUrl });
  const registration = await client.participants.upsert(
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
    const ws = await openParticipantTunnel(registration.data.tunnel);

    return new ManagedParticipantSession({
      authHeaders,
      client,
      endpoint: options.endpoint,
      participant: registration.data.participant,
      participantId: options.participantId,
      roomCode: options.roomCode,
      roomId: registration.data.roomId,
      tunnel: registration.data.tunnel,
      ws,
    });
  } catch (error) {
    try {
      await client.participants.remove(options.roomCode, options.participantId);
    } catch {
      // Best effort cleanup only.
    }

    throw error;
  }
}
