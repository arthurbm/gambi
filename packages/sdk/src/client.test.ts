import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { createHub, type Hub } from "@gambi/core/hub";
import { Room } from "@gambi/core/room";
import { type ClientError, createClient } from "./client.ts";

const originalFetch = globalThis.fetch;

function getRandomPort(): number {
  return 30_000 + Math.floor(Math.random() * 20_000);
}

function createHubWithRetry(): Hub {
  let lastError: unknown;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return createHub({ port: getRandomPort(), hostname: "127.0.0.1" });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

describe("HTTP Client", () => {
  let hub: Hub;
  let client: ReturnType<typeof createClient>;

  beforeAll(() => {
    hub = createHubWithRetry();
    client = createClient({ hubUrl: hub.url });
  });

  afterAll(() => {
    hub.close();
  });

  beforeEach(() => {
    Room.clear();
    globalThis.fetch = originalFetch;
  });

  test("creates and lists rooms through the namespaced client", async () => {
    const created = await client.rooms.create({ name: "Test Room" });
    const listed = await client.rooms.list();

    expect(created.data.room.name).toBe("Test Room");
    expect(created.data.room.code).toHaveLength(6);
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]?.name).toBe("Test Room");
  });

  test("gets one room summary", async () => {
    const created = await client.rooms.create({ name: "Lookup Room" });
    const fetched = await client.rooms.get(created.data.room.code);

    expect(fetched.data.code).toBe(created.data.room.code);
    expect(fetched.data.passwordProtected).toBe(false);
  });

  test("upserts participants and redacts runtime instructions publicly", async () => {
    const created = await client.rooms.create({ name: "Workers" });

    const joined = await client.participants.upsert(
      created.data.room.code,
      "worker-1",
      {
        nickname: "Worker 1",
        model: "llama3",
        endpoint: "http://localhost:11434",
        config: {
          instructions: "Private",
          temperature: 0.4,
        },
      }
    );

    expect(joined.data.participant.id).toBe("worker-1");
    expect(joined.data.participant.config).toEqual({
      hasInstructions: true,
      temperature: 0.4,
    });

    const listed = await client.participants.list(created.data.room.code);
    expect(listed.data).toHaveLength(1);
    expect(listed.data[0]?.config).toEqual({
      hasInstructions: true,
      temperature: 0.4,
    });
  });

  test("supports heartbeat and remove for participants", async () => {
    const created = await client.rooms.create({ name: "Lifecycle" });
    await client.participants.upsert(created.data.room.code, "worker-1", {
      nickname: "Worker 1",
      model: "llama3",
      endpoint: "http://localhost:11434",
    });

    const heartbeat = await client.participants.heartbeat(
      created.data.room.code,
      "worker-1"
    );
    expect(heartbeat.data.success).toBe(true);
    expect(heartbeat.data.status).toBe("online");

    const removed = await client.participants.remove(
      created.data.room.code,
      "worker-1"
    );
    expect(removed.data.success).toBe(true);
  });

  test("parses typed management errors into ClientError", async () => {
    await expect(client.rooms.get("XXXXXX")).rejects.toMatchObject({
      name: "ClientError",
      status: 404,
      code: "ROOM_NOT_FOUND",
    } satisfies Partial<ClientError>);
  });

  test("maps connectivity failures to ClientError", async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error("connect ECONNREFUSED"))) as typeof fetch;

    await expect(client.rooms.list()).rejects.toMatchObject({
      name: "ClientError",
      status: 503,
      code: "INTERNAL_ERROR",
      message: "Failed to reach hub.",
      hint: "Check hub URL and connectivity.",
    } satisfies Partial<ClientError>);
  });

  test("treats invalid success JSON as a protocol ClientError", async () => {
    globalThis.fetch = (async () =>
      new Response("not-json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as unknown as typeof fetch;

    await expect(client.rooms.list()).rejects.toMatchObject({
      name: "ClientError",
      status: 502,
      code: "INTERNAL_ERROR",
      message: "Invalid JSON response from hub.",
      hint: "Check hub compatibility or proxy behavior.",
    } satisfies Partial<ClientError>);
  });

  test("watches typed room events", async () => {
    const created = await client.rooms.create({ name: "Watched Room" });
    const abortController = new AbortController();
    const iterator = client.events
      .watchRoom({
        roomCode: created.data.room.code,
        signal: abortController.signal,
      })
      [Symbol.asyncIterator]();

    const connectedEvent = await iterator.next();
    expect(connectedEvent.done).toBe(false);
    expect(connectedEvent.value?.type).toBe("connected");

    await client.participants.upsert(created.data.room.code, "worker-1", {
      nickname: "Worker 1",
      model: "llama3",
      endpoint: "http://localhost:11434",
    });

    const joinedEvent = await iterator.next();
    expect(joinedEvent.done).toBe(false);
    expect(joinedEvent.value?.type).toBe("participant.joined");

    abortController.abort();
  });

  test("maps room event connectivity failures to ClientError", async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error("connect ECONNREFUSED"))) as typeof fetch;

    const iterator = client.events
      .watchRoom({
        roomCode: "ABC123",
      })
      [Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toMatchObject({
      name: "ClientError",
      status: 503,
      code: "INTERNAL_ERROR",
      message: "Failed to reach hub.",
      hint: "Check hub URL and connectivity.",
    } satisfies Partial<ClientError>);
  });

  test("ends room event watches cleanly when aborted", async () => {
    globalThis.fetch = (() =>
      Promise.reject(
        new DOMException("Aborted", "AbortError")
      )) as typeof fetch;

    const abortController = new AbortController();
    abortController.abort();

    const iterator = client.events
      .watchRoom({
        roomCode: "ABC123",
        signal: abortController.signal,
      })
      [Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  test("maps room event stream interruptions to ClientError", async () => {
    globalThis.fetch = (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("data: "));
            queueMicrotask(() => {
              controller.error(new Error("stream dropped"));
            });
          },
        }),
        {
          headers: { "Content-Type": "text/event-stream" },
        }
      )) as unknown as typeof fetch;

    const iterator = client.events
      .watchRoom({
        roomCode: "ABC123",
      })
      [Symbol.asyncIterator]();

    await expect(iterator.next()).rejects.toMatchObject({
      name: "ClientError",
      status: 503,
      code: "INTERNAL_ERROR",
      message: "Event stream interrupted.",
      hint: "Check hub URL and connectivity.",
    } satisfies Partial<ClientError>);
  });
});
