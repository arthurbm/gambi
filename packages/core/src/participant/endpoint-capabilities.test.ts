import { expect } from "bun:test";
import { it, layer } from "@gambi/testing/effect";
import { Effect, Fiber } from "effect";
import { FetchHttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import { Hub } from "../hub/hub.ts";
import { layerHub, managementClient } from "../testing/hub.ts";
import { joinParticipant } from "../testing/participant.ts";
import {
  chatCompletionsOnly,
  FAKE_MODEL,
  fakeProvider,
  jsonAnswer,
  openAiAnswer,
} from "../testing/provider.ts";
import { probeEndpoint } from "./endpoint-capabilities.ts";

layer(layerHub(), { excludeTestServices: true })(
  "capability detection",
  (it) => {
    it.effect(
      "a provider that speaks Chat Completions and not Responses is probed as such, and the hub then asks it in that API alone",
      () =>
        Effect.gen(function* () {
          const hub = yield* Hub;
          const client = yield* managementClient;
          const provider = yield* fakeProvider({ answer: chatCompletionsOnly });

          const probe = yield* probeEndpoint({ endpoint: provider.url });

          expect(probe).toEqual({
            reachable: true,
            models: [FAKE_MODEL],
            capabilities: {
              openResponses: "unsupported",
              chatCompletions: "supported",
            },
          });

          // What the probe found goes up with the registration.
          const { room } = yield* client.rooms.create({
            payload: { name: "Frevo" },
          });
          yield* joinParticipant({
            roomCode: room.code,
            participantId: "arthur-1",
            profile: { capabilities: probe.capabilities },
            provider: { endpoint: provider.url },
          });
          const [arthur] = yield* client.participants.list({
            params: { code: room.code },
          });
          expect(arthur?.capabilities).toEqual(probe.capabilities);
          const probed = (yield* provider.calls).length;
          const response = yield* Effect.promise(() =>
            fetch(`${hub.url}/rooms/${room.code}/v1/responses`, {
              method: "POST",
              body: JSON.stringify({ model: "arthur-1", input: "Oi" }),
            })
          );
          expect(response.status).toBe(200);
          expect(
            (yield* provider.calls)
              .slice(probed)
              .map((call) => `${call.method} ${call.path}`)
          ).toEqual(["POST /v1/chat/completions"]);
        })
    );

    it.effect("a provider that speaks both APIs is probed as such", () =>
      Effect.gen(function* () {
        const provider = yield* fakeProvider();

        const probe = yield* probeEndpoint({ endpoint: `${provider.url}/` });

        expect(probe).toEqual({
          reachable: true,
          models: [FAKE_MODEL],
          capabilities: {
            openResponses: "supported",
            chatCompletions: "supported",
          },
        });
      })
    );

    it.effect("the models of an Ollama are the ones it lists as its own", () =>
      Effect.gen(function* () {
        const provider = yield* fakeProvider({
          answer: (call) =>
            call.path === "/api/tags"
              ? jsonAnswer({
                  models: [{ name: "llama3.1:8b" }, { name: "qwen3:4b" }],
                })
              : openAiAnswer(call),
        });

        const probe = yield* probeEndpoint({ endpoint: provider.url });

        expect(probe.models).toEqual(["llama3.1:8b", "qwen3:4b"]);
      })
    );

    it.effect(
      "a protected provider is only detected with the participant's auth headers",
      () =>
        Effect.gen(function* () {
          const provider = yield* fakeProvider({
            answer: (call) =>
              call.headers.authorization === "Bearer segredo"
                ? openAiAnswer(call)
                : new Response("Unauthorized", { status: 401 }),
          });

          const locked = yield* probeEndpoint({ endpoint: provider.url });
          const open = yield* probeEndpoint({
            endpoint: provider.url,
            authHeaders: { Authorization: "Bearer segredo" },
          });

          expect(locked).toEqual({
            reachable: false,
            models: [],
            capabilities: {
              openResponses: "unsupported",
              chatCompletions: "unsupported",
            },
          });
          expect(open.reachable).toBe(true);
          expect(open.capabilities).toEqual({
            openResponses: "supported",
            chatCompletions: "supported",
          });
        })
    );

    it.effect("an endpoint where nothing listens is not reachable", () =>
      Effect.gen(function* () {
        // A provider that was there and is gone: its port refuses connections.
        const gone = yield* Effect.scoped(fakeProvider());

        const probe = yield* probeEndpoint({ endpoint: gone.url });

        expect(probe).toEqual({
          reachable: false,
          models: [],
          capabilities: {
            openResponses: "unknown",
            chatCompletions: "unknown",
          },
        });
      })
    );
  }
);

it.effect(
  "a provider that does not answer a probe in 5 seconds is of unknown capabilities",
  () =>
    Effect.gen(function* () {
      const provider = yield* fakeProvider({
        answer: (call) =>
          call.method === "POST"
            ? new Promise<Response>(() => undefined)
            : openAiAnswer(call),
      });

      const probing = yield* Effect.forkChild(
        probeEndpoint({ endpoint: provider.url })
      );
      // The two requests that will never be answered are on their way.
      let waiting = 0;
      while (waiting < 2) {
        waiting = (yield* provider.calls).filter(
          (call) => call.method === "POST"
        ).length;
        yield* Effect.yieldNow;
      }
      yield* TestClock.adjust("5 seconds");
      const probe = yield* Fiber.join(probing);

      // It listed its models, so it is taken to speak Chat Completions.
      expect(probe).toEqual({
        reachable: true,
        models: [FAKE_MODEL],
        capabilities: {
          openResponses: "unknown",
          chatCompletions: "supported",
        },
      });
    }).pipe(Effect.provide(FetchHttpClient.layer))
);
