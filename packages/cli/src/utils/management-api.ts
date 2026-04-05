import type {
  ApiErrorResponse,
  ApiMeta,
  HeartbeatResult,
  ParticipantSummary,
  RoomEvent,
  RoomSummary,
} from "@gambi/core/types";

export interface ApiSuccess<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiFailure {
  status: number;
  error: NonNullable<ApiErrorResponse["error"]>;
  meta?: ApiMeta;
}

export async function requestManagement<T>(
  hubUrl: string,
  path: string,
  init?: RequestInit
): Promise<{ ok: true; value: ApiSuccess<T> } | { ok: false; value: ApiFailure }> {
  const response = await fetch(`${hubUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const body = (await response.json().catch(() => undefined)) as
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

  return {
    ok: true,
    value: body as ApiSuccess<T>,
  };
}

export function exitCodeForFailure(failure: ApiFailure): number {
  if (failure.status === 400 || failure.status === 422) {
    return 2;
  }

  if (failure.status === 401 || failure.status === 403 || failure.status === 503) {
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
  const response = await fetch(`${hubUrl}/v1/rooms/${roomCode}/events`, {
    headers: { Accept: "text/event-stream" },
    signal,
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as
      | ApiErrorResponse
      | undefined;
    throw new Error(body?.error?.message ?? response.statusText);
  }

  if (!response.body) {
    throw new Error("Missing event stream body.");
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

    for (const block of blocks) {
      const payloadLine = block
        .split("\n")
        .find((line) => line.startsWith("data: "));
      if (!payloadLine) {
        continue;
      }

      try {
        yield JSON.parse(payloadLine.slice(6)) as RoomEvent;
      } catch {
        continue;
      }
    }
  }
}

export type { HeartbeatResult, ParticipantSummary, RoomSummary };
