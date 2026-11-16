import { expect } from "bun:test";
import { it } from "@gambi/testing/effect";
import { Effect } from "effect";
import { layerHub, managementClient } from "../testing/hub.ts";
import { joinParticipant } from "../testing/participant.ts";
import { fakeProvider, storingResponses } from "../testing/provider.ts";
import { Hub } from "./hub.ts";

it.live(
  "the hub remembers a bounded number of Responses, and forgets the one used the longest ago",
  () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      const client = yield* managementClient;
      const { room } = yield* client.rooms.create({
        payload: { name: "Frevo" },
      });
      const provider = yield* fakeProvider({ answer: storingResponses() });
      yield* joinParticipant({
        roomCode: room.code,
        participantId: "arthur-1",
        provider: { endpoint: provider.url },
      });
      const responses = `${hub.url}/rooms/${room.code}/v1/responses`;
      const create = Effect.promise(async () => {
        const response = await fetch(responses, {
          method: "POST",
          body: JSON.stringify({ model: "arthur-1", input: "Oi" }),
        });
        const created = (await response.json()) as { readonly id: string };
        return created.id;
      });
      const read = (id: string) =>
        Effect.promise(async () => {
          const response = await fetch(`${responses}/${id}`);
          const body = (await response.json()) as {
            readonly error?: { readonly code: string };
          };
          return body.error?.code ?? response.status;
        });

      const first = yield* create;
      const second = yield* create;
      // Reading the first one makes the second the one used the longest ago.
      expect(yield* read(first)).toBe(200);
      const third = yield* create;

      expect(yield* read(second)).toBe("response_not_found");
      expect(yield* read(first)).toBe(200);
      expect(yield* read(third)).toBe(200);
      // The provider still has all three: it is the hub that forgot one.
      expect(
        (yield* provider.calls).filter((call) => call.method === "GET")
      ).toHaveLength(3);
    }).pipe(Effect.provide(layerHub({ storedResponsesLimit: 2 })))
);
