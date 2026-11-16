import { expect } from "bun:test";
import {
  type InferenceChunk,
  type ParticipantStatus,
  ProviderResponseInterrupted,
  TunnelRpcs,
} from "@gambi/protocol";
import { layer } from "@gambi/testing/effect";
import { Effect, Fiber, Stream } from "effect";
import { layerHub, managementClient } from "../testing/hub.ts";
import { joinParticipant } from "../testing/participant.ts";
import {
  FAKE_COMPLETION_TEXT,
  fakeProvider,
  jsonAnswer,
  openAiAnswer,
  openStream,
  sseEvent,
} from "../testing/provider.ts";
import { Hub } from "./hub.ts";
import { Tunnels } from "./tunnels.ts";

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

/** The answer of a provider that never answers. */
const stillThinking = new Promise<Response>(() => undefined);

/** The reader of a response body, as far as these tests use it. */
interface BodyReader {
  read(): Promise<{ done: boolean; value?: Uint8Array | undefined }>;
}

/** Reads a response body to its end, as text. */
const readToEnd = (reader: BodyReader) =>
  Effect.promise(async () => {
    const streamDecoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return text + streamDecoder.decode(new Uint8Array());
      }
      text += streamDecoder.decode(value, { stream: true });
    }
  });

/** The last server-sent event of a body: its name and its data, parsed. */
const lastEvent = (body: string) => {
  const event = body.trimEnd().split("\n\n").at(-1) ?? "";
  const field = (name: string) =>
    event
      .split("\n")
      .find((line) => line.startsWith(`${name}: `))
      ?.slice(name.length + 2);
  return { event: field("event"), data: JSON.parse(field("data") ?? "null") };
};

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

  it.effect(
    "an app that stops reading a streamed body gets its request cancelled, and the participant's tunnel stays open",
    () =>
      Effect.gen(function* () {
        const tunnels = yield* Tunnels;
        const room = yield* makeRoom("Coco");
        // A provider that produces as fast as it is read, and never ends.
        const piece = new TextEncoder().encode(
          sseEvent({ delta: "x".repeat(64 * 1024) })
        );
        const provider = yield* fakeProvider({
          answer: () =>
            new Response(
              new ReadableStream<Uint8Array>({
                pull: (controller) => controller.enqueue(piece),
              }),
              { headers: { "Content-Type": "text/event-stream" } }
            ),
        });
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
          provider: { endpoint: provider.url },
        });

        const response = yield* post(room.url("/chat/completions"), {
          model: "arthur-1",
          stream: true,
          messages,
        });
        const reader = response.body?.getReader();
        if (reader === undefined) {
          return yield* Effect.die(new Error("The response has no body."));
        }
        yield* Effect.promise(() => reader.read());
        // The app reads nothing more. The hub does not hold without limit
        // what the provider keeps sending: it stops the provider.
        const call = yield* provider.nextCall;
        yield* call.aborted;
        yield* room.awaitStatus("arthur-1", "online");

        // The tunnel never waited for the app: it is as good as before.
        const tunnel = yield* tunnels.client(room.code, "arthur-1");
        expect(yield* tunnel.Echo({ text: "segue" })).toBe("segue");
        // What was waiting is still delivered, and the reason comes last.
        const rest = yield* readToEnd(reader);
        expect(lastEvent(rest).event).toBe("error");
        expect(lastEvent(rest).data.code).toBe("consumer_too_slow");
      })
  );

  it.effect(
    "a streamed chat completion arrives as the provider sent it, and the participant is free when it ends",
    () =>
      Effect.gen(function* () {
        const room = yield* makeRoom("Ciranda");
        const provider = yield* fakeProvider();
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
          provider: { endpoint: provider.url },
        });

        const response = yield* post(room.url("/chat/completions"), {
          model: "arthur-1",
          stream: true,
          messages,
        });
        const body = yield* Effect.promise(() => response.text());

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toBe("text/event-stream");
        const sent = yield* Effect.promise(() =>
          openAiAnswer({
            method: "POST",
            path: "/v1/chat/completions",
            headers: {},
            body: { model: "test-model", stream: true },
            aborted: Effect.never,
          }).text()
        );
        expect(body).toBe(sent);
        expect(body.endsWith("data: [DONE]\n\n")).toBe(true);
        expect(yield* room.statusOf("arthur-1")).toBe("online");
      })
  );

  it.effect("a Response is created by the participant's provider", () =>
    Effect.gen(function* () {
      const room = yield* makeRoom("Caboclinho");
      const provider = yield* fakeProvider();
      yield* joinParticipant({
        roomCode: room.code,
        participantId: "arthur-1",
        profile: { model: "gpt-4.1" },
        provider: { endpoint: provider.url },
      });

      const response = yield* post(room.url("/responses"), {
        model: "arthur-1",
        input: "Oi",
      });
      const created = yield* json(response);

      expect(response.status).toBe(200);
      expect(created.object).toBe("response");
      expect(created.output[0].content[0].text).toBe(FAKE_COMPLETION_TEXT);
      const call = yield* provider.nextCall;
      expect(call.path).toBe("/v1/responses");
      expect(call.body).toEqual({ model: "gpt-4.1", input: "Oi" });
      expect(yield* room.statusOf("arthur-1")).toBe("online");
    })
  );

  it.effect("a streamed Response arrives event by event", () =>
    Effect.gen(function* () {
      const room = yield* makeRoom("Xote");
      const provider = yield* fakeProvider();
      yield* joinParticipant({
        roomCode: room.code,
        participantId: "arthur-1",
        provider: { endpoint: provider.url },
      });

      const response = yield* post(room.url("/responses"), {
        model: "arthur-1",
        input: "Oi",
        stream: true,
      });
      const body = yield* Effect.promise(() => response.text());

      expect(response.headers.get("content-type")).toBe("text/event-stream");
      expect(
        body
          .split("\n")
          .filter((line) => line.startsWith("event: "))
          .map((line) => line.slice("event: ".length))
      ).toEqual([
        "response.created",
        "response.output_text.delta",
        "response.output_text.delta",
        "response.completed",
      ]);
      expect(lastEvent(body).data.response.status).toBe("completed");
    })
  );

  it.effect(
    "the models of a room are its participants that can take a request",
    () =>
      Effect.gen(function* () {
        const tunnels = yield* Tunnels;
        const client = yield* managementClient;
        const room = yield* makeRoom("Baião");
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
          profile: {
            nickname: "Arthur",
            model: "llama3.1:8b",
            endpoint: "http://127.0.0.1:11434",
            capabilities: {
              openResponses: "unsupported",
              chatCompletions: "supported",
            },
          },
        });
        const gone = yield* joinParticipant({
          roomCode: room.code,
          participantId: "gone-1",
        });
        yield* gone.stop;
        yield* tunnels.awaitDrop(room.code, "gone-1");
        const [arthur] = yield* client.participants.list({
          params: { code: room.code },
        });

        const response = yield* Effect.promise(() =>
          fetch(room.url("/models"))
        );

        expect(response.status).toBe(200);
        expect(yield* json(response)).toEqual({
          object: "list",
          data: [
            {
              id: "arthur-1",
              object: "model",
              created: Math.floor((arthur?.joinedAt ?? 0) / 1000),
              owned_by: "Arthur",
              gambi: {
                nickname: "Arthur",
                model: "llama3.1:8b",
                endpoint: "http://127.0.0.1:11434",
                capabilities: {
                  openResponses: "unsupported",
                  chatCompletions: "supported",
                },
                status: "online",
              },
            },
          ],
        });
      })
  );

  it.effect("a model selector picks the participant that answers", () =>
    Effect.gen(function* () {
      const room = yield* makeRoom("Forró");
      const llama = yield* fakeProvider();
      const qwen = yield* fakeProvider();
      yield* joinParticipant({
        roomCode: room.code,
        participantId: "arthur-1",
        profile: { model: "llama3.1:8b" },
        provider: { endpoint: llama.url },
      });
      yield* joinParticipant({
        roomCode: room.code,
        participantId: "bia-1",
        profile: { model: "qwen2.5-coder" },
        provider: { endpoint: qwen.url },
      });
      /** Sends a request with the selector and says which provider got it. */
      const answeredBy = (model: string) =>
        Effect.gen(function* () {
          const response = yield* post(room.url("/chat/completions"), {
            model,
            messages,
          });
          yield* Effect.promise(() => response.text());
          const [toLlama, toQwen] = [yield* llama.calls, yield* qwen.calls];
          return {
            status: response.status,
            llama: toLlama.length,
            qwen: toQwen.length,
          };
        });

      // By participant id.
      expect(yield* answeredBy("bia-1")).toEqual({
        status: 200,
        llama: 0,
        qwen: 1,
      });
      // By model, with the prefix.
      expect(yield* answeredBy("model:llama3.1:8b")).toEqual({
        status: 200,
        llama: 1,
        qwen: 1,
      });
      // By the bare name of the model, as an OpenAI client sends it.
      expect(yield* answeredBy("qwen2.5-coder")).toEqual({
        status: 200,
        llama: 1,
        qwen: 2,
      });
      // Any participant: one of the two.
      const afterStar = yield* answeredBy("*");
      expect(afterStar.status).toBe(200);
      expect(afterStar.llama + afterStar.qwen).toBe(4);
      const afterAny = yield* answeredBy("any");
      expect(afterAny.status).toBe(200);
      expect(afterAny.llama + afterAny.qwen).toBe(5);
    })
  );

  it.effect(
    "only an online participant gets a request: a busy one and an offline one are named, and no wildcard reaches them",
    () =>
      Effect.gen(function* () {
        const tunnels = yield* Tunnels;
        const room = yield* makeRoom("Afoxé");
        const generating = yield* openStream();
        const provider = yield* fakeProvider({
          answer: () => generating.response,
        });
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "busy-1",
          profile: { model: "llama3.1:8b" },
          provider: { endpoint: provider.url },
        });
        const offline = yield* joinParticipant({
          roomCode: room.code,
          participantId: "offline-1",
          profile: { model: "llama3.1:8b" },
        });
        yield* offline.stop;
        yield* tunnels.awaitDrop(room.code, "offline-1");
        yield* generating.send(sseEvent({ delta: "Olá" }));
        const inFlight = yield* post(room.url("/chat/completions"), {
          model: "busy-1",
          stream: true,
          messages,
        });
        expect(yield* room.statusOf("busy-1")).toBe("busy");
        /** The status and the error code a request with the selector gets. */
        const refusal = (model: string) =>
          Effect.gen(function* () {
            const response = yield* post(room.url("/chat/completions"), {
              model,
              messages,
            });
            const body = yield* json(response);
            return [response.status, body.error.code];
          });

        expect(yield* refusal("busy-1")).toEqual([409, "participant_busy"]);
        expect(yield* refusal("offline-1")).toEqual([
          503,
          "participant_offline",
        ]);
        expect(yield* refusal("*")).toEqual([404, "model_not_found"]);
        expect(yield* refusal("model:llama3.1:8b")).toEqual([
          404,
          "model_not_found",
        ]);
        expect(yield* refusal("llama3.1:8b")).toEqual([404, "model_not_found"]);
        expect(yield* refusal("nobody")).toEqual([404, "model_not_found"]);
        // One request reached the provider: the one in flight.
        expect((yield* provider.calls).length).toBe(1);

        // When that request ends, the participant takes requests again.
        yield* generating.end;
        yield* Effect.promise(() => inFlight.text());
        expect(yield* room.statusOf("busy-1")).toBe("online");
      })
  );

  it.effect("an error has the shape of an OpenAI error", () =>
    Effect.gen(function* () {
      const room = yield* makeRoom("Maxixe");

      const response = yield* post(room.url("/chat/completions"), {
        model: "nobody",
        messages,
      });

      expect(response.status).toBe(404);
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(yield* json(response)).toEqual({
        error: {
          message: `No participant of room '${room.code}' is available for model 'nobody'.`,
          type: "invalid_request_error",
          param: null,
          code: "model_not_found",
        },
      });
    })
  );

  it.effect("a room that does not exist is a named 404", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;

      const completion = yield* post(
        `${hub.url}/rooms/NOPE00/v1/chat/completions`,
        { model: "*", messages }
      );
      const models = yield* Effect.promise(() =>
        fetch(`${hub.url}/rooms/NOPE00/v1/models`)
      );

      expect(completion.status).toBe(404);
      expect((yield* json(completion)).error.code).toBe("room_not_found");
      expect(models.status).toBe(404);
      expect((yield* json(models)).error.code).toBe("room_not_found");
    })
  );

  it.effect(
    "the hub checks only model and stream: a field it does not know reaches the provider as it came",
    () =>
      Effect.gen(function* () {
        const room = yield* makeRoom("Lundu");
        const provider = yield* fakeProvider();
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
          provider: { endpoint: provider.url },
        });
        const unknownToTheHub = {
          messages: [
            { role: "user", content: [{ type: "text", text: "Oi" }], name: 7 },
          ],
          temperature: "hot",
          logit_bias: { "50256": -100 },
          vendor_options: { nested: [1, null, "x", { deep: true }] },
          stream_options: { include_usage: true },
          tools: [{ type: "function", function: { name: "f" } }],
        };

        const response = yield* post(room.url("/chat/completions"), {
          model: "arthur-1",
          stream: false,
          ...unknownToTheHub,
        });

        expect(response.status).toBe(200);
        expect((yield* provider.nextCall).body).toEqual({
          model: "test-model",
          stream: false,
          ...unknownToTheHub,
        });
      })
  );

  it.effect(
    "a body the hub cannot route is refused before any participant is asked",
    () =>
      Effect.gen(function* () {
        const room = yield* makeRoom("Samba de coco");
        const provider = yield* fakeProvider();
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
          provider: { endpoint: provider.url },
        });
        /** The status and the error of a request with this body, sent as it is. */
        const refusal = (body: string) =>
          Effect.gen(function* () {
            const response = yield* Effect.promise(() =>
              fetch(room.url("/chat/completions"), { method: "POST", body })
            );
            const { error } = yield* json(response);
            return [response.status, error.code, error.param];
          });

        expect(yield* refusal("{not json")).toEqual([
          400,
          "invalid_request",
          null,
        ]);
        expect(yield* refusal(JSON.stringify(["*"]))).toEqual([
          400,
          "invalid_request",
          null,
        ]);
        expect(yield* refusal(JSON.stringify({ messages }))).toEqual([
          400,
          "invalid_request",
          "model",
        ]);
        expect(
          yield* refusal(JSON.stringify({ model: "*", stream: "yes" }))
        ).toEqual([400, "invalid_request", "stream"]);
        expect(yield* provider.calls).toEqual([]);
        expect(yield* room.statusOf("arthur-1")).toBe("online");
      })
  );

  it.effect(
    "what the app left out is filled from the defaults of the room and of the participant, and the participant's win",
    () =>
      Effect.gen(function* () {
        const hub = yield* Hub;
        const client = yield* managementClient;
        const { room } = yield* client.rooms.create({
          payload: {
            name: "Pastoril",
            defaults: {
              instructions: "Responda como quem é do Recife.",
              temperature: 0.2,
              max_tokens: 100,
              stop: ["FIM"],
            },
          },
        });
        const provider = yield* fakeProvider();
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
          profile: { model: "llama3.1:8b", config: { temperature: 0.7 } },
          provider: { endpoint: provider.url },
        });
        const url = (path: string) => `${hub.url}/rooms/${room.code}/v1${path}`;
        const sentToProvider = (path: string, body: object) =>
          Effect.gen(function* () {
            const response = yield* post(url(path), body);
            yield* Effect.promise(() => response.text());
            return (yield* provider.nextCall).body;
          });

        expect(
          yield* sentToProvider("/chat/completions", {
            model: "arthur-1",
            messages,
          })
        ).toEqual({
          model: "llama3.1:8b",
          messages: [
            { role: "system", content: "Responda como quem é do Recife." },
            ...messages,
          ],
          temperature: 0.7,
          max_tokens: 100,
          stop: ["FIM"],
        });
        // What the app said stays as the app said it.
        const own = {
          model: "arthur-1",
          messages: [{ role: "system", content: "Seja breve." }, ...messages],
          temperature: 1.5,
          max_tokens: 5,
          stop: "\n",
        };
        expect(yield* sentToProvider("/chat/completions", own)).toEqual({
          ...own,
          model: "llama3.1:8b",
        });
        // The Responses API takes the same defaults under its own names.
        expect(
          yield* sentToProvider("/responses", {
            model: "arthur-1",
            input: "Oi",
            temperature: null,
          })
        ).toEqual({
          model: "llama3.1:8b",
          input: "Oi",
          instructions: "Responda como quem é do Recife.",
          temperature: 0.7,
          max_output_tokens: 100,
          stop_sequences: ["FIM"],
        });
      })
  );

  it.effect(
    "ParticipantAuthHeaders go to the provider and to nowhere else",
    () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const room = yield* makeRoom("Reisado");
        const provider = yield* fakeProvider();
        const secret = "Bearer segredo-do-arthur";
        const participant = yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
          provider: {
            endpoint: provider.url,
            authHeaders: { Authorization: secret, "X-Org": "gambiarra" },
          },
        });

        const response = yield* post(room.url("/chat/completions"), {
          model: "arthur-1",
          stream: true,
          messages,
        });
        const body = yield* Effect.promise(() => response.text());
        const models = yield* Effect.promise(() =>
          fetch(room.url("/models")).then((answer) => answer.text())
        );
        const listed = yield* client.participants.list({
          params: { code: room.code },
        });

        const call = yield* provider.nextCall;
        expect(call.headers.authorization).toBe(secret);
        expect(call.headers["x-org"]).toBe("gambiarra");
        // Nothing the runtime sent to the hub, and nothing the hub shows,
        // carries them.
        const leaked = [
          ...(yield* participant.sentToHub),
          body,
          models,
          JSON.stringify(listed),
          JSON.stringify([...response.headers]),
        ].filter(
          (text) => text.includes("segredo-do-arthur") || text.includes("X-Org")
        );
        expect(leaked).toEqual([]);
        // The request to the provider carries nothing of the hub either,
        // such as trace headers: only what an HTTP client sends by itself.
        const ofAnyHttpClient = new Set([
          "accept",
          "accept-encoding",
          "connection",
          "content-length",
          "content-type",
          "host",
          "user-agent",
        ]);
        expect(
          Object.keys(call.headers).filter((name) => !ofAnyHttpClient.has(name))
        ).toEqual(["authorization", "x-org"]);
      })
  );

  it.effect(
    "an error the provider answers with passes through with its status and its body",
    () =>
      Effect.gen(function* () {
        const room = yield* makeRoom("Mazurca");
        const refused = {
          error: {
            message: "You exceeded your current quota.",
            type: "insufficient_quota",
            param: null,
            code: "insufficient_quota",
          },
        };
        const provider = yield* fakeProvider({
          answer: () => jsonAnswer(refused, 429),
        });
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
          provider: { endpoint: provider.url },
        });

        const response = yield* post(room.url("/chat/completions"), {
          model: "arthur-1",
          stream: true,
          messages,
        });

        expect(response.status).toBe(429);
        expect(yield* json(response)).toEqual(refused);
        expect(yield* room.statusOf("arthur-1")).toBe("online");
      })
  );

  it.effect("a provider that does not answer is a named 502", () =>
    Effect.gen(function* () {
      const room = yield* makeRoom("Toré");
      // A provider that was there and is gone: nothing listens on its port.
      const stopped = yield* Effect.scoped(fakeProvider());
      yield* joinParticipant({
        roomCode: room.code,
        participantId: "arthur-1",
        provider: { endpoint: stopped.url },
      });

      const response = yield* post(room.url("/chat/completions"), {
        model: "arthur-1",
        messages,
      });

      expect(response.status).toBe(502);
      expect((yield* json(response)).error.code).toBe("provider_unreachable");
      expect(yield* room.statusOf("arthur-1")).toBe("online");
    })
  );

  it.effect(
    "a participant that shares no model endpoint refuses inference with a named error",
    () =>
      Effect.gen(function* () {
        const room = yield* makeRoom("Guerreiro");
        yield* joinParticipant({ roomCode: room.code, participantId: "h-1" });

        const response = yield* post(room.url("/chat/completions"), {
          model: "h-1",
          messages,
        });

        expect(response.status).toBe(400);
        expect((yield* json(response)).error.code).toBe(
          "inference_not_supported"
        );
        expect(yield* room.statusOf("h-1")).toBe("online");
      })
  );

  it.effect(
    "a browser app on another origin may call the inference plane",
    () =>
      Effect.gen(function* () {
        const room = yield* makeRoom("Ciranda de Lia");
        const provider = yield* fakeProvider();
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
          provider: { endpoint: provider.url },
        });
        const origin = { Origin: "http://localhost:5173" };

        const preflight = yield* Effect.promise(() =>
          fetch(room.url("/chat/completions"), {
            method: "OPTIONS",
            headers: {
              ...origin,
              "Access-Control-Request-Method": "POST",
              "Access-Control-Request-Headers": "content-type, authorization",
            },
          })
        );
        const completion = yield* Effect.promise(() =>
          fetch(room.url("/chat/completions"), {
            method: "POST",
            headers: { ...origin, "Content-Type": "application/json" },
            body: JSON.stringify({ model: "arthur-1", stream: true, messages }),
          })
        );
        const refused = yield* Effect.promise(() =>
          fetch(room.url("/chat/completions"), {
            method: "POST",
            headers: origin,
            body: JSON.stringify({ model: "nobody", messages }),
          })
        );
        const models = yield* Effect.promise(() =>
          fetch(room.url("/models"), { headers: origin })
        );

        expect(preflight.status).toBe(204);
        expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
        expect(preflight.headers.get("access-control-allow-headers")).toBe(
          "content-type, authorization"
        );
        for (const response of [completion, refused, models]) {
          expect(response.headers.get("access-control-allow-origin")).toBe("*");
        }
      })
  );

  it.effect(
    "cancelling a request that has no answer yet aborts the request to the provider and frees the participant",
    () =>
      Effect.gen(function* () {
        const room = yield* makeRoom("Bumba meu boi");
        const provider = yield* fakeProvider({ answer: () => stillThinking });
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
          provider: { endpoint: provider.url },
        });
        const app = new AbortController();

        const request = yield* Effect.forkChild(
          Effect.tryPromise(() =>
            fetch(room.url("/chat/completions"), {
              method: "POST",
              body: JSON.stringify({ model: "arthur-1", messages }),
              signal: app.signal,
            })
          )
        );
        const call = yield* provider.nextCall;
        expect(yield* room.statusOf("arthur-1")).toBe("busy");

        app.abort();

        yield* call.aborted;
        yield* room.awaitStatus("arthur-1", "online");
        yield* Fiber.await(request);
      })
  );

  it.effect(
    "a participant that dies in the middle of a stream ends it with a named error",
    () =>
      Effect.gen(function* () {
        const tunnels = yield* Tunnels;
        const room = yield* makeRoom("Nau catarineta");
        const generating = yield* openStream();
        const provider = yield* fakeProvider({
          answer: () => generating.response,
        });
        const participant = yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
          provider: { endpoint: provider.url },
        });
        yield* generating.send(sseEvent({ delta: "Olá" }));
        const response = yield* post(room.url("/chat/completions"), {
          model: "arthur-1",
          stream: true,
          messages,
        });
        const reader = response.body?.getReader();
        if (reader === undefined) {
          return yield* Effect.die(new Error("The response has no body."));
        }
        const first = yield* Effect.promise(() => reader.read());

        yield* participant.kill;
        const rest = yield* readToEnd(reader);

        expect(response.status).toBe(200);
        expect(decoder.decode(first.value)).toBe(sseEvent({ delta: "Olá" }));
        const message =
          "Participant 'arthur-1' disconnected before the response ended.";
        expect(rest).toBe(
          `event: error\ndata: ${JSON.stringify({
            type: "error",
            code: "participant_disconnected",
            message,
            param: null,
            error: {
              message,
              type: "api_error",
              param: null,
              code: "participant_disconnected",
            },
          })}\n\n`
        );
        yield* tunnels.awaitDrop(room.code, "arthur-1");
        expect(yield* room.statusOf("arthur-1")).toBe("offline");
      })
  );

  it.effect(
    "a participant that dies before it answers is a named 502, also in the middle of a body that is not a stream",
    () =>
      Effect.gen(function* () {
        const room = yield* makeRoom("Fandango");
        const silent = yield* fakeProvider({ answer: () => stillThinking });
        const halfway = yield* openStream("application/json");
        const cut = yield* fakeProvider({ answer: () => halfway.response });
        yield* halfway.send('{"id":"chatcmpl-fake","choices":[');
        const dying = (participantId: string, endpoint: string) =>
          Effect.gen(function* () {
            const participant = yield* joinParticipant({
              roomCode: room.code,
              participantId,
              provider: { endpoint },
            });
            const request = yield* Effect.forkChild(
              post(room.url("/chat/completions"), {
                model: participantId,
                messages,
              })
            );
            return { participant, request };
          });

        const unanswered = yield* dying("silent-1", silent.url);
        yield* silent.nextCall;
        yield* unanswered.participant.kill;
        const halfAnswered = yield* dying("cut-1", cut.url);
        yield* cut.nextCall;
        yield* halfAnswered.participant.kill;

        for (const { request } of [unanswered, halfAnswered]) {
          const response = yield* Fiber.join(request);
          expect(response.status).toBe(502);
          expect((yield* json(response)).error.code).toBe(
            "participant_disconnected"
          );
        }
      })
  );

  it.effect(
    "a stream that breaks in the middle of an event drops the half event, so the error that follows can be read",
    () =>
      Effect.gen(function* () {
        const room = yield* makeRoom("Cavalo-marinho");
        /** A participant whose provider answers with these pieces and then this end. */
        const answering = (
          participantId: string,
          pieces: readonly string[],
          end: Stream.Stream<never, ProviderResponseInterrupted>
        ) =>
          joinParticipant({
            roomCode: room.code,
            participantId,
            handlers: TunnelRpcs.toLayerHandler("Infer", () =>
              Stream.make<InferenceChunk[]>(
                { _tag: "Head", status: 200, contentType: "text/event-stream" },
                ...pieces.map((text) => ({ _tag: "Body" as const, text }))
              ).pipe(Stream.concat(end))
            ),
          });
        const bodyOf = (model: string) =>
          post(room.url("/chat/completions"), {
            model,
            stream: true,
            messages,
          }).pipe(
            Effect.flatMap((response) => Effect.promise(() => response.text()))
          );
        yield* answering(
          "broken-1",
          ['data: {"delta":"Olá"}\n\nda', 'ta: {"delta":"Rec'],
          Stream.fail(new ProviderResponseInterrupted())
        );
        yield* answering(
          "whole-1",
          ['data: {"delta":"Olá"}\r\n\r\nda', 'ta: {"delta":"Recife"}'],
          Stream.empty
        );

        // A piece as big as a slow reader gets them: whole events and a half.
        const bigEvent = `data: {"delta":"${"x".repeat(2 * 1024 * 1024)}"}`;
        yield* answering(
          "big-1",
          [`${bigEvent}\n\n${bigEvent}\n\ndata: {"delta":"Rec`],
          Stream.fail(new ProviderResponseInterrupted())
        );

        const broken = yield* bodyOf("broken-1");
        const whole = yield* bodyOf("whole-1");
        const big = yield* bodyOf("big-1");

        expect(broken.split("\n\n").slice(0, -2)).toEqual([
          'data: {"delta":"Olá"}',
        ]);
        expect(lastEvent(broken).event).toBe("error");
        expect(lastEvent(broken).data.error.code).toBe(
          "provider_response_interrupted"
        );
        expect(big.split("\n\n").slice(0, -2)).toEqual([bigEvent, bigEvent]);
        expect(lastEvent(big).data.error.code).toBe(
          "provider_response_interrupted"
        );
        // A stream that ends well is passed on to the last byte, even when
        // the provider did not finish its last event with a blank line.
        expect(whole).toBe(
          'data: {"delta":"Olá"}\r\n\r\ndata: {"delta":"Recife"}'
        );
      })
  );
});
