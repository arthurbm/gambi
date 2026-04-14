import { afterEach, describe, expect, test } from "bun:test";
import type { ClientError } from "./client.ts";
import { createGambi } from "./provider.ts";

const originalFetch = globalThis.fetch;

describe("SDK provider", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("defaults to OpenResponses", () => {
    const provider = createGambi({ roomCode: "ABC123" });

    expect(provider.defaultProtocol).toBe("openResponses");
    expect(provider.openResponses.any()).toBeDefined();
    expect(provider.chatCompletions.any()).toBeDefined();
    expect(provider.any()).toBeDefined();
  });

  test("supports explicit legacy chat/completions mode", () => {
    const provider = createGambi({
      roomCode: "ABC123",
      defaultProtocol: "chatCompletions",
    });

    expect(provider.defaultProtocol).toBe("chatCompletions");
    expect(provider.participant("participant-1")).toBeDefined();
    expect(provider.model("llama3")).toBeDefined();
  });

  test("surfaces typed management errors from listParticipants", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "ROOM_NOT_FOUND",
            message: "Room not found.",
            hint: "Run 'gambi room list' to inspect available rooms.",
          },
          meta: { requestId: "req_123" },
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }
      )) as typeof fetch;

    const provider = createGambi({ roomCode: "ABC123" });

    await expect(provider.listParticipants()).rejects.toMatchObject({
      name: "ClientError",
      status: 404,
      code: "ROOM_NOT_FOUND",
      hint: "Run 'gambi room list' to inspect available rooms.",
      requestId: "req_123",
    } satisfies Partial<ClientError>);
  });
});
