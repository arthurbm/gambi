import { expect } from "bun:test";
import type { ParticipantStatus } from "@gambi/protocol";
import { layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { layerHub, managementClient } from "../testing/hub.ts";
import { joinParticipant } from "../testing/participant.ts";
import {
  FAKE_COMPLETION_TEXT,
  fakeProvider,
  openStream,
  sseEvent,
} from "../testing/provider.ts";
import { Hub } from "./hub.ts";

/** A new room, the URL of its inference plane and the status of its participants. */
const makeRoom = (name: string) =>
  Effect.gen(function* () {
    const hub = yield* Hub;
    const client = yield* managementClient;
    const { room } = yield* client.rooms.create({ payload: { name } });
    const statusOf = (participantId: string) =>
      client.participants
        .list({ params: { code: room.code } })
        .pipe(
          Effect.map(
            (participants) =>
              participants.find(
                (participant) => participant.id === participantId
              )?.status
          )
        );
    return {
      code: room.code,
      /** The URL of a route of the room's inference plane, for example `url("/chat/completions")`. */
      url: (path: string) => `${hub.url}/rooms/${room.code}/v1${path}`,
      statusOf,
      /**
       * Returns once the participant has the status. A status changes a
       * moment after what causes it, so this asks the hub until it does.
       */
      awaitStatus: (participantId: string, status: ParticipantStatus) =>
        statusOf(participantId).pipe(
          Effect.repeat({ until: (current) => current === status })
        ),
    };
  });

const decoder = new TextDecoder();

/** An app calling the inference plane: a plain `fetch`, as the OpenAI SDK does. */
const post = (url: string, body: unknown, signal?: AbortSignal) =>
  Effect.promise(() =>
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    })
  );

/** The JSON body of a response. A test asserts on what it expects to find there. */
const json = (response: Response): Effect.Effect<any> =>
  Effect.promise(() => response.json());

const messages = [{ role: "user", content: "Oi" }];

layer(layerHub(), { excludeTestServices: true })("inference plane", (it) => {
  it.effect(
    "a chat completion goes to the participant's provider and its answer comes back",
    () =>
      Effect.gen(function* () {
        const room = yield* makeRoom("Maracatu");
        const provider = yield* fakeProvider();
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
          profile: { model: "llama3.1:8b" },
          provider: { endpoint: provider.url },
        });

        const response = yield* post(room.url("/chat/completions"), {
          model: "arthur-1",
          messages,
        });
        const completion = yield* json(response);

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("application/json");
        expect(completion.object).toBe("chat.completion");
        expect(completion.choices[0].message.content).toBe(
          FAKE_COMPLETION_TEXT
        );
        const call = yield* provider.nextCall;
        expect(call.method).toBe("POST");
        expect(call.path).toBe("/v1/chat/completions");
        expect(call.headers["content-type"]).toBe("application/json");
        // The provider is asked for its own model, not for the selector.
        expect(call.body).toEqual({ model: "llama3.1:8b", messages });
        yield* room.awaitStatus("arthur-1", "online");
      })
  );

  it.effect(
    "cancelling the HTTP request in the middle of a streamed body aborts the request to the provider and frees the participant",
    () =>
      Effect.gen(function* () {
        const room = yield* makeRoom("Frevo");
        const generating = yield* openStream();
        const provider = yield* fakeProvider({
          answer: () => generating.response,
        });
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
          provider: { endpoint: provider.url },
        });
        const app = new AbortController();
        // A provider sends its response head with the first piece of the body.
        yield* generating.send(sseEvent({ delta: "Olá" }));

        const response = yield* post(
          room.url("/chat/completions"),
          {
            model: "arthur-1",
            stream: true,
            messages: [{ role: "user", content: "Oi" }],
          },
          app.signal
        );
        const reader = response.body?.getReader();
        const first = yield* Effect.promise(async () => await reader?.read());
        const call = yield* provider.nextCall;

        expect(response.status).toBe(200);
        expect(decoder.decode(first?.value)).toBe(sseEvent({ delta: "Olá" }));
        expect(yield* room.statusOf("arthur-1")).toBe("busy");

        app.abort();

        // The provider sees its request go away: the handler on the
        // participant was interrupted and took the request with it.
        yield* call.aborted;
        yield* room.awaitStatus("arthur-1", "online");
      })
  );
});
