import { expect } from "bun:test";
import { connect, createServer, type Socket } from "node:net";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub } from "@gambi/core/testing/hub";
import { linkToHub } from "@gambi/core/testing/hub-link";
import {
  chatCompletionsOnly,
  FAKE_MODEL,
  fakeProvider,
} from "@gambi/core/testing/provider";
import { it, layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { createClient } from "./client.ts";
import {
  createParticipantSession,
  ParticipantError,
  type ParticipantLifecycleEvent,
  type ParticipantSessionOptions,
  probeProvider,
} from "./participant.ts";
import type { RoomEvent } from "./types.ts";

/** The management client a consumer would build for the hub of the block. */
const hubClient = Effect.gen(function* () {
  const hub = yield* Hub;
  const client = createClient({ hubUrl: hub.url });
  yield* Effect.addFinalizer(() => Effect.promise(() => client.close()));
  return client;
});

/** A room of the hub of the block. */
const frevo = Effect.gen(function* () {
  const hub = yield* Hub;
  const client = yield* hubClient;
  const { room } = yield* Effect.promise(() =>
    client.rooms.create({ name: "Frevo" })
  );
  return { client, hubUrl: hub.url, roomCode: room.code };
});

/**
 * The events of a room from now on, one at a time. It returns once the
 * stream is open: its snapshot was read.
 */
const watching = (roomCode: string) =>
  Effect.gen(function* () {
    const client = yield* hubClient;
    const events = client.events.watch(roomCode)[Symbol.asyncIterator]();
    const next = Effect.promise(async (): Promise<RoomEvent> => {
      const result = await events.next();
      if (result.done === true) {
        throw new Error("The watch ended.");
      }
      return result.value;
    });
    yield* next;
    return { next };
  });

/** The `ParticipantError` a join rejects with. Any other outcome fails the test. */
const rejection = (options: ParticipantSessionOptions) =>
  Effect.promise(() =>
    createParticipantSession(options).then(
      (): ParticipantError => {
        throw new Error("Expected the join to be refused.");
      },
      (error: unknown): ParticipantError => {
        if (error instanceof ParticipantError) {
          return error;
        }
        throw error;
      }
    )
  );

/** A participant that shares a provider that is not there: enough to be in a room. */
const arthur = (room: { hubUrl: string; roomCode: string }) => ({
  ...room,
  participantId: "arthur-1",
  nickname: "Arthur",
  model: "llama3",
  endpoint: "http://127.0.0.1:1",
});

/**
 * A TCP relay in front of the hub of the block that can stop passing on
 * requests to leave a room, the way a hub that stopped answering does: the
 * `DELETE` is accepted and never answered. `abandoned` completes when the
 * client closes the connection of a request held like that.
 */
const hubThatStopsAnsweringLeaves = Effect.gen(function* () {
  const hub = yield* Hub;
  const upstreamPort = Number(new URL(hub.url).port);
  const abandoned = Promise.withResolvers<void>();
  const sockets = new Set<Socket>();
  let holding = false;
  const server = yield* Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<ReturnType<typeof createServer>>((resolve) => {
          const relay = createServer((client) => {
            const upstream = connect(upstreamPort, "127.0.0.1");
            let held = false;
            sockets.add(client).add(upstream);
            client.on("data", (chunk) => {
              if (holding && chunk.toString("latin1").startsWith("DELETE ")) {
                held = true;
              }
              if (!held) {
                upstream.write(chunk);
              }
            });
            upstream.on("data", (chunk) => client.write(chunk));
            client.on("close", () => {
              if (held) {
                abandoned.resolve();
              }
              upstream.destroy();
            });
            upstream.on("close", () => client.destroy());
            client.on("error", () => undefined);
            upstream.on("error", () => undefined);
          });
          relay.listen(0, "127.0.0.1", () => resolve(relay));
        })
    ),
    (relay) =>
      Effect.sync(() => {
        for (const socket of sockets) {
          socket.destroy();
        }
        relay.close();
      })
  );
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    /** Completes when the client gave up a request to leave it had sent. */
    abandoned: Effect.promise(() => abandoned.promise),
    stopAnsweringLeaves: Effect.sync(() => {
      holding = true;
    }),
    url: `http://127.0.0.1:${port}`,
  };
});

/** A participant session, stopped when the test ends if it did not leave. */
const joined = (options: ParticipantSessionOptions) =>
  Effect.acquireRelease(
    Effect.promise(() => createParticipantSession(options)),
    (session) => Effect.promise(() => session.stop())
  );

layer(layerHub(), { excludeTestServices: true })(
  "participant session",
  (it) => {
    it.effect(
      "joins a room and serves inference with the provider of this machine",
      () =>
        Effect.gen(function* () {
          const { client, hubUrl, roomCode } = yield* frevo;
          const provider = yield* fakeProvider();

          const session = yield* joined({
            hubUrl,
            roomCode,
            participantId: "arthur-1",
            nickname: "Arthur",
            model: "llama3",
            endpoint: provider.url,
            authHeaders: { Authorization: "Bearer segredo" },
            capabilities: {
              chatCompletions: "supported",
              openResponses: "unknown",
            },
          });
          const response = yield* Effect.promise(() =>
            fetch(`${hubUrl}/rooms/${roomCode}/v1/chat/completions`, {
              method: "POST",
              body: JSON.stringify({
                model: "arthur-1",
                messages: [{ role: "user", content: "Oi" }],
              }),
            })
          );
          const call = yield* provider.nextCall;
          const participants = yield* Effect.promise(() =>
            client.participants.list(roomCode)
          );

          expect(session.participant).toMatchObject({
            id: "arthur-1",
            nickname: "Arthur",
            model: "llama3",
            endpoint: provider.url,
          });
          expect(response.status).toBe(200);
          expect(call.path).toBe("/v1/chat/completions");
          expect(call.headers.authorization).toBe("Bearer segredo");
          // `ParticipantAuthHeaders` stay on this machine.
          expect(JSON.stringify(participants)).not.toContain("segredo");
          expect(
            participants.map((participant) => [
              participant.id,
              participant.status,
            ])
          ).toEqual([["arthur-1", "online"]]);
        })
    );

    it.effect(
      "leaving takes the participant out of the room at once, and the session ends",
      () =>
        Effect.gen(function* () {
          const room = yield* frevo;
          const lifecycle: ParticipantLifecycleEvent[] = [];
          const session = yield* joined({
            ...arthur(room),
            onLifecycle: (event) => lifecycle.push(event),
          });
          const watch = yield* watching(room.roomCode);

          yield* Effect.promise(() => session.leave());

          // One event: the room never saw the participant offline in between.
          expect(yield* watch.next).toMatchObject({
            type: "participant.removed",
            participantId: "arthur-1",
            reason: "left",
          });
          expect(yield* Effect.promise(() => session.ended)).toEqual({
            reason: "stopped",
          });
          expect(lifecycle.map((event) => event.type)).toEqual([
            "connected",
            "left",
          ]);
          expect(lifecycle[0]).toMatchObject({
            roomCode: room.roomCode,
            participantId: "arthur-1",
            attempt: 0,
          });
        })
    );

    it.effect(
      "stopping leaves the participant in the room, offline, for the hub to remove",
      () =>
        Effect.gen(function* () {
          const room = yield* frevo;
          const session = yield* joined(arthur(room));
          const watch = yield* watching(room.roomCode);

          yield* Effect.promise(() => session.stop());

          expect(yield* watch.next).toMatchObject({
            type: "participant.offline",
            participant: { id: "arthur-1" },
          });
          expect(yield* Effect.promise(() => session.ended)).toEqual({
            reason: "stopped",
          });
          const participants = yield* Effect.promise(() =>
            room.client.participants.list(room.roomCode)
          );
          expect(participants.map((participant) => participant.id)).toEqual([
            "arthur-1",
          ]);
        })
    );

    it.effect(
      "leaving gives up on a hub that does not answer, and takes back its request",
      () =>
        Effect.gen(function* () {
          const room = yield* frevo;
          const hub = yield* hubThatStopsAnsweringLeaves;
          const session = yield* joined({
            ...arthur(room),
            hubUrl: hub.url,
            // Long enough for the request to have reached the relay.
            leaveTimeoutMs: 100,
          });
          const watch = yield* watching(room.roomCode);

          yield* hub.stopAnsweringLeaves;
          yield* Effect.promise(() => session.leave());
          // The request does not stay behind to take effect later, when the
          // participant with this id may be someone else.
          yield* hub.abandoned;

          // The hub never heard the participant leave: it saw its tunnel drop.
          expect(yield* watch.next).toMatchObject({
            type: "participant.offline",
            participant: { id: "arthur-1" },
          });
        })
    );

    it.effect(
      "a session that ended when its tunnel dropped is still this participant: leaving takes it out of the room",
      () =>
        Effect.gen(function* () {
          const room = yield* frevo;
          const link = yield* linkToHub;
          const session = yield* joined({
            ...arthur(room),
            hubUrl: link.url,
            reconnect: false,
          });
          const watch = yield* watching(room.roomCode);

          yield* link.cut;
          const end = yield* Effect.promise(() => session.ended);
          const offline = yield* watch.next;
          yield* link.restore;
          yield* Effect.promise(() => session.leave());

          expect(end).toEqual({ reason: "tunnelDropped" });
          expect(offline.type).toBe("participant.offline");
          expect(yield* watch.next).toMatchObject({
            type: "participant.removed",
            participantId: "arthur-1",
            reason: "left",
          });
        })
    );

    it.effect("a room that does not exist refuses the join", () =>
      Effect.gen(function* () {
        const room = yield* frevo;

        const error = yield* rejection({
          ...arthur(room),
          roomCode: "NOPE00",
        });

        expect(error.code).toBe("ROOM_NOT_FOUND");
        expect(error.message).toBe("Room 'NOPE00' was not found.");
        expect(error.details).toEqual({ roomCode: "NOPE00" });
      })
    );

    it.effect("an option left undefined is an option not given", () =>
      Effect.gen(function* () {
        const room = yield* frevo;

        // What a form sends for the fields left empty.
        const session = yield* joined({
          ...arthur(room),
          authHeaders: undefined,
          capabilities: undefined,
          config: { temperature: undefined },
          leaveTimeoutMs: undefined,
          onLifecycle: undefined,
          onLog: undefined,
          password: undefined,
          reconnect: undefined,
          specs: { gpu: undefined, ram: 32 },
        });

        expect(session.participant.specs).toEqual({ ram: 32 });
        expect(session.participant.config).toEqual({ hasInstructions: false });
      })
    );

    it.effect(
      "says which inference APIs the provider answers, as probed on this machine",
      () =>
        Effect.gen(function* () {
          const room = yield* frevo;
          const provider = yield* fakeProvider({ answer: chatCompletionsOnly });

          const session = yield* joined({
            ...arthur(room),
            endpoint: provider.url,
            authHeaders: { Authorization: "Bearer segredo" },
          });

          expect(session.participant.capabilities).toEqual({
            chatCompletions: "supported",
            openResponses: "unsupported",
          });
          const calls = yield* provider.calls;
          expect(
            calls.every(
              (call) => call.headers.authorization === "Bearer segredo"
            )
          ).toBe(true);
        })
    );

    it.effect(
      "a session replaced by another with its participant id ends, and leaving it leaves the other in the room",
      () =>
        Effect.gen(function* () {
          const room = yield* frevo;
          const first = yield* joined(arthur(room));

          yield* joined({ ...arthur(room), nickname: "Arthur, again" });
          const end = yield* Effect.promise(() => first.ended);
          yield* Effect.promise(() => first.leave());

          expect(end).toEqual({ reason: "replaced" });
          const participants = yield* Effect.promise(() =>
            room.client.participants.list(room.roomCode)
          );
          expect(
            participants.map((participant) => [
              participant.nickname,
              participant.status,
            ])
          ).toEqual([["Arthur, again", "online"]]);
        })
    );
  }
);

it.live("probes the provider of this machine, with its auth headers", () =>
  Effect.gen(function* () {
    const provider = yield* fakeProvider({ answer: chatCompletionsOnly });

    const probe = yield* Effect.promise(() =>
      probeProvider(provider.url, { Authorization: "Bearer segredo" })
    );

    expect(probe).toEqual({
      reachable: true,
      models: [FAKE_MODEL],
      capabilities: {
        openResponses: "unsupported",
        chatCompletions: "supported",
      },
    });
    const calls = yield* provider.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(
      calls.every((call) => call.headers.authorization === "Bearer segredo")
    ).toBe(true);
  })
);

it.live("a provider that is not there is a probe that found nothing", () =>
  Effect.gen(function* () {
    const probe = yield* Effect.promise(() =>
      probeProvider("http://127.0.0.1:1", undefined)
    );

    expect(probe).toEqual({
      reachable: false,
      models: [],
      capabilities: { openResponses: "unknown", chatCompletions: "unknown" },
    });
  })
);
