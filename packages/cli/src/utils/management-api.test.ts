import { afterEach, describe, expect, test } from "bun:test";
import { requestManagement, watchRoomEvents } from "./management-api.ts";

const originalFetch = globalThis.fetch;

describe("management api helpers", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("requestManagement returns a structured connectivity failure when fetch rejects", async () => {
    globalThis.fetch = (() =>
      Promise.reject(
        new Error("connect ECONNREFUSED")
      )) as unknown as typeof fetch;

    const result = await requestManagement(
      "http://localhost:3000",
      "/v1/rooms"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected a failure result");
    }

    expect(result.value.status).toBe(503);
    expect(result.value.error.message).toBe("Failed to reach hub.");
    expect(result.value.error.hint).toBe("Check hub URL and connectivity.");
  });

  test("requestManagement returns a protocol failure when success JSON is invalid", async () => {
    globalThis.fetch = (async () =>
      new Response("not-json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    const result = await requestManagement(
      "http://localhost:3000",
      "/v1/rooms"
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("Expected a failure result");
    }

    expect(result.value.status).toBe(502);
    expect(result.value.error.message).toBe("Invalid JSON response from hub.");
    expect(result.value.error.hint).toBe(
      "Check hub compatibility or proxy behavior."
    );
  });

  test("watchRoomEvents flushes the final buffered SSE block", async () => {
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'event: participant.joined\ndata: {"type":"participant.joined","timestamp":1,"roomCode":"ABC123","data":{"id":"worker-1"}}'
              )
            );
            controller.close();
          },
        }),
        {
          headers: { "Content-Type": "text/event-stream" },
        }
      )) as unknown as typeof fetch;

    const events: unknown[] = [];
    for await (const event of watchRoomEvents(
      "http://localhost:3000",
      "ABC123"
    )) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "participant.joined",
        timestamp: 1,
        roomCode: "ABC123",
        data: { id: "worker-1" },
      },
    ]);
  });

  test("watchRoomEvents ends cleanly when aborted", async () => {
    globalThis.fetch = (() =>
      Promise.reject(
        new DOMException("Aborted", "AbortError")
      )) as unknown as typeof fetch;

    const events: unknown[] = [];
    for await (const event of watchRoomEvents(
      "http://localhost:3000",
      "ABC123",
      AbortSignal.abort()
    )) {
      events.push(event);
    }

    expect(events).toEqual([]);
  });
});
