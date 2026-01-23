import { useCallback, useEffect, useRef, useState } from "react";
import type { SSEEvent } from "../types";

interface UseSSEOptions {
  hubUrl: string;
  roomCode: string;
  onEvent: (event: string, data: unknown) => void;
  enabled?: boolean;
}

interface UseSSEReturn {
  connected: boolean;
  error: Error | null;
  reconnect: () => void;
}

const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 10;

async function processSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (event: string, data: unknown) => void
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = parseSSEBuffer(buffer);
    buffer = events.remaining;

    for (const event of events.parsed) {
      onEvent(event.event, event.data);
    }
  }
}

async function fetchSSEResponse(
  url: string,
  signal: AbortSignal
): Promise<Response> {
  const response = await fetch(url, {
    signal,
    headers: { Accept: "text/event-stream" },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  if (!response.body) {
    throw new Error("No response body");
  }

  return response;
}

export function useSSE(options: UseSSEOptions): UseSSEReturn {
  const { hubUrl, roomCode, onEvent, enabled = true } = options;

  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );

  const connect = useCallback(async () => {
    if (!enabled) {
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const url = `${hubUrl}/rooms/${roomCode}/events`;
      const response = await fetchSSEResponse(url, controller.signal);

      setConnected(true);
      setError(null);
      reconnectAttemptsRef.current = 0;

      if (response.body) {
        const reader: ReadableStreamDefaultReader<Uint8Array> =
          response.body.getReader();
        await processSSEStream(reader, onEvent);
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }

      setConnected(false);
      setError(err instanceof Error ? err : new Error(String(err)));

      if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttemptsRef.current++;
        reconnectTimeoutRef.current = setTimeout(connect, RECONNECT_DELAY);
      }
    }
  }, [hubUrl, roomCode, onEvent, enabled]);

  const reconnect = useCallback(() => {
    reconnectAttemptsRef.current = 0;
    connect();
  }, [connect]);

  useEffect(() => {
    if (enabled) {
      connect();
    }

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [connect, enabled]);

  return { connected, error, reconnect };
}

interface ParsedSSEResult {
  parsed: SSEEvent[];
  remaining: string;
}

function tryParseEvent(
  eventType: string,
  eventData: string
): SSEEvent | undefined {
  if (!(eventType && eventData)) {
    return undefined;
  }
  try {
    return { event: eventType, data: JSON.parse(eventData) };
  } catch {
    return undefined;
  }
}

function buildRemainingBuffer(eventType: string, eventData: string): string {
  let remaining = "";
  if (eventType) {
    remaining += `event: ${eventType}\n`;
  }
  if (eventData) {
    remaining += `data: ${eventData}\n`;
  }
  return remaining;
}

function parseSSEBuffer(buffer: string): ParsedSSEResult {
  const events: SSEEvent[] = [];
  const lines = buffer.split("\n");

  let currentEvent = "";
  let currentData = "";

  for (const line of lines) {
    if (line === "") {
      const parsed = tryParseEvent(currentEvent, currentData);
      if (parsed) {
        events.push(parsed);
      }
      currentEvent = "";
      currentData = "";
      continue;
    }

    if (line.startsWith("event: ")) {
      currentEvent = line.slice(7);
    } else if (line.startsWith("data: ")) {
      currentData = line.slice(6);
    }
  }

  const remaining = buildRemainingBuffer(currentEvent, currentData);
  return { parsed: events, remaining };
}
