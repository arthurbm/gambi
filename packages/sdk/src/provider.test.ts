import { describe, expect, test } from "bun:test";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub } from "@gambi/core/testing/hub";
import { joinParticipant } from "@gambi/core/testing/participant";
import { layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { createClient } from "./client.ts";
import { ClientError } from "./client-error.ts";
import { createGambi } from "./provider.ts";

describe("inference provider", () => {
  test("defaults to OpenResponses", () => {
    const provider = createGambi({ roomCode: "ABC123" });

    expect(provider.defaultProtocol).toBe("openResponses");
    expect(provider.baseURL).toBe("http://localhost:3000/rooms/ABC123/v1");
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
});

layer(layerHub(), { excludeTestServices: true })(
  "inference provider against a hub",
  (it) => {
    it.effect("lists the participants of its room", () =>
      Effect.gen(function* () {
        const hub = yield* Hub;
        const client = createClient({ hubUrl: hub.url });
        const { room } = yield* Effect.promise(() =>
          client.rooms.create({ name: "Frevo" })
        );
        yield* joinParticipant({ roomCode: room.code, participantId: "ze-1" });
        const provider = createGambi({ hubUrl: hub.url, roomCode: room.code });

        const participants = yield* Effect.promise(() =>
          provider.listParticipants()
        );

        expect(participants.map(({ id, status }) => ({ id, status }))).toEqual([
          { id: "ze-1", status: "online" },
        ]);
      })
    );

    it.effect("a room that does not exist rejects with the hub's error", () =>
      Effect.gen(function* () {
        const hub = yield* Hub;
        const provider = createGambi({ hubUrl: hub.url, roomCode: "NOPE00" });

        const error = yield* Effect.promise(() =>
          provider.listParticipants().then(
            () => undefined,
            (rejected: unknown) => rejected
          )
        );

        expect(error).toBeInstanceOf(ClientError);
        expect(error).toMatchObject({
          code: "ROOM_NOT_FOUND",
          status: 404,
          details: { roomCode: "NOPE00" },
        });
      })
    );
  }
);
