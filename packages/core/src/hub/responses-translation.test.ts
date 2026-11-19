import { expect } from "bun:test";
import type { RoomEvent } from "@gambi/protocol";
import { layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { Sse } from "effect/encoding";
import { layerHub, managementClient, watchRoom } from "../testing/hub.ts";
import { joinParticipant } from "../testing/participant.ts";
import {
  chatCompletionsOnly,
  FAKE_COMPLETION_TEXT,
  fakeProvider,
  jsonAnswer,
  openStream,
  sseAnswer,
  sseEvent,
} from "../testing/provider.ts";
import { Hub } from "./hub.ts";

/** What a provider that speaks Chat Completions and not Responses says of itself. */
const chatOnly = {
  openResponses: "unsupported",
  chatCompletions: "supported",
} as const;

/** The id the hub gives a Response it builds. */
const HUB_RESPONSE_ID = /^resp_[0-9a-f]{32}$/;

/** A new room, the URL of its inference plane and the status of its participants. */
const makeRoom = (name: string) =>
  Effect.gen(function* () {
    const hub = yield* Hub;
    const client = yield* managementClient;
    const { room } = yield* client.rooms.create({ payload: { name } });
    return {
      code: room.code,
      /** The URL of a route of the room's inference plane, for example `url("/responses")`. */
      url: (path: string) => `${hub.url}/rooms/${room.code}/v1${path}`,
      statusOf: (participantId: string) =>
        client.participants
          .list({ params: { code: room.code } })
          .pipe(
            Effect.map(
              (participants) =>
                participants.find(
                  (participant) => participant.id === participantId
                )?.status
            )
          ),
    };
  });

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

/** One chunk of a streamed chat completion, as a provider writes it. */
const chatChunk = (delta: object, finishReason: string | null = null) =>
  sseEvent({
    id: "chatcmpl-fake",
    object: "chat.completion.chunk",
    created: 0,
    model: "test-model",
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  });

/** Reads a streamed body until `text` shows up in it; answers what was read. */
const readUntil = (
  reader: {
    read(): Promise<{ done: boolean; value?: Uint8Array | undefined }>;
  },
  text: string
) =>
  Effect.promise(async () => {
    const decoder = new TextDecoder();
    let read = "";
    while (!read.includes(text)) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      read += decoder.decode(value, { stream: true });
    }
    return read;
  });

/** The server-sent events of a body, in order: the name of each and its data, parsed when it is JSON. */
const eventsOf = (body: string) => {
  const events: { readonly event: string; readonly data: any }[] = [];
  const parser = Sse.makeParser((event) => {
    if (event._tag === "Event") {
      events.push({
        event: event.event,
        data: event.data === "[DONE]" ? event.data : JSON.parse(event.data),
      });
    }
  });
  parser.feed(body);
  return events;
};

layer(layerHub(), { excludeTestServices: true })(
  "Responses API through Chat Completions",
  (it) => {
    it.effect(
      "a provider that does not speak Responses is asked through Chat Completions, and its answer comes back as a Response",
      () =>
        Effect.gen(function* () {
          const room = yield* makeRoom("Maracatu");
          const provider = yield* fakeProvider({ answer: chatCompletionsOnly });
          yield* joinParticipant({
            roomCode: room.code,
            participantId: "arthur-1",
            profile: { model: "llama3.1:8b", capabilities: chatOnly },
            provider: { endpoint: provider.url },
          });

          const response = yield* post(room.url("/responses"), {
            model: "arthur-1",
            instructions: "Responda em português.",
            input: "Oi",
            temperature: 0.2,
            max_output_tokens: 64,
          });
          const created = yield* json(response);

          expect(response.status).toBe(200);
          expect(response.headers.get("content-type")).toBe("application/json");
          expect(created).toMatchObject({
            object: "response",
            status: "completed",
            model: "llama3.1:8b",
            instructions: "Responda em português.",
            temperature: 0.2,
            max_output_tokens: 64,
            output_text: FAKE_COMPLETION_TEXT,
            output: [
              {
                type: "message",
                role: "assistant",
                status: "completed",
                content: [
                  {
                    type: "output_text",
                    text: FAKE_COMPLETION_TEXT,
                    annotations: [],
                  },
                ],
              },
            ],
            usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
          });
          expect(created.id).toMatch(HUB_RESPONSE_ID);
          // The provider was asked once, in the only API it speaks.
          const calls = yield* provider.calls;
          expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
            "POST /v1/chat/completions",
          ]);
          expect(calls[0]?.body).toEqual({
            model: "llama3.1:8b",
            messages: [
              { role: "system", content: "Responda em português." },
              { role: "user", content: "Oi" },
            ],
            temperature: 0.2,
            max_tokens: 64,
          });
          expect(yield* room.statusOf("arthur-1")).toBe("online");
        })
    );

    it.effect(
      "a provider that answers that it has no Responses route is asked again through Chat Completions",
      () =>
        Effect.gen(function* () {
          const room = yield* makeRoom("Frevo");
          const provider = yield* fakeProvider({ answer: chatCompletionsOnly });
          // Nobody probed this provider: the hub does not know what it speaks.
          yield* joinParticipant({
            roomCode: room.code,
            participantId: "arthur-1",
            provider: { endpoint: provider.url },
          });

          const response = yield* post(room.url("/responses"), {
            model: "arthur-1",
            input: "Oi",
          });
          const created = yield* json(response);

          expect(response.status).toBe(200);
          expect(created.object).toBe("response");
          expect(created.output_text).toBe(FAKE_COMPLETION_TEXT);
          expect(
            (yield* provider.calls).map((call) => `${call.method} ${call.path}`)
          ).toEqual(["POST /v1/responses", "POST /v1/chat/completions"]);
          expect(yield* room.statusOf("arthur-1")).toBe("online");
        })
    );

    it.effect(
      "a Response the hub built from a chat completion cannot be read back, and the hub says why",
      () =>
        Effect.gen(function* () {
          const room = yield* makeRoom("Coco");
          const provider = yield* fakeProvider({ answer: chatCompletionsOnly });
          yield* joinParticipant({
            roomCode: room.code,
            participantId: "arthur-1",
            profile: { capabilities: chatOnly },
            provider: { endpoint: provider.url },
          });
          const created = yield* json(
            yield* post(room.url("/responses"), {
              model: "arthur-1",
              input: "Oi",
            })
          );

          const response = yield* Effect.promise(() =>
            fetch(room.url(`/responses/${created.id}`))
          );

          expect(response.status).toBe(501);
          expect(yield* json(response)).toEqual({
            error: {
              message: `Response '${created.id}' was answered through Chat Completions and is stored nowhere: it cannot be read back, deleted or cancelled.`,
              type: "api_error",
              param: null,
              code: "response_not_stored",
            },
          });
          // The provider has no route for it, and was not asked.
          expect(yield* provider.calls).toHaveLength(1);
        })
    );

    it.effect(
      "a streamed chat completion arrives as the events of a streamed Response",
      () =>
        Effect.gen(function* () {
          const room = yield* makeRoom("Ciranda");
          const provider = yield* fakeProvider({ answer: chatCompletionsOnly });
          yield* joinParticipant({
            roomCode: room.code,
            participantId: "arthur-1",
            profile: { model: "llama3.1:8b", capabilities: chatOnly },
            provider: { endpoint: provider.url },
          });

          const response = yield* post(room.url("/responses"), {
            model: "arthur-1",
            input: "Oi",
            stream: true,
          });
          const events = eventsOf(yield* Effect.promise(() => response.text()));

          expect(response.status).toBe(200);
          expect(response.headers.get("content-type")).toBe(
            "text/event-stream"
          );
          expect(events.map((event) => event.event)).toEqual([
            "response.created",
            "response.output_item.added",
            "response.content_part.added",
            "response.output_text.delta",
            "response.output_text.delta",
            "response.output_item.done",
            "response.completed",
            "message",
          ]);
          // Each event says its own type and its place in the stream.
          const named = events.slice(0, -1);
          expect(named.map((event) => event.data.type)).toEqual(
            named.map((event) => event.event)
          );
          expect(named.map((event) => event.data.sequence_number)).toEqual([
            0, 1, 2, 3, 4, 5, 6,
          ]);
          expect(events.at(-1)?.data).toBe("[DONE]");

          const [
            created,
            added,
            part,
            firstDelta,
            secondDelta,
            done,
            completed,
          ] = named.map((event) => event.data);
          // The text has a part to go into before its first piece arrives: a
          // client that builds the Response from the events needs it.
          expect(part).toMatchObject({
            output_index: 0,
            item_id: added.item.id,
            content_index: 0,
            part: { type: "output_text", text: "", annotations: [] },
          });
          expect(created.response).toMatchObject({
            object: "response",
            status: "in_progress",
            model: "llama3.1:8b",
            output: [],
          });
          expect(created.response.id).toMatch(HUB_RESPONSE_ID);
          expect(added).toMatchObject({
            output_index: 0,
            item: {
              type: "message",
              role: "assistant",
              status: "in_progress",
              content: [],
            },
          });
          expect(firstDelta).toMatchObject({
            output_index: 0,
            item_id: added.item.id,
            content_index: 0,
            delta: "Olá, ",
          });
          expect(secondDelta.delta).toBe("Recife!");
          const message = {
            id: added.item.id,
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: FAKE_COMPLETION_TEXT,
                annotations: [],
              },
            ],
          };
          expect(done).toMatchObject({ output_index: 0, item: message });
          expect(completed.response).toMatchObject({
            id: created.response.id,
            object: "response",
            status: "completed",
            model: "llama3.1:8b",
            output: [message],
            output_text: FAKE_COMPLETION_TEXT,
          });
          const [call] = yield* provider.calls;
          expect(call?.path).toBe("/v1/chat/completions");
          expect(call?.body).toEqual({
            model: "llama3.1:8b",
            messages: [{ role: "user", content: "Oi" }],
            stream: true,
          });
          expect(yield* room.statusOf("arthur-1")).toBe("online");
        })
    );

    it.effect(
      "a fast reader receives the full closing events of a large translated Response",
      () =>
        Effect.gen(function* () {
          const room = yield* makeRoom("Cauda");
          const chunk = chatChunk({ content: "x".repeat(64 * 1024) });
          const provider = yield* fakeProvider({
            answer: () => sseAnswer(new Array<string>(48).fill(chunk)),
          });
          yield* joinParticipant({
            roomCode: room.code,
            participantId: "arthur-1",
            profile: { capabilities: chatOnly },
            provider: { endpoint: provider.url },
          });
          const response = yield* post(room.url("/responses"), {
            model: "arthur-1",
            input: "Oi",
            stream: true,
          });
          const body = yield* Effect.promise(() => response.text());
          expect(body.includes("event: response.completed")).toBe(true);
          expect(body.trimEnd().endsWith("data: [DONE]")).toBe(true);
        })
    );

    it.effect(
      "cancelling a streamed Response that goes through Chat Completions aborts the request to the provider and frees the participant",
      () =>
        Effect.gen(function* () {
          const room = yield* makeRoom("Xote");
          const generating = yield* openStream();
          const provider = yield* fakeProvider({
            answer: (asked) =>
              asked.path === "/v1/chat/completions"
                ? generating.response
                : chatCompletionsOnly(asked),
          });
          yield* joinParticipant({
            roomCode: room.code,
            participantId: "arthur-1",
            provider: { endpoint: provider.url },
          });
          const app = new AbortController();
          // A provider sends its response head with the first piece of the body.
          yield* generating.send(chatChunk({ content: "Olá" }));

          const response = yield* post(
            room.url("/responses"),
            { model: "arthur-1", input: "Oi", stream: true },
            app.signal
          );
          const reader = response.body?.getReader();
          if (reader === undefined) {
            return yield* Effect.die(new Error("The response has no body."));
          }
          const read = yield* readUntil(reader, "response.output_text.delta");
          const refused = yield* provider.nextCall;
          const answering = yield* provider.nextCall;

          expect(response.status).toBe(200);
          expect(eventsOf(read).at(-1)?.data.delta).toBe("Olá");
          expect(refused.path).toBe("/v1/responses");
          expect(answering.path).toBe("/v1/chat/completions");
          expect(yield* room.statusOf("arthur-1")).toBe("busy");

          app.abort();

          // The provider sees its request go away: the handler on the
          // participant was interrupted and took the request with it.
          yield* answering.aborted;
          yield* room
            .statusOf("arthur-1")
            .pipe(Effect.repeat({ until: (status) => status === "online" }));
        })
    );

    it.effect(
      "a participant that dies in the middle of a translated stream ends it with a named error, in its place in the stream",
      () =>
        Effect.gen(function* () {
          const room = yield* makeRoom("Baião");
          const generating = yield* openStream();
          const provider = yield* fakeProvider({
            answer: () => generating.response,
          });
          const participant = yield* joinParticipant({
            roomCode: room.code,
            participantId: "arthur-1",
            profile: { capabilities: chatOnly },
            provider: { endpoint: provider.url },
          });
          yield* generating.send(chatChunk({ content: "Olá" }));
          const response = yield* post(room.url("/responses"), {
            model: "arthur-1",
            input: "Oi",
            stream: true,
          });
          const reader = response.body?.getReader();
          if (reader === undefined) {
            return yield* Effect.die(new Error("The response has no body."));
          }
          const start = yield* readUntil(reader, "response.output_text.delta");

          yield* participant.kill;
          const rest = yield* readUntil(reader, "never, so to the end");

          const events = eventsOf(start + rest);
          expect(events.map((event) => event.event)).toEqual([
            "response.created",
            "response.output_item.added",
            "response.content_part.added",
            "response.output_text.delta",
            "error",
          ]);
          expect(events.at(-1)?.data).toMatchObject({
            type: "error",
            sequence_number: 4,
            code: "participant_disconnected",
            error: { code: "participant_disconnected", type: "api_error" },
          });
        })
    );

    it.effect(
      "a request that Chat Completions cannot carry is a named 400 that says which field, and the provider is not asked",
      () =>
        Effect.gen(function* () {
          const room = yield* makeRoom("Forró");
          const provider = yield* fakeProvider({ answer: chatCompletionsOnly });
          yield* joinParticipant({
            roomCode: room.code,
            participantId: "arthur-1",
            profile: { capabilities: chatOnly },
            provider: { endpoint: provider.url },
          });
          const refusal = (body: object) =>
            post(room.url("/responses"), { model: "arthur-1", ...body }).pipe(
              Effect.flatMap((response) =>
                Effect.map(json(response), (answer) => ({
                  status: response.status,
                  code: answer.error.code,
                  param: answer.error.param,
                }))
              )
            );
          const untranslatable = (param: string) => ({
            status: 400,
            code: "request_not_translatable",
            param,
          });

          // A stored conversation exists only on a provider that stores Responses.
          expect(
            yield* refusal({ input: "Oi", previous_response_id: "resp_1" })
          ).toEqual(untranslatable("previous_response_id"));
          expect(
            yield* refusal({ input: "Oi", tools: [{ type: "web_search" }] })
          ).toEqual(untranslatable("tools"));
          expect(
            yield* refusal({ input: [{ type: "reasoning", summary: [] }] })
          ).toEqual(untranslatable("input"));
          expect(yield* refusal({})).toEqual(untranslatable("input"));

          const whole = yield* json(
            yield* post(room.url("/responses"), {
              model: "arthur-1",
              input: "Oi",
              background: true,
            })
          );
          expect(whole).toEqual({
            error: {
              message:
                "The participant's provider is reached through Chat Completions, which cannot carry this request: background: Chat Completions has no equivalent.",
              type: "invalid_request_error",
              param: "background",
              code: "request_not_translatable",
            },
          });
          expect(yield* provider.calls).toHaveLength(0);
          expect(yield* room.statusOf("arthur-1")).toBe("online");
        })
    );

    it.effect(
      "function tools, tool calls and their outputs cross the translation in both directions",
      () =>
        Effect.gen(function* () {
          const room = yield* makeRoom("Caboclinho");
          const provider = yield* fakeProvider({
            answer: () =>
              jsonAnswer({
                id: "chatcmpl-fake",
                object: "chat.completion",
                created: 1_700_000_000,
                model: "test-model",
                choices: [
                  {
                    index: 0,
                    message: {
                      role: "assistant",
                      content: null,
                      tool_calls: [
                        {
                          id: "call_2",
                          type: "function",
                          function: {
                            name: "hora",
                            arguments: '{"cidade":"Olinda"}',
                          },
                        },
                      ],
                    },
                    finish_reason: "tool_calls",
                  },
                ],
              }),
          });
          yield* joinParticipant({
            roomCode: room.code,
            participantId: "arthur-1",
            profile: { capabilities: chatOnly },
            provider: { endpoint: provider.url },
          });
          const parameters = {
            type: "object",
            properties: { cidade: { type: "string" } },
          };

          const response = yield* post(room.url("/responses"), {
            model: "arthur-1",
            input: [
              {
                role: "user",
                content: [
                  { type: "input_text", text: "Que horas são no Recife?" },
                ],
              },
              {
                type: "function_call",
                call_id: "call_1",
                name: "hora",
                arguments: '{"cidade":"Recife"}',
              },
              {
                type: "function_call_output",
                call_id: "call_1",
                output: "14h",
              },
              { role: "user", content: "E em Olinda?" },
            ],
            tools: [
              {
                type: "function",
                name: "hora",
                description: "Diz a hora numa cidade.",
                parameters,
                strict: true,
              },
            ],
            tool_choice: { type: "function", name: "hora" },
          });
          const created = yield* json(response);

          const [call] = yield* provider.calls;
          expect(call?.body).toEqual({
            model: "test-model",
            messages: [
              { role: "user", content: "Que horas são no Recife?" },
              {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "hora",
                      arguments: '{"cidade":"Recife"}',
                    },
                  },
                ],
              },
              { role: "tool", tool_call_id: "call_1", content: "14h" },
              { role: "user", content: "E em Olinda?" },
            ],
            tools: [
              {
                type: "function",
                function: {
                  name: "hora",
                  description: "Diz a hora numa cidade.",
                  parameters,
                  strict: true,
                },
              },
            ],
            tool_choice: { type: "function", function: { name: "hora" } },
          });
          expect(response.status).toBe(200);
          expect(created).toMatchObject({
            status: "completed",
            created_at: 1_700_000_000,
            output_text: "",
            output: [
              {
                type: "function_call",
                status: "completed",
                call_id: "call_2",
                name: "hora",
                arguments: '{"cidade":"Olinda"}',
              },
            ],
          });
        })
    );

    it.effect(
      "a streamed tool call arrives as a function call item and the deltas of its arguments",
      () =>
        Effect.gen(function* () {
          const room = yield* makeRoom("Maxixe");
          const toolCall = (fields: object) => ({
            tool_calls: [{ index: 0, ...fields }],
          });
          const provider = yield* fakeProvider({
            answer: () =>
              sseAnswer([
                // Some providers send arguments with the name, in the first
                // piece of the call; others start with none.
                chatChunk(
                  toolCall({
                    id: "call_2",
                    type: "function",
                    function: { name: "hora", arguments: '{"cidade":' },
                  })
                ),
                chatChunk(toolCall({ function: { arguments: '"Olinda"}' } })),
                chatChunk({}, "tool_calls"),
                sseEvent("[DONE]"),
              ]),
          });
          yield* joinParticipant({
            roomCode: room.code,
            participantId: "arthur-1",
            profile: { capabilities: chatOnly },
            provider: { endpoint: provider.url },
          });

          const response = yield* post(room.url("/responses"), {
            model: "arthur-1",
            input: "Que horas são em Olinda?",
            stream: true,
          });
          const events = eventsOf(yield* Effect.promise(() => response.text()));

          expect(events.map((event) => event.event)).toEqual([
            "response.created",
            "response.output_item.added",
            "response.function_call_arguments.delta",
            "response.function_call_arguments.delta",
            "response.output_item.done",
            "response.completed",
            "message",
          ]);
          const [, added, firstDelta, secondDelta, done, completed] =
            events.map((event) => event.data);
          expect(added).toMatchObject({
            output_index: 0,
            item: {
              type: "function_call",
              status: "in_progress",
              call_id: "call_2",
              name: "hora",
              arguments: "",
            },
          });
          expect(firstDelta).toMatchObject({
            output_index: 0,
            item_id: added.item.id,
            delta: '{"cidade":',
          });
          expect(secondDelta.delta).toBe('"Olinda"}');
          const functionCall = {
            id: added.item.id,
            type: "function_call",
            status: "completed",
            call_id: "call_2",
            name: "hora",
            arguments: '{"cidade":"Olinda"}',
          };
          expect(done).toMatchObject({ output_index: 0, item: functionCall });
          expect(completed.response).toMatchObject({
            status: "completed",
            output: [functionCall],
            output_text: "",
          });
        })
    );

    it.effect("a provider that speaks neither API is a named 501", () =>
      Effect.gen(function* () {
        const room = yield* makeRoom("Cavalo-marinho");
        const provider = yield* fakeProvider({ answer: chatCompletionsOnly });
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "mudo-1",
          profile: {
            capabilities: {
              openResponses: "unsupported",
              chatCompletions: "unsupported",
            },
          },
          provider: { endpoint: provider.url },
        });
        // This one may speak Responses, as far as the hub knows. It does not.
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "talvez-1",
          profile: {
            capabilities: {
              openResponses: "unknown",
              chatCompletions: "unsupported",
            },
          },
          provider: { endpoint: provider.url },
        });

        const mute = yield* post(room.url("/responses"), {
          model: "mudo-1",
          input: "Oi",
        });
        const maybe = yield* post(room.url("/responses"), {
          model: "talvez-1",
          input: "Oi",
        });

        expect(mute.status).toBe(501);
        expect(yield* json(mute)).toEqual({
          error: {
            message:
              "The provider of participant 'mudo-1' speaks neither the Responses API nor Chat Completions.",
            type: "api_error",
            param: null,
            code: "responses_not_supported",
          },
        });
        expect(maybe.status).toBe(501);
        expect((yield* json(maybe)).error.code).toBe("responses_not_supported");
        // Only the second participant's provider was asked, and once.
        expect(
          (yield* provider.calls).map((call) => `${call.method} ${call.path}`)
        ).toEqual(["POST /v1/responses"]);
        expect(yield* room.statusOf("mudo-1")).toBe("online");
        expect(yield* room.statusOf("talvez-1")).toBe("online");
      })
    );

    it.effect(
      "a refusal of the provider on the Chat Completions request reaches the app as the provider wrote it",
      () =>
        Effect.gen(function* () {
          const room = yield* makeRoom("Afoxé");
          const refusal = {
            error: {
              message: "Rate limit reached.",
              type: "rate_limit_error",
              param: null,
              code: "rate_limit_exceeded",
            },
          };
          const provider = yield* fakeProvider({
            answer: () => jsonAnswer(refusal, 429),
          });
          yield* joinParticipant({
            roomCode: room.code,
            participantId: "arthur-1",
            profile: { capabilities: chatOnly },
            provider: { endpoint: provider.url },
          });

          const response = yield* post(room.url("/responses"), {
            model: "arthur-1",
            input: "Oi",
            stream: true,
          });

          expect(response.status).toBe(429);
          expect(yield* json(response)).toEqual(refusal);
        })
    );

    it.effect(
      "the defaults of the room and of the participant fill a translated request too",
      () =>
        Effect.gen(function* () {
          const hub = yield* Hub;
          const client = yield* managementClient;
          const { room } = yield* client.rooms.create({
            payload: {
              name: "Samba de coco",
              defaults: {
                instructions: "Responda em português.",
                max_tokens: 128,
                temperature: 0.9,
              },
            },
          });
          const provider = yield* fakeProvider({ answer: chatCompletionsOnly });
          yield* joinParticipant({
            roomCode: room.code,
            participantId: "arthur-1",
            profile: {
              capabilities: chatOnly,
              config: { temperature: 0.1, stop: ["FIM"] },
            },
            provider: { endpoint: provider.url },
          });

          const response = yield* post(
            `${hub.url}/rooms/${room.code}/v1/responses`,
            { model: "arthur-1", input: "Oi", seed: 7 }
          );
          const created = yield* json(response);

          const [call] = yield* provider.calls;
          expect(call?.body).toEqual({
            model: "test-model",
            messages: [
              { role: "system", content: "Responda em português." },
              { role: "user", content: "Oi" },
            ],
            // The participant's value wins over the room's.
            temperature: 0.1,
            max_tokens: 128,
            stop: ["FIM"],
            seed: 7,
          });
          expect(created).toMatchObject({
            instructions: "Responda em português.",
            temperature: 0.1,
            max_output_tokens: 128,
          });
        })
    );

    it.effect(
      "the room hears of a translated request as a request of the Responses API, with the token counts of the chat completion",
      () =>
        Effect.gen(function* () {
          const room = yield* makeRoom("Jongo");
          const provider = yield* fakeProvider({ answer: chatCompletionsOnly });
          yield* joinParticipant({
            roomCode: room.code,
            participantId: "arthur-1",
            profile: { model: "llama3.1:8b" },
            provider: { endpoint: provider.url },
          });
          const watch = yield* watchRoom(room.code);

          const response = yield* post(room.url("/responses"), {
            model: "*",
            input: "Oi",
          });
          yield* Effect.promise(() => response.text());

          const events: RoomEvent[] = [];
          while (events.length < 4) {
            events.push(yield* watch.next);
          }
          expect(events.map((event) => event.type)).toEqual([
            "participant.busy",
            "llm.request",
            "llm.complete",
            "participant.online",
          ]);
          expect(events[1]).toMatchObject({
            participantId: "arthur-1",
            model: "llama3.1:8b",
            modelSelector: "*",
            protocol: "openResponses",
          });
          expect(events[2]).toMatchObject({
            protocol: "openResponses",
            status: 200,
            metrics: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
          });
        })
    );

    it.effect(
      "a provider that reports an error inside its stream ends the translated stream with that error, not with a completed Response",
      () =>
        Effect.gen(function* () {
          const room = yield* makeRoom("Pastoril");
          const failure = {
            message: "The model ran out of memory.",
            type: "server_error",
            param: null,
            code: "out_of_memory",
          };
          const provider = yield* fakeProvider({
            answer: () =>
              sseAnswer([
                chatChunk({ content: "Olá" }),
                sseEvent({ error: failure }),
              ]),
          });
          yield* joinParticipant({
            roomCode: room.code,
            participantId: "arthur-1",
            profile: { capabilities: chatOnly },
            provider: { endpoint: provider.url },
          });

          const response = yield* post(room.url("/responses"), {
            model: "arthur-1",
            input: "Oi",
            stream: true,
          });
          const events = eventsOf(yield* Effect.promise(() => response.text()));

          expect(events.map((event) => event.event)).toEqual([
            "response.created",
            "response.output_item.added",
            "response.content_part.added",
            "response.output_text.delta",
            "error",
          ]);
          expect(events.at(-1)?.data).toEqual({
            type: "error",
            sequence_number: 4,
            code: "out_of_memory",
            message: "The model ran out of memory.",
            param: null,
            error: failure,
          });
        })
    );
  }
);
