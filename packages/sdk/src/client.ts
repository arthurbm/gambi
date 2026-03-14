// HTTP client for interacting with remote Gambiarra hubs
import type {
  ParticipantAuthHeaders,
  ParticipantInfo,
  RoomInfoPublic,
  RuntimeConfig,
} from "./types.ts";

/**
 * Options for creating a Gambiarra HTTP client
 */
export interface ClientOptions {
  /** Base URL of the hub (default: http://localhost:3000) */
  hubUrl?: string;
}

/**
 * Options for creating a participant
 */
export interface CreateParticipantOptions {
  id: string;
  nickname: string;
  model: string;
  endpoint: string;
  password?: string;
  specs?: ParticipantInfo["specs"];
  config?: RuntimeConfig;
  capabilities?: ParticipantInfo["capabilities"];
  authHeaders?: ParticipantAuthHeaders;
}

export interface CreateRoomOptions {
  password?: string;
  defaults?: RuntimeConfig;
}

/**
 * Response when creating a room
 */
export interface CreateRoomResponse {
  room: RoomInfoPublic;
  hostId: string;
}

/**
 * Response when joining a room
 */
export interface JoinRoomResponse {
  participant: ParticipantInfo;
  roomId: string;
}

/**
 * HTTP client for interacting with a remote Gambiarra hub
 *
 * Provides methods for managing rooms and participants via HTTP.
 */
export interface GambiarraClient {
  /** Create a new room with an optional password and runtime defaults */
  create(
    name: string,
    passwordOrOptions?: string | CreateRoomOptions
  ): Promise<CreateRoomResponse>;

  /** List all rooms */
  list(): Promise<RoomInfoPublic[]>;

  /** Join a room as a participant */
  join(
    code: string,
    participant: CreateParticipantOptions
  ): Promise<JoinRoomResponse>;

  /** Leave a room */
  leave(code: string, participantId: string): Promise<{ success: boolean }>;

  /** Get all participants in a room */
  getParticipants(code: string): Promise<ParticipantInfo[]>;

  /** Send health check for a participant */
  healthCheck(
    code: string,
    participantId: string
  ): Promise<{ success: boolean }>;
}

/**
 * Error thrown when a client request fails
 */
export class ClientError extends Error {
  readonly status: number;
  readonly response?: unknown;

  constructor(message: string, status: number, response?: unknown) {
    super(message);
    this.name = "ClientError";
    this.status = status;
    this.response = response;
  }
}

/**
 * Create a new Gambiarra HTTP client
 *
 * @param options - Client configuration options
 * @returns A client instance for interacting with the hub
 *
 * @example
 * ```typescript
 * import { createClient } from "gambiarra-sdk/client";
 *
 * const client = createClient({ hubUrl: "http://hub.example.com:3000" });
 *
 * // Create a password-protected room
 * const { room, hostId } = await client.create("My Room", "secret123");
 *
 * // Join the room with password
 * await client.join(room.code, {
 *   id: "participant-1",
 *   nickname: "Bot",
 *   model: "llama3",
 *   endpoint: "http://localhost:11434",
 *   password: "secret123"
 * });
 * ```
 */
export function createClient(options: ClientOptions = {}): GambiarraClient {
  const hubUrl = options.hubUrl ?? "http://localhost:3000";

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${hubUrl}${path}`;
    const response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      throw new ClientError(
        errorData.error || `Request failed: ${response.statusText}`,
        response.status,
        errorData
      );
    }

    return response.json() as Promise<T>;
  }

  return {
    create(
      name: string,
      passwordOrOptions?: string | CreateRoomOptions
    ): Promise<CreateRoomResponse> {
      const createOptions =
        typeof passwordOrOptions === "string"
          ? { password: passwordOrOptions }
          : passwordOrOptions;
      const body: {
        defaults?: RuntimeConfig;
        name: string;
        password?: string;
      } = { name };
      if (createOptions?.password) {
        body.password = createOptions.password;
      }
      if (createOptions?.defaults) {
        body.defaults = createOptions.defaults;
      }
      return request("/rooms", {
        method: "POST",
        body: JSON.stringify(body),
      });
    },

    async list(): Promise<RoomInfoPublic[]> {
      const response = await request<{ rooms: RoomInfoPublic[] }>("/rooms");
      return response.rooms;
    },

    join(
      code: string,
      participant: CreateParticipantOptions
    ): Promise<JoinRoomResponse> {
      return request(`/rooms/${code}/join`, {
        method: "POST",
        body: JSON.stringify(participant),
      });
    },

    leave(code: string, participantId: string): Promise<{ success: boolean }> {
      return request(`/rooms/${code}/leave/${participantId}`, {
        method: "DELETE",
      });
    },

    async getParticipants(code: string): Promise<ParticipantInfo[]> {
      const response = await request<{ participants: ParticipantInfo[] }>(
        `/rooms/${code}/participants`
      );
      return response.participants;
    },

    healthCheck(
      code: string,
      participantId: string
    ): Promise<{ success: boolean }> {
      return request(`/rooms/${code}/health`, {
        method: "POST",
        body: JSON.stringify({ id: participantId }),
      });
    },
  };
}
