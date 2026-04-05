import type {
  ApiErrorResponse,
  ApiMeta,
  HeartbeatResult,
  ParticipantAuthHeaders,
  ParticipantCapabilities,
  ParticipantSummary,
  RoomEvent,
  RoomSummary,
  RuntimeConfig,
} from "./types.ts";

export interface ClientOptions {
  hubUrl?: string;
}

export interface CreateRoomInput {
  defaults?: RuntimeConfig;
  name: string;
  password?: string;
}

export interface UpsertParticipantInput {
  nickname: string;
  model: string;
  endpoint: string;
  password?: string;
  specs?: ParticipantSummary["specs"];
  config?: RuntimeConfig;
  capabilities?: ParticipantCapabilities;
  authHeaders?: ParticipantAuthHeaders;
}

export interface ApiResult<T> {
  data: T;
  meta: ApiMeta;
}

export interface WatchRoomOptions {
  roomCode: string;
  signal?: AbortSignal;
}

export interface GambiClient {
  rooms: {
    create: (
      input: CreateRoomInput
    ) => Promise<ApiResult<{ room: RoomSummary; hostId: string }>>;
    get: (roomCode: string) => Promise<ApiResult<RoomSummary>>;
    list: () => Promise<ApiResult<RoomSummary[]>>;
  };
  participants: {
    upsert: (
      roomCode: string,
      participantId: string,
      input: UpsertParticipantInput
    ) => Promise<ApiResult<{ participant: ParticipantSummary; roomId: string }>>;
    list: (roomCode: string) => Promise<ApiResult<ParticipantSummary[]>>;
    remove: (
      roomCode: string,
      participantId: string
    ) => Promise<ApiResult<{ success: true }>>;
    heartbeat: (
      roomCode: string,
      participantId: string
    ) => Promise<ApiResult<HeartbeatResult>>;
  };
  events: {
    watchRoom: (options: WatchRoomOptions) => AsyncIterable<RoomEvent>;
  };
}

export class ClientError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly hint?: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(params: {
    message: string;
    status: number;
    code?: string;
    hint?: string;
    details?: unknown;
    requestId?: string;
  }) {
    super(params.message);
    this.name = "ClientError";
    this.status = params.status;
    this.code = params.code;
    this.hint = params.hint;
    this.details = params.details;
    this.requestId = params.requestId;
  }
}

function parseErrorEnvelope(
  status: number,
  body: Partial<ApiErrorResponse> | undefined,
  fallbackMessage: string
): ClientError {
  return new ClientError({
    message: body?.error?.message ?? fallbackMessage,
    status,
    code: body?.error?.code,
    hint: body?.error?.hint,
    details: body?.error?.details,
    requestId: body?.meta?.requestId,
  });
}

function parseEventStreamChunk(chunk: string): RoomEvent[] {
  const events: RoomEvent[] = [];
  const blocks = chunk.split("\n\n");

  for (const block of blocks) {
    if (!block.trim()) {
      continue;
    }

    const eventLine = block
      .split("\n")
      .find((line) => line.startsWith("data: "));
    if (!eventLine) {
      continue;
    }

    try {
      const data = JSON.parse(eventLine.slice(6)) as RoomEvent;
      events.push(data);
    } catch {
      continue;
    }
  }

  return events;
}

export function createClient(options: ClientOptions = {}): GambiClient {
  const hubUrl = options.hubUrl ?? "http://localhost:3000";

  async function request<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
    const response = await fetch(`${hubUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });

    const body = (await response.json().catch(() => undefined)) as
      | ApiResult<T>
      | ApiErrorResponse
      | undefined;

    if (!response.ok) {
      throw parseErrorEnvelope(
        response.status,
        body as Partial<ApiErrorResponse> | undefined,
        `Request failed: ${response.statusText}`
      );
    }

    return body as ApiResult<T>;
  }

  return {
    rooms: {
      create(input) {
        return request<{ room: RoomSummary; hostId: string }>("/v1/rooms", {
          method: "POST",
          body: JSON.stringify(input),
        });
      },
      get(roomCode) {
        return request<RoomSummary>(`/v1/rooms/${roomCode}`);
      },
      list() {
        return request<RoomSummary[]>("/v1/rooms");
      },
    },
    participants: {
      upsert(roomCode, participantId, input) {
        return request<{ participant: ParticipantSummary; roomId: string }>(
          `/v1/rooms/${roomCode}/participants/${participantId}`,
          {
            method: "PUT",
            body: JSON.stringify(input),
          }
        );
      },
      list(roomCode) {
        return request<ParticipantSummary[]>(
          `/v1/rooms/${roomCode}/participants`
        );
      },
      remove(roomCode, participantId) {
        return request<{ success: true }>(
          `/v1/rooms/${roomCode}/participants/${participantId}`,
          {
            method: "DELETE",
          }
        );
      },
      heartbeat(roomCode, participantId) {
        return request<HeartbeatResult>(
          `/v1/rooms/${roomCode}/participants/${participantId}/heartbeat`,
          {
            method: "POST",
          }
        );
      },
    },
    events: {
      async *watchRoom(options: WatchRoomOptions): AsyncIterable<RoomEvent> {
        const response = await fetch(
          `${hubUrl}/v1/rooms/${options.roomCode}/events`,
          {
            headers: { Accept: "text/event-stream" },
            signal: options.signal,
          }
        );

        if (!response.ok) {
          const body = (await response.json().catch(() => undefined)) as
            | ApiErrorResponse
            | undefined;
          throw parseErrorEnvelope(
            response.status,
            body,
            `Failed to watch room events: ${response.statusText}`
          );
        }

        if (!response.body) {
          throw new ClientError({
            message: "Event stream body is missing.",
            status: 500,
            code: "INTERNAL_ERROR",
          });
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const split = buffer.split("\n\n");
          buffer = split.pop() ?? "";
          for (const block of split) {
            for (const event of parseEventStreamChunk(`${block}\n\n`)) {
              yield event;
            }
          }
        }

        if (buffer.trim()) {
          for (const event of parseEventStreamChunk(buffer)) {
            yield event;
          }
        }
      },
    },
  };
}
