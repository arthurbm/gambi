import { expect } from "bun:test";
import { layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { layerHub, managementClient } from "../testing/hub.ts";
import { joinParticipant } from "../testing/participant.ts";
import {
  FAKE_COMPLETION_TEXT,
  fakeProvider,
  storingResponses,
} from "../testing/provider.ts";
import { Hub } from "./hub.ts";

/** A new room and the URL of its inference plane. */
const makeRoom = (name: string) =>
  Effect.gen(function* () {
    const hub = yield* Hub;
    const client = yield* managementClient;
    const { room } = yield* client.rooms.create({ payload: { name } });
    return {
      code: room.code,
      /** The URL of a route of the room's inference plane, for example `url("/responses")`. */
      url: (path: string) => `${hub.url}/rooms/${room.code}/v1${path}`,
    };
  });

/** An app calling the inference plane: a plain `fetch`, as the OpenAI SDK does. */
const call = (method: "GET" | "POST" | "DELETE", url: string, body?: unknown) =>
  Effect.promise(() =>
    fetch(url, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    })
  );

/** The JSON body of a response. A test asserts on what it expects to find there. */
const json = (response: Response): Effect.Effect<any> =>
  Effect.promise(() => response.json());

layer(layerHub(), { excludeTestServices: true })("Responses API", (it) => {
  it.effect(
    "a Response is read back from the provider of the participant that created it",
    () =>
      Effect.gen(function* () {
        const room = yield* makeRoom("Maracatu");
        const provider = yield* fakeProvider({ answer: storingResponses() });
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
          provider: { endpoint: provider.url },
        });
        const created = yield* json(
          yield* call("POST", room.url("/responses"), {
            model: "arthur-1",
            input: "Oi",
          })
        );
        yield* provider.nextCall;

        const response = yield* call(
          "GET",
          room.url(`/responses/${created.id}`)
        );
        const read = yield* json(response);

        expect(response.status).toBe(200);
        expect(read.id).toBe(created.id);
        expect(read.output[0].content[0].text).toBe(FAKE_COMPLETION_TEXT);
        const asked = yield* provider.nextCall;
        expect(asked.method).toBe("GET");
        expect(asked.path).toBe(`/v1/responses/${created.id}`);
        expect(asked.body).toBeUndefined();
      })
  );
});
