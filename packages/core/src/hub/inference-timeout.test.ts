import { expect } from "bun:test";
import { it } from "@gambi/testing/effect";
import { type Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { layerHub, managementClient } from "../testing/hub.ts";
import { joinParticipant } from "../testing/participant.ts";
import { fakeProvider, openStream, sseEvent } from "../testing/provider.ts";
import { Hub } from "./hub.ts";

// Each test builds its own hub inside `it.effect`, so the hub reads the test
// clock. The tunnel's ping is out of the way: a jump of the clock would drop
// the tunnel on a ping timeout before the inactivity timeout had its say.
const layerHubOnTestClock = (
  options: { readonly inferenceIdleTimeout?: Duration.Input } = {}
) => layerHub({ tunnelPingInterval: "1 hour", ...options });

const messages = [{ role: "user", content: "Oi" }];

/** A room with one participant in front of `provider`, and a way to call it. */
const makeRoom = (provider: { readonly url: string }) =>
  Effect.gen(function* () {
    const hub = yield* Hub;
    const client = yield* managementClient;
    const { room } = yield* client.rooms.create({ payload: { name: "Frevo" } });
    yield* joinParticipant({
      roomCode: room.code,
      participantId: "arthur-1",
      provider: { endpoint: provider.url },
    });
    return {
      chatCompletion: (stream: boolean) =>
        Effect.promise(() =>
          fetch(`${hub.url}/rooms/${room.code}/v1/chat/completions`, {
            method: "POST",
            body: JSON.stringify({ model: "arthur-1", stream, messages }),
          })
        ),
      status: client.participants
        .list({ params: { code: room.code } })
        .pipe(Effect.map(([participant]) => participant?.status)),
    };
  });

/** The answer of a provider that never answers. */
const stillThinking = new Promise<Response>(() => undefined);

it.effect(
  "a request the participant does not answer ends after 5 minutes without a chunk, by default",
  () =>
    Effect.gen(function* () {
      const provider = yield* fakeProvider({ answer: () => stillThinking });
      const room = yield* makeRoom(provider);

      const request = yield* Effect.forkChild(room.chatCompletion(false));
      const call = yield* provider.nextCall;
      yield* TestClock.adjust("299 seconds");
      // Not yet: the participant is still on the request.
      expect(yield* room.status).toBe("busy");

      yield* TestClock.adjust("1 second");

      const response = yield* Fiber.join(request);
      expect(response.status).toBe(504);
      const body = (yield* Effect.promise(() => response.json())) as {
        readonly error: { readonly code: string; readonly message: string };
      };
      expect(body.error.code).toBe("inference_timeout");
      expect(body.error.message).toBe(
        "Participant 'arthur-1' sent nothing for 300 seconds; the request was cancelled."
      );
      // The request stopped on the other side too, and the participant is free.
      yield* call.aborted;
      expect(yield* room.status).toBe("online");
    }).pipe(Effect.provide(layerHubOnTestClock()))
);

it.effect(
  "the timeout counts the time without a chunk, not the length of the answer, and a stream that goes quiet ends with a named error",
  () =>
    Effect.gen(function* () {
      const generating = yield* openStream();
      const provider = yield* fakeProvider({
        answer: () => generating.response,
      });
      const room = yield* makeRoom(provider);
      yield* generating.send(sseEvent({ delta: "Olá, " }));

      const response = yield* room.chatCompletion(true);
      const reader = response.body?.getReader();
      if (reader === undefined) {
        return yield* Effect.die(new Error("The response has no body."));
      }
      const decoder = new TextDecoder();
      const nextPiece = Effect.promise(() => reader.read()).pipe(
        Effect.map(({ value }) => decoder.decode(value))
      );
      expect(yield* nextPiece).toBe(sseEvent({ delta: "Olá, " }));
      const call = yield* provider.nextCall;

      // Four minutes of silence, a chunk, four more minutes: eight minutes
      // of answer, and never five without a chunk.
      yield* TestClock.adjust("4 minutes");
      yield* generating.send(sseEvent({ delta: "Recife!" }));
      expect(yield* nextPiece).toBe(sseEvent({ delta: "Recife!" }));
      yield* TestClock.adjust("4 minutes");
      expect(yield* room.status).toBe("busy");

      yield* TestClock.adjust("1 minute");

      const last = yield* nextPiece;
      expect(last.startsWith("event: error\ndata: ")).toBe(true);
      expect(JSON.parse(last.slice("event: error\ndata: ".length)).code).toBe(
        "inference_timeout"
      );
      expect((yield* Effect.promise(() => reader.read())).done).toBe(true);
      yield* call.aborted;
      expect(yield* room.status).toBe("online");
    }).pipe(Effect.provide(layerHubOnTestClock()))
);

it.effect(
  "a Response that goes through Chat Completions and goes quiet ends with a named error too",
  () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      const client = yield* managementClient;
      const generating = yield* openStream();
      const provider = yield* fakeProvider({
        answer: () => generating.response,
      });
      const { room } = yield* client.rooms.create({
        payload: { name: "Frevo" },
      });
      yield* joinParticipant({
        roomCode: room.code,
        participantId: "arthur-1",
        profile: {
          capabilities: {
            openResponses: "unsupported",
            chatCompletions: "supported",
          },
        },
        provider: { endpoint: provider.url },
      });
      const status = client.participants
        .list({ params: { code: room.code } })
        .pipe(Effect.map(([participant]) => participant?.status));
      yield* generating.send(
        sseEvent({ choices: [{ index: 0, delta: { content: "Olá" } }] })
      );

      const response = yield* Effect.promise(() =>
        fetch(`${hub.url}/rooms/${room.code}/v1/responses`, {
          method: "POST",
          body: JSON.stringify({
            model: "arthur-1",
            input: "Oi",
            stream: true,
          }),
        })
      );
      const reader = response.body?.getReader();
      if (reader === undefined) {
        return yield* Effect.die(new Error("The response has no body."));
      }
      const decoder = new TextDecoder();
      let read = "";
      const readUntil = (text: string) =>
        Effect.promise(async () => {
          while (!read.includes(text)) {
            const { done, value } = await reader.read();
            if (done) {
              return;
            }
            read += decoder.decode(value, { stream: true });
          }
        });
      yield* readUntil("response.output_text.delta");
      const call = yield* provider.nextCall;

      yield* TestClock.adjust("299 seconds");
      expect(yield* status).toBe("busy");
      yield* TestClock.adjust("1 second");

      yield* readUntil("event: error");
      const last = read.slice(read.lastIndexOf("data: ") + "data: ".length);
      expect(JSON.parse(last)).toMatchObject({
        type: "error",
        code: "inference_timeout",
        sequence_number: 4,
      });
      expect((yield* Effect.promise(() => reader.read())).done).toBe(true);
      yield* call.aborted;
      expect(yield* status).toBe("online");
    }).pipe(Effect.provide(layerHubOnTestClock()))
);

it.effect("the hub is started with the timeout it should use", () =>
  Effect.gen(function* () {
    const provider = yield* fakeProvider({ answer: () => stillThinking });
    const room = yield* makeRoom(provider);

    const request = yield* Effect.forkChild(room.chatCompletion(true));
    yield* provider.nextCall;
    yield* TestClock.adjust("29 seconds");
    expect(yield* room.status).toBe("busy");
    yield* TestClock.adjust("1 second");

    const response = yield* Fiber.join(request);
    expect(response.status).toBe(504);
    const body = (yield* Effect.promise(() => response.json())) as {
      readonly error: { readonly message: string };
    };
    expect(body.error.message).toBe(
      "Participant 'arthur-1' sent nothing for 30 seconds; the request was cancelled."
    );
  }).pipe(
    Effect.provide(layerHubOnTestClock({ inferenceIdleTimeout: "30 seconds" }))
  )
);
