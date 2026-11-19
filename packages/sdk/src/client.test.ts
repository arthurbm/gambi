import { describe, expect } from "bun:test";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub } from "@gambi/core/testing/hub";
import { joinParticipant } from "@gambi/core/testing/participant";
import { fakeProvider } from "@gambi/core/testing/provider";
import { it, layer } from "@gambi/testing/effect";
import { Context, Deferred, Effect, Exit, Layer, Scope } from "effect";
import { createClient } from "./client.ts";
import { ClientError } from "./client-error.ts";
import type { RegisterParticipantInput, RoomEvent } from "./types.ts";

/** The client a consumer would build for the hub of the block. */
const hubClient = Effect.gen(function* () {
  const hub = yield* Hub;
  const client = createClient({ hubUrl: hub.url });
  yield* Effect.addFinalizer(() => Effect.promise(() => client.close()));
  return client;
});

/** The `ClientError` a call rejects with. Any other outcome fails the test. */
const rejection = (call: () => Promise<unknown>) =>
  Effect.promise(() =>
    call().then(
      (value): ClientError => {
        throw new Error(`Expected a rejection, got ${JSON.stringify(value)}`);
      },
      (error: unknown): ClientError => {
        if (error instanceof ClientError) {
          return error;
        }
        throw error;
      }
    )
  );

/** A server on a free loopback port, stopped when the test ends. */
const serving = (fetch: (request: Request) => Response | Promise<Response>) =>
  Effect.acquireRelease(
    Effect.sync(() => Bun.serve({ hostname: "127.0.0.1", port: 0, fetch })),
    (server) => Effect.promise(() => server.stop(true))
  ).pipe(Effect.map((server) => `http://127.0.0.1:${server.port}`));

const SNAPSHOT: RoomEvent = {
  type: "room.snapshot",
  roomCode: "ABC123",
  timestamp: 1_790_000_000_000,
  room: {
    id: "room-1",
    code: "ABC123",
    name: "Frevo",
    hostId: "host-1",
    createdAt: 1_790_000_000_000,
    passwordProtected: false,
    participantCount: 0,
  },
  participants: [],
};

/**
 * A server that answers a watch the way a hub does, with the snapshot of a
 * room, and then stays quiet. `cancelled` completes when the client drops the
 * request, which a real hub gives no way to see from outside.
 */
const quietHub = Effect.gen(function* () {
  const cancelled = yield* Deferred.make<void>();
  const url = yield* serving((request) => {
    request.signal.addEventListener("abort", () =>
      Effect.runFork(Deferred.succeed(cancelled, undefined))
    );
    return new Response(
      new ReadableStream({
        start: (controller) =>
          controller.enqueue(
            `event: room.snapshot\ndata: ${JSON.stringify(SNAPSHOT)}\n\n`
          ),
      }),
      { headers: { "content-type": "text/event-stream" } }
    );
  });
  return { cancelled, url };
});

/** The next event of a watch. Fails the test when the watch has ended. */
const nextEvent = (watch: AsyncIterator<RoomEvent>) =>
  Effect.promise(async () => {
    const result = await watch.next();
    if (result.done === true) {
      throw new Error("The watch ended.");
    }
    return result.value;
  });

layer(layerHub(), { excludeTestServices: true })("management client", (it) => {
  it.effect("creates a room and reads it back", () =>
    Effect.gen(function* () {
      const client = yield* hubClient;

      const created = yield* Effect.promise(() =>
        client.rooms.create({ name: "Frevo" })
      );
      const room = yield* Effect.promise(() =>
        client.rooms.get(created.room.code)
      );

      expect(created.room.name).toBe("Frevo");
      expect(created.room.code).toHaveLength(6);
      expect(created.hostId).toBe(created.room.hostId);
      expect(room).toEqual(created.room);
    })
  );

  it.effect("a room that does not exist rejects with the hub's error", () =>
    Effect.gen(function* () {
      const client = yield* hubClient;

      const error = yield* rejection(() => client.rooms.get("NOPE00"));

      expect(error.code).toBe("ROOM_NOT_FOUND");
      expect(error.status).toBe(404);
      expect(error.message).toBe("Room 'NOPE00' was not found.");
      expect(error.hint).toBe(
        "List the rooms of this hub to see the codes that exist."
      );
      expect(error.details).toEqual({ roomCode: "NOPE00" });
      expect(error.requestId).toBeString();
    })
  );

  it.effect("an input the contract refuses is an invalid request", () =>
    Effect.gen(function* () {
      const client = yield* hubClient;

      const error = yield* rejection(() => client.rooms.create({ name: "" }));

      expect(error.code).toBe("INVALID_REQUEST");
      expect(error.message).toBe(
        "The request is invalid: name: Expected a value with a length of at least 1"
      );
      expect(error.status).toBeUndefined();
      expect(error.details).toEqual({
        issues: [
          {
            path: ["name"],
            message: "Expected a value with a length of at least 1",
          },
        ],
      });
    })
  );

  it.effect("a field left undefined is a field not given", () =>
    Effect.gen(function* () {
      const client = yield* hubClient;

      // What a form sends for the optional fields left empty.
      const { room } = yield* Effect.promise(() =>
        client.rooms.create({
          name: "Frevo",
          password: undefined,
          defaults: { temperature: 0.2, seed: undefined },
        })
      );
      const registered = yield* Effect.promise(() =>
        client.participants.register(room.code, "arthur-1", {
          nickname: "Arthur",
          model: "llama3",
          endpoint: undefined,
          password: undefined,
          specs: { gpu: undefined, ram: 32 },
          config: undefined,
          version: undefined,
        })
      );

      expect(room.passwordProtected).toBe(false);
      expect(room.defaults).toEqual({
        hasInstructions: false,
        temperature: 0.2,
      });
      expect(registered.participant.specs).toEqual({ ram: 32 });
    })
  );

  it.effect("lists the rooms without what stays in the hub", () =>
    Effect.gen(function* () {
      const client = yield* hubClient;
      const { room } = yield* Effect.promise(() =>
        client.rooms.create({
          name: "Maracatu",
          password: "segredo",
          defaults: {
            instructions: "Responda em português.",
            temperature: 0.4,
          },
        })
      );

      const rooms = yield* Effect.promise(() => client.rooms.list());

      expect(rooms.find((listed) => listed.code === room.code)).toEqual({
        id: room.id,
        code: room.code,
        name: "Maracatu",
        hostId: room.hostId,
        createdAt: room.createdAt,
        defaults: { hasInstructions: true, temperature: 0.4 },
        passwordProtected: true,
        participantCount: 0,
      });
    })
  );

  it.effect("says the hub is healthy", () =>
    Effect.gen(function* () {
      const client = yield* hubClient;

      const health = yield* Effect.promise(() => client.hub.health());

      expect(health.status).toBe("ok");
      expect(health.timestamp).toBeNumber();
    })
  );
});

layer(layerHub(), { excludeTestServices: true })(
  "management client: participants",
  (it) => {
    it.effect("registers a participant, which starts offline", () =>
      Effect.gen(function* () {
        const client = yield* hubClient;
        const { room } = yield* Effect.promise(() =>
          client.rooms.create({ name: "Ciranda" })
        );

        const registered = yield* Effect.promise(() =>
          client.participants.register(room.code, "lia-1", {
            nickname: "Lia",
            model: "llama3",
            endpoint: "http://localhost:11434",
            config: { instructions: "Só entre nós.", temperature: 0.2 },
          })
        );
        const listed = yield* Effect.promise(() =>
          client.participants.list(room.code)
        );

        expect(registered.participant).toMatchObject({
          id: "lia-1",
          nickname: "Lia",
          model: "llama3",
          endpoint: "http://localhost:11434",
          config: { hasInstructions: true, temperature: 0.2 },
          status: "offline",
        });
        expect(registered.tunnel.token).toBeString();
        expect(registered.tunnel.expiresAt).toBeGreaterThan(
          registered.participant.joinedAt
        );
        expect(listed).toEqual([registered.participant]);
      })
    );

    it.effect("shows a participant with an open tunnel as online", () =>
      Effect.gen(function* () {
        const client = yield* hubClient;
        const { room } = yield* Effect.promise(() =>
          client.rooms.create({ name: "Coco" })
        );
        yield* joinParticipant({ roomCode: room.code, participantId: "ze-1" });

        const listed = yield* Effect.promise(() =>
          client.participants.list(room.code)
        );

        expect(listed.map(({ id, status }) => ({ id, status }))).toEqual([
          { id: "ze-1", status: "online" },
        ]);
      })
    );

    it.effect("takes a participant out of the room, once", () =>
      Effect.gen(function* () {
        const client = yield* hubClient;
        const { room } = yield* Effect.promise(() =>
          client.rooms.create({ name: "Baião" })
        );
        yield* joinParticipant({ roomCode: room.code, participantId: "ze-1" });

        const left = yield* Effect.promise(() =>
          client.participants.remove(room.code, "ze-1")
        );
        const again = yield* rejection(() =>
          client.participants.remove(room.code, "ze-1")
        );

        expect(left).toEqual({ participantId: "ze-1" });
        expect(
          yield* Effect.promise(() => client.participants.list(room.code))
        ).toEqual([]);
        expect(again.code).toBe("PARTICIPANT_NOT_FOUND");
        expect(again.details).toEqual({
          roomCode: room.code,
          participantId: "ze-1",
        });
      })
    );

    it.effect(
      "a registration that carries auth headers never leaves the machine",
      () =>
        Effect.gen(function* () {
          const client = yield* hubClient;
          const { room } = yield* Effect.promise(() =>
            client.rooms.create({ name: "Maxixe" })
          );
          // What a caller without the types could write.
          const withSecret = {
            nickname: "Lia",
            model: "llama3",
            authHeaders: { authorization: "Bearer segredo" },
          } as RegisterParticipantInput;

          const error = yield* rejection(() =>
            client.participants.register(room.code, "lia-1", withSecret)
          );

          expect(error.code).toBe("INVALID_REQUEST");
          // No status and no request id: the hub was never asked.
          expect(error.status).toBeUndefined();
          expect(error.requestId).toBeUndefined();
          expect(
            `${error.message} ${JSON.stringify(error.details)}`
          ).not.toContain("segredo");
          expect(
            yield* Effect.promise(() => client.participants.list(room.code))
          ).toEqual([]);
        })
    );

    it.effect("a registration without the room password is refused", () =>
      Effect.gen(function* () {
        const client = yield* hubClient;
        const { room } = yield* Effect.promise(() =>
          client.rooms.create({ name: "Xote", password: "segredo" })
        );

        const error = yield* rejection(() =>
          client.participants.register(room.code, "lia-1", {
            nickname: "Lia",
            model: "llama3",
          })
        );

        expect(error.code).toBe("INVALID_PASSWORD");
        expect(error.status).toBe(401);
      })
    );
  }
);

layer(layerHub(), { excludeTestServices: true })(
  "management client: room events",
  (it) => {
    it.effect(
      "a watch starts with the room as it is, then carries each change in order",
      () =>
        Effect.gen(function* () {
          const client = yield* hubClient;
          const { room } = yield* Effect.promise(() =>
            client.rooms.create({ name: "Caboclinho" })
          );
          const { participant: lia } = yield* Effect.promise(() =>
            client.participants.register(room.code, "lia-1", {
              nickname: "Lia",
              model: "llama3",
            })
          );
          const watch = client.events.watch(room.code)[Symbol.asyncIterator]();

          const snapshot = yield* nextEvent(watch);
          yield* joinParticipant({
            roomCode: room.code,
            participantId: "ze-1",
          });
          const joined = yield* nextEvent(watch);
          const online = yield* nextEvent(watch);
          yield* Effect.promise(() =>
            client.participants.remove(room.code, "ze-1")
          );
          const removed = yield* nextEvent(watch);

          expect(snapshot).toEqual({
            type: "room.snapshot",
            roomCode: room.code,
            timestamp: expect.any(Number),
            room: { ...room, participantCount: 1 },
            participants: [lia],
          });
          expect(joined).toMatchObject({
            type: "participant.joined",
            roomCode: room.code,
            participant: { id: "ze-1", status: "offline" },
          });
          expect(online).toMatchObject({
            type: "participant.online",
            previousStatus: "offline",
            participant: { id: "ze-1", status: "online" },
          });
          expect(removed).toMatchObject({
            type: "participant.removed",
            participantId: "ze-1",
            reason: "left",
          });
        })
    );

    it.effect("two reads asked for at once take two events, in order", () =>
      Effect.gen(function* () {
        const client = yield* hubClient;
        const { room } = yield* Effect.promise(() =>
          client.rooms.create({ name: "Afoxé" })
        );
        const watch = client.events.watch(room.code)[Symbol.asyncIterator]();

        const first = watch.next();
        const second = watch.next();
        const snapshot = yield* Effect.promise(() => first);
        yield* Effect.promise(() =>
          client.participants.register(room.code, "lia-1", {
            nickname: "Lia",
            model: "llama3",
          })
        );
        const joined = yield* Effect.promise(() => second);

        expect(snapshot.value?.type).toBe("room.snapshot");
        expect(joined.value?.type).toBe("participant.joined");
      })
    );

    it.effect("a watch carries each inference request of the room", () =>
      Effect.gen(function* () {
        const hub = yield* Hub;
        const client = yield* hubClient;
        const { room } = yield* Effect.promise(() =>
          client.rooms.create({ name: "Bumba meu boi" })
        );
        const local = yield* fakeProvider();
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "ze-1",
          profile: { model: "llama3" },
          provider: { endpoint: local.url },
        });
        const watch = client.events.watch(room.code)[Symbol.asyncIterator]();
        yield* nextEvent(watch);

        yield* Effect.promise(() =>
          fetch(`${hub.url}/rooms/${room.code}/v1/chat/completions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              model: "*",
              messages: [{ role: "user", content: "Oi" }],
            }),
          }).then((response) => response.text())
        );
        const busy = yield* nextEvent(watch);
        const requested = yield* nextEvent(watch);
        const completed = yield* nextEvent(watch);
        const online = yield* nextEvent(watch);

        expect(busy.type).toBe("participant.busy");
        expect(requested).toMatchObject({
          type: "llm.request",
          participantId: "ze-1",
          model: "llama3",
          modelSelector: "*",
          protocol: "chatCompletions",
        });
        expect(completed).toMatchObject({
          type: "llm.complete",
          participantId: "ze-1",
          status: 200,
          metrics: { inputTokens: 3, outputTokens: 4, totalTokens: 7 },
        });
        expect(online.type).toBe("participant.online");
      })
    );

    it.effect(
      "watching a room that does not exist rejects with the hub's error",
      () =>
        Effect.gen(function* () {
          const client = yield* hubClient;
          const watch = client.events.watch("NOPE00")[Symbol.asyncIterator]();

          const error = yield* rejection(() => watch.next());

          expect(error.code).toBe("ROOM_NOT_FOUND");
          expect(error.details).toEqual({ roomCode: "NOPE00" });
        })
    );

    it.effect("a watch ends, without an error, when its signal aborts", () =>
      Effect.gen(function* () {
        const client = yield* hubClient;
        const { room } = yield* Effect.promise(() =>
          client.rooms.create({ name: "Cavalo-marinho" })
        );
        const stop = new AbortController();
        const watch = client.events
          .watch(room.code, { signal: stop.signal })
          [Symbol.asyncIterator]();
        yield* nextEvent(watch);

        const waiting = watch.next();
        stop.abort();

        expect(yield* Effect.promise(() => waiting)).toEqual({
          done: true,
          value: undefined,
        });
      })
    );

    it.effect(
      "closing the client ends its watches and refuses later calls",
      () =>
        Effect.gen(function* () {
          const hub = yield* Hub;
          const client = createClient({ hubUrl: hub.url });
          const { room } = yield* Effect.promise(() =>
            client.rooms.create({ name: "Pastoril" })
          );
          const watch = client.events.watch(room.code)[Symbol.asyncIterator]();
          yield* nextEvent(watch);

          const waiting = watch.next();
          yield* Effect.promise(() => client.close());
          const refused = yield* Effect.promise(() =>
            client.rooms.list().then(
              () => undefined,
              (error: unknown) => error
            )
          );

          expect((yield* Effect.promise(() => waiting)).done).toBe(true);
          expect(refused).toEqual(new Error("The client is closed."));
          expect(() => client.events.watch(room.code)).toThrow(
            "The client is closed."
          );
        })
    );
  }
);

describe("management client: the end of a watch", () => {
  it.live("a watch ends, without an error, when the hub closes", () =>
    Effect.gen(function* () {
      const hubScope = yield* Scope.make();
      const hub = yield* Layer.buildWithScope(layerHub(), hubScope).pipe(
        Effect.map(Context.get(Hub))
      );
      const client = createClient({ hubUrl: hub.url });
      const { room } = yield* Effect.promise(() =>
        client.rooms.create({ name: "Reisado" })
      );
      const watch = client.events.watch(room.code)[Symbol.asyncIterator]();
      yield* nextEvent(watch);

      const waiting = watch.next();
      yield* Scope.close(hubScope, Exit.void);

      expect(yield* Effect.promise(() => waiting)).toEqual({
        done: true,
        value: undefined,
      });
    })
  );

  it.live("leaving the loop cancels the request to the hub", () =>
    Effect.gen(function* () {
      const hub = yield* quietHub;
      const client = createClient({ hubUrl: hub.url });
      const seen: RoomEvent[] = [];

      yield* Effect.promise(async () => {
        for await (const event of client.events.watch("ABC123")) {
          seen.push(event);
          break;
        }
      });
      yield* Deferred.await(hub.cancelled);

      expect(seen).toEqual([SNAPSHOT]);
    })
  );

  it.live(
    "aborting a watch nobody is reading cancels the request to the hub",
    () =>
      Effect.gen(function* () {
        const hub = yield* quietHub;
        const client = createClient({ hubUrl: hub.url });
        const stop = new AbortController();
        const watch = client.events
          .watch("ABC123", { signal: stop.signal })
          [Symbol.asyncIterator]();
        yield* nextEvent(watch);

        stop.abort();
        yield* Deferred.await(hub.cancelled);

        expect(yield* Effect.promise(() => watch.next())).toEqual({
          done: true,
          value: undefined,
        });
      })
  );

  it.live("closing the client cancels a watch nobody is reading", () =>
    Effect.gen(function* () {
      const hub = yield* quietHub;
      const client = createClient({ hubUrl: hub.url });
      const watch = client.events.watch("ABC123")[Symbol.asyncIterator]();
      yield* nextEvent(watch);

      yield* Effect.promise(() => client.close());
      yield* Deferred.await(hub.cancelled);

      expect(yield* Effect.promise(() => watch.next())).toEqual({
        done: true,
        value: undefined,
      });
    })
  );

  it.live("closing the client refuses the call it interrupts", () =>
    Effect.gen(function* () {
      const asked = yield* Deferred.make<void>();
      // Takes the request and never answers it.
      const hubUrl = yield* serving(() => {
        Effect.runFork(Deferred.succeed(asked, undefined));
        return new Promise<Response>(() => undefined);
      });
      const client = createClient({ hubUrl });

      const listing = client.rooms.list().then(
        () => undefined,
        (error: unknown) => error
      );
      yield* Deferred.await(asked);
      yield* Effect.promise(() => client.close());

      expect(yield* Effect.promise(() => listing)).toEqual(
        new Error("The client is closed.")
      );
    })
  );
});

describe("management client and the version of the hub", () => {
  it.live("a registration from another minor version is refused", () =>
    Effect.gen(function* () {
      const client = yield* hubClient;
      const { room } = yield* Effect.promise(() =>
        client.rooms.create({ name: "Forró" })
      );

      const error = yield* rejection(() =>
        client.participants.register(room.code, "lia-1", {
          nickname: "Lia",
          model: "llama3",
          version: "0.7.9",
        })
      );

      expect(error.code).toBe("VERSION_MISMATCH");
      expect(error.status).toBe(409);
      expect(error.details).toEqual({
        hubVersion: "0.8.3",
        participantVersion: "0.7.9",
      });
    }).pipe(Effect.provide(layerHub({ version: "0.8.3" })))
  );
});

describe("management client away from a hub", () => {
  it.live("nothing listening at the hub URL is an unreachable hub", () =>
    Effect.gen(function* () {
      const hubUrl = yield* Effect.scoped(serving(() => new Response("gone")));
      const client = createClient({ hubUrl });

      const error = yield* rejection(() => client.rooms.list());

      expect(error.code).toBe("HUB_UNREACHABLE");
      expect(error.message).toBe(`Could not reach a hub at ${hubUrl}.`);
      expect(error.status).toBeUndefined();
      expect(error.details).toEqual({ hubUrl });
    })
  );

  it.live("a server that answers something else is not a hub", () =>
    Effect.gen(function* () {
      const hubUrl = yield* serving(
        () =>
          new Response("<html></html>", {
            headers: { "content-type": "text/html" },
          })
      );
      const client = createClient({ hubUrl });

      const error = yield* rejection(() => client.rooms.list());

      expect(error.code).toBe("NOT_A_HUB");
      expect(error.message).toBe(
        `The server at ${hubUrl} did not answer like a Gambi hub.`
      );
      expect(error.details).toEqual({ hubUrl });
    })
  );

  it.live(
    "a status outside the contract is not a hub, and says the status",
    () =>
      Effect.gen(function* () {
        const hubUrl = yield* serving(
          () => new Response("nope", { status: 404 })
        );
        const client = createClient({ hubUrl });

        const error = yield* rejection(() => client.rooms.get("ABC123"));
        const watching = client.events.watch("ABC123")[Symbol.asyncIterator]();
        const watchError = yield* rejection(() => watching.next());

        expect(error.code).toBe("NOT_A_HUB");
        expect(error.status).toBe(404);
        expect(error.message).toBe(
          `The server at ${hubUrl} did not answer like a Gambi hub (HTTP 404).`
        );
        expect(watchError.code).toBe("NOT_A_HUB");
        expect(watchError.status).toBe(404);
      })
  );
});
