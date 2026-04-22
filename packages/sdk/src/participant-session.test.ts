import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { createHub, type Hub } from "@gambi/core/hub";
import { Room } from "@gambi/core/room";
import { createClient } from "./client.ts";
import { createParticipantSession } from "./participant-session.ts";

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

function startProviderServer() {
  let lastError: unknown;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return Bun.serve({
        port: getRandomPort(),
        hostname: "127.0.0.1",
        fetch(req) {
          const url = new URL(req.url);

          if (url.pathname === "/v1/models") {
            return Response.json({
              object: "list",
              data: [{ id: "llama3", object: "model" }],
            });
          }

          if (url.pathname === "/v1/responses") {
            return Response.json({ ok: true });
          }

          return new Response("Not Found", { status: 404 });
        },
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

class FailingWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FailingWebSocket.CONNECTING;
  #listeners = new Map<string, Set<(event?: Event) => void>>();

  constructor(_url: string | URL) {
    queueMicrotask(() => {
      this.readyState = FailingWebSocket.CLOSED;
      this.#emit("error");
      this.#emit("close");
    });
  }

  addEventListener(type: string, listener: (event?: Event) => void): void {
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: (event?: Event) => void): void {
    this.#listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.readyState = FailingWebSocket.CLOSED;
  }

  send(): void {}

  #emit(type: string): void {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(new Event(type));
    }
  }
}

describe("Participant session", () => {
  let hub: Hub;
  let client: ReturnType<typeof createClient>;
  let providerServer: ReturnType<typeof Bun.serve>;
  const originalWebSocket = globalThis.WebSocket;

  beforeAll(() => {
    hub = createHubWithRetry();
    client = createClient({ hubUrl: hub.url });
    providerServer = startProviderServer();
  });

  afterAll(() => {
    providerServer.stop(true);
    hub.close();
  });

  beforeEach(() => {
    Room.clear();
    globalThis.WebSocket = originalWebSocket;
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
  });

  test("rolls back the participant if the tunnel handshake fails", async () => {
    globalThis.WebSocket =
      FailingWebSocket as unknown as typeof globalThis.WebSocket;

    const created = await client.rooms.create({ name: "Handshake Failure" });

    await expect(
      createParticipantSession({
        hubUrl: hub.url,
        roomCode: created.data.room.code,
        participantId: "worker-1",
        nickname: "Worker 1",
        endpoint: `http://127.0.0.1:${providerServer.port}`,
        model: "llama3",
      })
    ).rejects.toThrow("Failed to open participant tunnel.");

    const participants = await client.participants.list(created.data.room.code);
    expect(participants.data).toHaveLength(0);
  });
});
