import { expect } from "bun:test";
import { layer } from "@gambi/testing/effect";
import { Effect, Fiber } from "effect";
import { layerHub, managementClient, watchRoom } from "../testing/hub.ts";
import { joinParticipant } from "../testing/participant.ts";
import {
  FAKE_COMPLETION_TEXT,
  fakeProvider,
  jsonAnswer,
  openAiAnswer,
  openStream,
  sseEvent,
  storingResponses,
} from "../testing/provider.ts";
import { Hub } from "./hub.ts";
import { Tunnels } from "./tunnels.ts";

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

/**
 * A room with one participant whose provider speaks the whole Responses API,
 * and one Response already created through the hub.
 */
const makeStoredResponse = (name: string) =>
  Effect.gen(function* () {
    const room = yield* makeRoom(name);
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
    return { room, provider, id: created.id as string };
  });

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

  it.effect(
    "deleting a Response deletes it on the provider, and the hub no longer knows it",
    () =>
      Effect.gen(function* () {
        const { room, provider, id } = yield* makeStoredResponse("Frevo");

        const response = yield* call("DELETE", room.url(`/responses/${id}`));

        expect(response.status).toBe(200);
        expect(yield* json(response)).toEqual({
          id,
          object: "response",
          deleted: true,
        });
        const asked = yield* provider.nextCall;
        expect(asked.method).toBe("DELETE");
        expect(asked.path).toBe(`/v1/responses/${id}`);

        const gone = yield* call("GET", room.url(`/responses/${id}`));
        expect(gone.status).toBe(404);
        expect((yield* json(gone)).error.code).toBe("response_not_found");
        // The hub answered by itself: the provider was not asked again.
        expect(yield* provider.calls).toHaveLength(2);
      })
  );

  it.effect("cancelling a Response cancels it on the provider", () =>
    Effect.gen(function* () {
      const { room, provider, id } = yield* makeStoredResponse("Coco");

      const response = yield* call("POST", room.url(`/responses/${id}/cancel`));

      expect(response.status).toBe(200);
      expect((yield* json(response)).status).toBe("cancelled");
      const asked = yield* provider.nextCall;
      expect(asked.method).toBe("POST");
      expect(asked.path).toBe(`/v1/responses/${id}/cancel`);
      expect(asked.body).toBeUndefined();
    })
  );

  it.effect(
    "the input items of a Response are listed by the provider, with the query the app sent",
    () =>
      Effect.gen(function* () {
        const { room, provider, id } = yield* makeStoredResponse("Ciranda");
        const query =
          "?limit=5&order=asc&include[]=message.input_image.image_url";

        const response = yield* call(
          "GET",
          room.url(`/responses/${id}/input_items${query}`)
        );
        const items = yield* json(response);

        expect(response.status).toBe(200);
        expect(items.object).toBe("list");
        expect(items.data[0].content[0].text).toBe("Oi");
        const asked = yield* provider.nextCall;
        expect(asked.method).toBe("GET");
        expect(asked.path).toBe(`/v1/responses/${id}/input_items${query}`);
      })
  );

  it.effect("a Response the hub does not know is a named 404", () =>
    Effect.gen(function* () {
      const { provider, id } = yield* makeStoredResponse("Xote");
      const other = yield* makeRoom("Baião");

      const unknown = yield* call(
        "GET",
        other.url("/responses/resp_que_ninguem_criou")
      );
      // A Response belongs to the room it was created in.
      const elsewhere = yield* call("GET", other.url(`/responses/${id}`));

      expect(unknown.status).toBe(404);
      expect(yield* json(unknown)).toEqual({
        error: {
          message: `Response 'resp_que_ninguem_criou' was not found in room '${other.code}'.`,
          type: "invalid_request_error",
          param: null,
          code: "response_not_found",
        },
      });
      expect(elsewhere.status).toBe(404);
      expect((yield* json(elsewhere)).error.code).toBe("response_not_found");
      expect(yield* provider.calls).toHaveLength(1);
    })
  );

  it.effect(
    "a Response the provider no longer has is forgotten by the hub too",
    () =>
      Effect.gen(function* () {
        const room = yield* makeRoom("Caboclinho");
        const provider = yield* fakeProvider({
          // A provider that creates a Response and does not keep it.
          answer: (asked) =>
            asked.method === "POST"
              ? openAiAnswer(asked)
              : jsonAnswer({ error: { message: "Gone." } }, 404),
        });
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

        const first = yield* call("GET", room.url(`/responses/${created.id}`));
        const second = yield* call("GET", room.url(`/responses/${created.id}`));

        // The first answer is the provider's own; the second is the hub's.
        expect(first.status).toBe(404);
        expect(yield* json(first)).toEqual({ error: { message: "Gone." } });
        expect(second.status).toBe(404);
        expect((yield* json(second)).error.code).toBe("response_not_found");
        expect(yield* provider.calls).toHaveLength(2);
      })
  );

  it.effect("an answer of the provider that has no body comes back empty", () =>
    Effect.gen(function* () {
      const room = yield* makeRoom("Forró");
      const provider = yield* fakeProvider({
        answer: (asked) =>
          asked.method === "DELETE"
            ? new Response(null, { status: 204 })
            : openAiAnswer(asked),
      });
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

      const response = yield* call(
        "DELETE",
        room.url(`/responses/${created.id}`)
      );

      expect(response.status).toBe(204);
      expect(yield* Effect.promise(() => response.text())).toBe("");
    })
  );

  it.effect(
    "a Response of a participant that is offline is a named 503, and of one that left the room a 404",
    () =>
      Effect.gen(function* () {
        const tunnels = yield* Tunnels;
        const client = yield* managementClient;
        const room = yield* makeRoom("Maxixe");
        const provider = yield* fakeProvider({ answer: storingResponses() });
        const participant = yield* joinParticipant({
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

        yield* participant.kill;
        yield* tunnels.awaitDrop(room.code, "arthur-1");
        const offline = yield* call(
          "GET",
          room.url(`/responses/${created.id}`)
        );
        yield* client.participants.remove({
          params: { code: room.code, id: "arthur-1" },
          query: { runtimeId: participant.runtime.runtimeId },
        });
        const left = yield* call("GET", room.url(`/responses/${created.id}`));

        expect(offline.status).toBe(503);
        expect((yield* json(offline)).error.code).toBe("participant_offline");
        expect(left.status).toBe(404);
        expect((yield* json(left)).error.code).toBe("response_not_found");
      })
  );

  it.effect(
    "a Response that is still streaming is cancelled through the hub while its participant is busy with it",
    () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const room = yield* makeRoom("Cavalo-marinho");
        const generating = yield* openStream();
        const provider = yield* fakeProvider({
          answer: (asked) =>
            asked.path === "/v1/responses"
              ? generating.response
              : jsonAnswer({ id: "resp_ao_vivo", status: "cancelled" }),
        });
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
          provider: { endpoint: provider.url },
        });
        const statusOfArthur = client.participants
          .list({ params: { code: room.code } })
          .pipe(Effect.map(([arthur]) => arthur?.status));
        // The first event of a streamed Response says its id. It arrives
        // here split in two pieces, as a network may deliver it.
        const first = sseEvent(
          {
            type: "response.created",
            response: { id: "resp_ao_vivo", status: "in_progress" },
          },
          "response.created"
        );
        yield* generating.send(first.slice(0, 40));
        const asking = yield* Effect.forkChild(
          call("POST", room.url("/responses"), {
            model: "arthur-1",
            input: "Oi",
            stream: true,
          })
        );
        yield* provider.nextCall;
        yield* generating.send(first.slice(40));
        const streaming = yield* Fiber.join(asking);
        const reader = streaming.body?.getReader();
        yield* Effect.promise(async () => await reader?.read());

        const cancelled = yield* call(
          "POST",
          room.url("/responses/resp_ao_vivo/cancel")
        );

        expect(cancelled.status).toBe(200);
        expect((yield* json(cancelled)).status).toBe("cancelled");
        expect((yield* provider.calls).map((asked) => asked.path)).toEqual([
          "/v1/responses",
          "/v1/responses/resp_ao_vivo/cancel",
        ]);
        // The cancellation went past the request in flight and left it alone.
        expect(yield* statusOfArthur).toBe("busy");
        yield* generating.end;
        yield* Effect.promise(async () => await reader?.read());
        expect(yield* statusOfArthur).toBe("online");
      })
  );

  it.effect(
    "an operation on a stored Response is no request of the room: it changes no status and the room hears nothing",
    () =>
      Effect.gen(function* () {
        const { room, id } = yield* makeStoredResponse("Afoxé");
        const watch = yield* watchRoom(room.code);

        yield* call("GET", room.url(`/responses/${id}`));
        yield* call("GET", room.url(`/responses/${id}/input_items`));
        yield* call("POST", room.url(`/responses/${id}/cancel`));
        yield* call("DELETE", room.url(`/responses/${id}`));
        // The next thing the room hears is whatever happens after them.
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "depois-1",
        });

        expect((yield* watch.next).type).toBe("participant.joined");
      })
  );

  it.effect(
    "a stored Response read as a stream arrives as the provider streams it",
    () =>
      Effect.gen(function* () {
        const { room, provider, id } = yield* makeStoredResponse("Jongo");

        const response = yield* call(
          "GET",
          room.url(`/responses/${id}?stream=true`)
        );
        const body = yield* Effect.promise(() => response.text());

        expect(response.status).toBe(200);
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
        expect((yield* provider.nextCall).path).toBe(
          `/v1/responses/${id}?stream=true`
        );
      })
  );

  it.effect(
    "a web app may ask the browser's permission to delete a Response",
    () =>
      Effect.gen(function* () {
        const room = yield* makeRoom("Samba de coco");

        const preflight = yield* Effect.promise(() =>
          fetch(room.url("/responses/resp_1"), {
            method: "OPTIONS",
            headers: {
              Origin: "http://localhost:5173",
              "Access-Control-Request-Method": "DELETE",
            },
          })
        );
        const refused = yield* Effect.promise(() =>
          fetch(room.url("/responses/resp_1"), {
            method: "DELETE",
            headers: { Origin: "http://localhost:5173" },
          })
        );

        expect(preflight.status).toBe(204);
        expect(preflight.headers.get("access-control-allow-origin")).toBe("*");
        expect(preflight.headers.get("access-control-allow-methods")).toContain(
          "DELETE"
        );
        expect(refused.headers.get("access-control-allow-origin")).toBe("*");
      })
  );
});
