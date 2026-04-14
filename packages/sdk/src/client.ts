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
    ) => Promise<
      ApiResult<{ participant: ParticipantSummary; roomId: string }>
    >;
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

export function parseErrorEnvelope(
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function isApiResult<T>(value: unknown): value is ApiResult<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    "meta" in value
  );
}

function createConnectivityError(
  message = "Failed to reach hub.",
  hint = "Check hub URL and connectivity."
): ClientError {
  return new ClientError({
    message,
    status: 503,
    code: "INTERNAL_ERROR",
    hint,
  });
}

function createProtocolError(
  message = "Invalid JSON response from hub.",
  hint = "Check hub compatibility or proxy behavior."
): ClientError {
  return new ClientError({
    message,
    status: 502,
    code: "INTERNAL_ERROR",
    hint,
  });
}

async function readJsonBody(response: Response): Promise<unknown> {
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

async function fetchResponse(
  input: string,
  init?: RequestInit
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw createConnectivityError();
  }
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
      // Ignore malformed SSE payloads and keep the stream parser resilient.
    }
  }

  return events;
}

async function* streamRoomEvents(response: Response): AsyncIterable<RoomEvent> {
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
    let chunk;
    try {
      chunk = await reader.read();
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      throw error;
    }

    const { done, value } = chunk;
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

  buffer += decoder.decode();
  if (buffer.trim()) {
    for (const event of parseEventStreamChunk(buffer)) {
      yield event;
    }
  }
}

export function createClient(options: ClientOptions = {}): GambiClient {
  const hubUrl = options.hubUrl ?? "http://localhost:3000";

  async function request<T>(
    path: string,
    init?: RequestInit
  ): Promise<ApiResult<T>> {
    const response = await fetchResponse(`${hubUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });

    const body = (await readJsonBody(response)) as
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

    if (!isApiResult<T>(body)) {
      throw createProtocolError();
    }

    return body;
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
        let response: Response;
        try {
          response = await fetchResponse(
            `${hubUrl}/v1/rooms/${options.roomCode}/events`,
            {
              headers: { Accept: "text/event-stream" },
              signal: options.signal,
            }
          );
        } catch (error) {
          if (isAbortError(error)) {
            return;
          }
          throw error;
        }

        if (!response.ok) {
          const body = (await readJsonBody(response)) as
            | ApiErrorResponse
            | undefined;
          throw parseErrorEnvelope(
            response.status,
            body,
            `Failed to watch room events: ${response.statusText}`
          );
        }

        for await (const event of streamRoomEvents(response)) {
          yield event;
        }
      },
    },
  };
}
