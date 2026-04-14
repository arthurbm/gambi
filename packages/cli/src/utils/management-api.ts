import type { ApiErrorResponse, ApiMeta, RoomEvent } from "@gambi/core/types";

export interface ApiSuccess<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiFailure {
  status: number;
  error: NonNullable<ApiErrorResponse["error"]>;
  meta?: ApiMeta;
}

export class WatchRoomEventsError extends Error {
  readonly failure: ApiFailure;

  constructor(failure: ApiFailure) {
    super(failure.error.message);
    this.name = "WatchRoomEventsError";
    this.failure = failure;
  }
}

function isApiSuccess<T>(value: unknown): value is ApiSuccess<T> {
  return (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    "meta" in value
  );
}

function createConnectivityFailure(
  message = "Failed to reach hub.",
  hint = "Check hub URL and connectivity."
): ApiFailure {
  return {
    status: 503,
    error: {
      code: "INTERNAL_ERROR",
      message,
      hint,
    },
  };
}

function createProtocolFailure(
  message = "Invalid JSON response from hub.",
  hint = "Check hub compatibility or proxy behavior."
): ApiFailure {
  return {
    status: 502,
    error: {
      code: "INTERNAL_ERROR",
      message,
      hint,
    },
  };
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

function parseSseBlocks(chunk: string): RoomEvent[] {
  const events: RoomEvent[] = [];

  for (const block of chunk.split("\n\n")) {
    const payloadLine = block
      .split("\n")
      .find((line) => line.startsWith("data: "));
    if (!payloadLine) {
      continue;
    }

    try {
      events.push(JSON.parse(payloadLine.slice(6)) as RoomEvent);
    } catch {
      // Ignore malformed SSE payloads and continue consuming the stream.
    }
  }

  return events;
}

export async function requestManagement<T>(
  hubUrl: string,
  path: string,
  init?: RequestInit
): Promise<
  { ok: true; value: ApiSuccess<T> } | { ok: false; value: ApiFailure }
> {
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
    return {
      ok: false,
      value: createConnectivityFailure(),
    };
  }

  const body = (await readJsonBody(response)) as
    | ApiSuccess<T>
    | ApiErrorResponse
    | undefined;

  if (!response.ok) {
    return {
      ok: false,
      value: {
        status: response.status,
        error: (body as ApiErrorResponse | undefined)?.error ?? {
          code: "INTERNAL_ERROR",
          message: response.statusText,
        },
        meta: (body as ApiErrorResponse | undefined)?.meta,
      },
    };
  }

  if (!isApiSuccess<T>(body)) {
    return {
      ok: false,
      value: createProtocolFailure(),
    };
  }

  return {
    ok: true,
    value: body,
  };
}

export function exitCodeForFailure(failure: ApiFailure): number {
  if (failure.status === 400 || failure.status === 422) {
    return 2;
  }

  if (
    failure.status === 401 ||
    failure.status === 403 ||
    failure.status === 503
  ) {
    return 3;
  }

  if (failure.status === 404 || failure.status === 409) {
    return 4;
  }

  return 1;
}

export function renderFailure(failure: ApiFailure): string {
  const lines = [`Error: ${failure.error.message}`];
  if (failure.error.hint) {
    lines.push(`Hint: ${failure.error.hint}`);
  }
  if (failure.meta?.requestId) {
    lines.push(`request_id: ${failure.meta.requestId}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function* watchRoomEvents(
  hubUrl: string,
  roomCode: string,
  signal?: AbortSignal
): AsyncIterable<RoomEvent> {
  let response: Response;
  try {
    response = await fetch(`${hubUrl}/v1/rooms/${roomCode}/events`, {
      headers: { Accept: "text/event-stream" },
      signal,
    });
  } catch {
    throw new WatchRoomEventsError(createConnectivityFailure());
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      | ApiErrorResponse
      | undefined;
    throw new WatchRoomEventsError({
      status: response.status,
      error: body?.error ?? {
        code: "INTERNAL_ERROR",
        message: response.statusText,
      },
      meta: body?.meta,
    });
  }

  if (!response.body) {
    throw new WatchRoomEventsError({
      status: 502,
      error: {
        code: "INTERNAL_ERROR",
        message: "Missing event stream body.",
      },
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
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";

    for (const event of parseSseBlocks(blocks.join("\n\n"))) {
      yield event;
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    for (const event of parseSseBlocks(buffer)) {
      yield event;
    }
  }
}

export type {
  HeartbeatResult,
  ParticipantSummary,
  RoomSummary,
} from "@gambi/core/types";
