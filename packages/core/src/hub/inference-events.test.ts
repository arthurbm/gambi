import { expect } from "bun:test";
import type { RoomEvent } from "@gambi/protocol";
import { layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { layerHub, managementClient, watchRoom } from "../testing/hub.ts";
import { joinParticipant } from "../testing/participant.ts";
import { fakeProvider, openStream, sseEvent } from "../testing/provider.ts";
import { Hub } from "./hub.ts";

const UUID = /^[0-9a-f-]{36}$/;

const messages = [{ role: "user", content: "Oi" }];

/**
 * A room with one online participant in front of `provider`, a watch on its
 * events opened after the participant joined, and a way to call it.
 */
const makeRoom = (provider: { readonly url: string }) =>
  Effect.gen(function* () {
    const hub = yield* Hub;
    const client = yield* managementClient;
    const { room } = yield* client.rooms.create({ payload: { name: "Frevo" } });
    yield* joinParticipant({
      roomCode: room.code,
      participantId: "arthur-1",
      profile: { model: "llama3.1:8b" },
      provider: { endpoint: provider.url },
    });
    const watch = yield* watchRoom(room.code);
    /** The next `count` events of the room, as they came. */
    const nextEvents = (count: number) =>
      Effect.all(Array.from({ length: count }, () => watch.next));
    return {
      nextEvents,
      post: (path: string, body: object, signal?: AbortSignal) =>
        Effect.promise(() =>
          fetch(`${hub.url}/rooms/${room.code}/v1${path}`, {
            method: "POST",
            body: JSON.stringify(body),
            ...(signal === undefined ? {} : { signal }),
          })
        ),
    };
  });

const typesOf = (events: readonly RoomEvent[]) =>
  events.map((event) => event.type);

/** The events of `type` among `events`: a test asserts on the one it expects. */
const ofType = <Type extends RoomEvent["type"]>(
  events: readonly RoomEvent[],
  type: Type
) =>
  events.filter(
    (event): event is Extract<RoomEvent, { type: Type }> => event.type === type
  );

layer(layerHub(), { excludeTestServices: true })("request events", (it) => {
  it.effect(
    "a request that is answered tells the room when it starts and when it completes, with its metrics",
    () =>
      Effect.gen(function* () {
        const provider = yield* fakeProvider();
        const room = yield* makeRoom(provider);

        const response = yield* room.post("/chat/completions", {
          model: "model:llama3.1:8b",
          messages,
        });
        yield* Effect.promise(() => response.text());
        const events = yield* room.nextEvents(4);

        expect(typesOf(events)).toEqual([
          "participant.busy",
          "llm.request",
          "llm.complete",
          "participant.online",
        ]);
        const [started] = ofType(events, "llm.request");
        const [completed] = ofType(events, "llm.complete");
        expect(started).toMatchObject({
          participantId: "arthur-1",
          model: "llama3.1:8b",
          modelSelector: "model:llama3.1:8b",
          protocol: "chatCompletions",
        });
        expect(started?.requestId).toMatch(UUID);
        expect(completed).toMatchObject({
          requestId: started?.requestId,
          participantId: "arthur-1",
          model: "llama3.1:8b",
          protocol: "chatCompletions",
          status: 200,
          // What the fake provider reports in `usage`.
          metrics: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
        });
        expect(completed?.metrics.durationMs).toBeGreaterThanOrEqual(
          completed?.metrics.ttftMs ?? Number.NaN
        );
      })
  );

  it.effect(
    "a streamed Response completes too, with the time it took and no token counts",
    () =>
      Effect.gen(function* () {
        const provider = yield* fakeProvider();
        const room = yield* makeRoom(provider);

        const response = yield* room.post("/responses", {
          model: "arthur-1",
          input: "Oi",
          stream: true,
        });
        yield* Effect.promise(() => response.text());
        const events = yield* room.nextEvents(4);

        expect(typesOf(events)).toEqual([
          "participant.busy",
          "llm.request",
          "llm.complete",
          "participant.online",
        ]);
        const [completed] = ofType(events, "llm.complete");
        expect(completed?.protocol).toBe("openResponses");
        expect(Object.keys(completed?.metrics ?? {}).sort()).toEqual([
          "durationMs",
          "ttftMs",
        ]);
      })
  );

  it.effect(
    "a request that fails tells the room what went wrong, before the answer or in the middle of the stream",
    () =>
      Effect.gen(function* () {
        const stopped = yield* Effect.scoped(fakeProvider());
        const unreachable = yield* makeRoom(stopped);
        const generating = yield* openStream();
        const crashing = yield* fakeProvider({
          answer: () => generating.response,
        });
        const breaking = yield* makeRoom(crashing);
        yield* generating.send(sseEvent({ delta: "Olá" }));

        const refused = yield* unreachable.post("/chat/completions", {
          model: "arthur-1",
          messages,
        });
        yield* Effect.promise(() => refused.text());
        const streamed = yield* breaking.post("/chat/completions", {
          model: "arthur-1",
          stream: true,
          messages,
        });
        yield* generating.fail;
        yield* Effect.promise(() => streamed.text());

        const [beforeAnswer] = ofType(
          yield* unreachable.nextEvents(4),
          "llm.error"
        );
        const [inStream] = ofType(yield* breaking.nextEvents(4), "llm.error");
        expect(beforeAnswer).toMatchObject({
          participantId: "arthur-1",
          model: "llama3.1:8b",
          protocol: "chatCompletions",
          stage: "dispatch",
          code: "provider_unreachable",
          error: "The participant's provider did not answer the request.",
        });
        expect(inStream).toMatchObject({
          stage: "stream",
          code: "provider_response_interrupted",
        });
      })
  );

  it.effect("a request the app cancels ends for the room too", () =>
    Effect.gen(function* () {
      const generating = yield* openStream();
      const provider = yield* fakeProvider({
        answer: () => generating.response,
      });
      const room = yield* makeRoom(provider);
      const app = new AbortController();
      yield* generating.send(sseEvent({ delta: "Olá" }));
      const response = yield* room.post(
        "/chat/completions",
        { model: "arthur-1", stream: true, messages },
        app.signal
      );
      yield* Effect.promise(
        async () => await response.body?.getReader().read()
      );

      app.abort();
      const events = yield* room.nextEvents(4);

      expect(typesOf(events)).toEqual([
        "participant.busy",
        "llm.request",
        "llm.error",
        "participant.online",
      ]);
      expect(ofType(events, "llm.error")[0]).toMatchObject({
        stage: "stream",
        code: "request_cancelled",
      });
    })
  );
});
