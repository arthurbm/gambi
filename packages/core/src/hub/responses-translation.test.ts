import { expect } from "bun:test";
import { layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { layerHub, managementClient } from "../testing/hub.ts";
import { joinParticipant } from "../testing/participant.ts";
import {
  chatCompletionsOnly,
  FAKE_COMPLETION_TEXT,
  fakeProvider,
} from "../testing/provider.ts";
import { Hub } from "./hub.ts";

/** What a provider that speaks Chat Completions and not Responses says of itself. */
const chatOnly = {
  openResponses: "unsupported",
  chatCompletions: "supported",
} as const;

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
          expect(created.id).toMatch(/^resp_[0-9a-f]{32}$/);
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
  }
);
