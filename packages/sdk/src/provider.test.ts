import { describe, expect, test } from "bun:test";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub } from "@gambi/core/testing/hub";
import { joinParticipant } from "@gambi/core/testing/participant";
import {
  FAKE_COMPLETION_TEXT,
  fakeProvider,
} from "@gambi/core/testing/provider";
import { it, layer } from "@gambi/testing/effect";
import { generateText, streamText } from "ai";
import { Effect } from "effect";
import { createClient } from "./client.ts";
import { ClientError } from "./client-error.ts";
import { createGambi } from "./provider.ts";

const rejection = (call: () => Promise<unknown>) =>
  Effect.promise(() =>
    call().then(
      (value): ClientError => {
        throw new Error(`Expected a rejection, got ${JSON.stringify(value)}`);
      },
      (error: unknown): ClientError => {
        if (error instanceof ClientError) {
          return error;
        }
        throw error;
      }
    )
  );

/** A server on a free loopback port, stopped when the test ends. */
const serving = (fetch: (request: Request) => Response | Promise<Response>) =>
  Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch })),
    (server) => Effect.promise(() => server.stop(true))
  ).pipe(Effect.map((server) => `http://127.0.0.1:${server.port}`));

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

    it.effect("generates text through a participant of the room", () =>
      Effect.gen(function* () {
        const hub = yield* Hub;
        const client = createClient({ hubUrl: hub.url });
        const { room } = yield* Effect.promise(() =>
          client.rooms.create({ name: "Frevo" })
        );
        const local = yield* fakeProvider();
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "ze-1",
          profile: { model: "llama3" },
          provider: { endpoint: local.url },
        });
        const provider = createGambi({ hubUrl: hub.url, roomCode: room.code });

        const responses = yield* Effect.promise(() =>
          generateText({ model: provider.any(), prompt: "Oi" })
        );
        const chat = yield* Effect.promise(() =>
          generateText({
            model: provider.chatCompletions.model("llama3"),
            prompt: "Oi",
          })
        );
        const calls = yield* local.calls;

        expect(responses.text).toBe(FAKE_COMPLETION_TEXT);
        expect(chat.text).toBe(FAKE_COMPLETION_TEXT);
        expect(calls.map((call) => call.path)).toEqual([
          "/v1/responses",
          "/v1/chat/completions",
        ]);
      })
    );

    it.effect("streams text through a participant of the room", () =>
      Effect.gen(function* () {
        const hub = yield* Hub;
        const client = createClient({ hubUrl: hub.url });
        const { room } = yield* Effect.promise(() =>
          client.rooms.create({ name: "Frevo" })
        );
        const local = yield* fakeProvider();
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "ze-1",
          provider: { endpoint: local.url },
        });
        const provider = createGambi({ hubUrl: hub.url, roomCode: room.code });

        const pieces = yield* Effect.promise(async () => {
          const received: string[] = [];
          const answer = streamText({
            model: provider.chatCompletions.participant("ze-1"),
            prompt: "Oi",
          });
          for await (const piece of answer.textStream) {
            received.push(piece);
          }
          return received;
        });

        expect(pieces).toEqual(["Olá, ", "Recife!"]);
      })
    );

    it.effect("lists the models the room can be asked for", () =>
      Effect.gen(function* () {
        const hub = yield* Hub;
        const client = createClient({ hubUrl: hub.url });
        const { room } = yield* Effect.promise(() =>
          client.rooms.create({ name: "Frevo" })
        );
        const local = yield* fakeProvider();
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "ze-1",
          profile: { nickname: "Zé", model: "llama3" },
          provider: { endpoint: local.url },
        });
        yield* Effect.promise(() =>
          client.participants.register(room.code, "lia-1", {
            nickname: "Lia",
            model: "qwen3",
            runtimeId: "a-runtime",
            endpoint: "http://localhost:11434",
          })
        );
        const provider = createGambi({ hubUrl: hub.url, roomCode: room.code });

        const models = yield* Effect.promise(() => provider.listModels());

        // Lia registered and never opened a tunnel: offline, so not a model.
        expect(models).toEqual([
          {
            id: "ze-1",
            nickname: "Zé",
            model: "llama3",
            endpoint: local.url,
            capabilities: {
              openResponses: "unknown",
              chatCompletions: "unknown",
            },
            status: "online",
          },
        ]);
      })
    );

    it.effect(
      "listing the models of a room that does not exist rejects with the hub's error",
      () =>
        Effect.gen(function* () {
          const hub = yield* Hub;
          const provider = createGambi({ hubUrl: hub.url, roomCode: "NOPE00" });

          const error = yield* rejection(() => provider.listModels());

          expect(error).toMatchObject({
            code: "ROOM_NOT_FOUND",
            status: 404,
            message: "Room 'NOPE00' was not found.",
            details: { roomCode: "NOPE00" },
          });
        })
    );
  }
);

describe("inference provider away from a hub", () => {
  it.live(
    "listing the models where nothing listens is an unreachable hub",
    () =>
      Effect.gen(function* () {
        const hubUrl = yield* Effect.scoped(
          serving(() => new Response("gone"))
        );
        const provider = createGambi({ hubUrl, roomCode: "ABC123" });

        const error = yield* rejection(() => provider.listModels());

        expect(error.code).toBe("HUB_UNREACHABLE");
        expect(error.message).toBe(`Could not reach a hub at ${hubUrl}.`);
        expect(error.status).toBeUndefined();
        expect(error.details).toEqual({ hubUrl });
      })
  );

  it.live.each([
    {
      answer: "a web page",
      response: () =>
        new Response("<html></html>", {
          headers: { "content-type": "text/html" },
        }),
      message: (hubUrl: string) =>
        `The server at ${hubUrl} did not answer like a Gambi hub.`,
      status: undefined,
    },
    {
      answer: "a list that is not of models",
      response: () => Response.json({ data: "nothing" }),
      message: (hubUrl: string) =>
        `The server at ${hubUrl} did not answer like a Gambi hub.`,
      status: undefined,
    },
    {
      answer: "a status of its own",
      response: () => new Response("nope", { status: 404 }),
      message: (hubUrl: string) =>
        `The server at ${hubUrl} did not answer like a Gambi hub (HTTP 404).`,
      status: 404,
    },
  ])(
    "listing the models of a server that answers $answer is not a hub",
    ({ response, message, status }) =>
      Effect.gen(function* () {
        const hubUrl = yield* serving(response);
        const provider = createGambi({ hubUrl, roomCode: "ABC123" });

        const error = yield* rejection(() => provider.listModels());

        // biome-ignore lint/suspicious/noMisplacedAssertion: the helper runs this inside a test
        expect(error.code).toBe("NOT_A_HUB");
        // biome-ignore lint/suspicious/noMisplacedAssertion: the helper runs this inside a test
        expect(error.message).toBe(message(hubUrl));
        // biome-ignore lint/suspicious/noMisplacedAssertion: the helper runs this inside a test
        expect(error.status).toBe(status);
        // biome-ignore lint/suspicious/noMisplacedAssertion: the helper runs this inside a test
        expect(error.details).toEqual({ hubUrl });
      })
  );
});
