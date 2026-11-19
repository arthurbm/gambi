import { expect } from "bun:test";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub, managementClient, watchRoom } from "@gambi/core/testing/hub";
import { linkToHub } from "@gambi/core/testing/hub-link";
import { joinParticipant } from "@gambi/core/testing/participant";
import { FAKE_MODEL, fakeProvider } from "@gambi/core/testing/provider";
import { GAMBI_VERSION } from "@gambi/protocol";
import { it } from "@gambi/testing/effect";
import { Context, Deferred, Effect, Exit, Layer, Scope } from "effect";
import { TestClock } from "effect/testing";
import { type RunningCommand, runCommand, startCommand } from "./testing.ts";

// The hub of these tests is built inside each test, so it reads the test
// clock, and it pings every hour: moving the clock by the wait of a
// reconnection must not also trip the hub's ping timeout.
const TestHub = layerHub({ tunnelPingInterval: "1 hour" });

/** A hub in a scope of its own, so that the test decides when it stops. */
const startHub = (port?: number) =>
  Effect.gen(function* () {
    const scope = yield* Scope.fork(yield* Effect.scope);
    const context = yield* Layer.buildWithScope(
      layerHub({ tunnelPingInterval: "1 hour", port }),
      scope
    );
    return { context, stop: Scope.close(scope, Exit.void) };
  });

/** `participant join` with a model endpoint, read up to its `tunnel_connected`. */
const joinRoom = (hubUrl: string, roomCode: string) =>
  Effect.gen(function* () {
    const provider = yield* fakeProvider();
    const joining = yield* startCommand([
      "participant",
      "join",
      "--room",
      roomCode,
      "--participant-id",
      "arthur-1",
      "--model",
      FAKE_MODEL,
      "--endpoint",
      provider.url,
      "--no-specs",
      "--hub",
      hubUrl,
    ]);
    const read = [
      (yield* joining.nextEvent).type,
      (yield* joining.nextEvent).type,
    ];
    return read.join() === "registered,tunnel_connected"
      ? joining
      : yield* Effect.die(new Error(`The join started with ${read.join()}.`));
  });

const newRoom = Effect.gen(function* () {
  const client = yield* managementClient;
  return (yield* client.rooms.create({ payload: { name: "Frevo" } })).room;
});

const failureOf = (running: RunningCommand) =>
  Effect.map(running.result, (result) => ({
    exitCode: result.exitCode,
    error: JSON.parse(result.stderr.trim().split("\n").at(-1) ?? "{}").error,
  }));

it.effect(
  "says that it lost the hub and when it tries again, and that it is back",
  () =>
    Effect.gen(function* () {
      const room = yield* newRoom;
      const link = yield* linkToHub;
      const joining = yield* joinRoom(link.url, room.code);

      yield* link.cut;
      expect(yield* joining.nextEvent).toMatchObject({
        type: "reconnecting",
        data: {
          roomCode: room.code,
          participantId: "arthur-1",
          attempt: 1,
          delayMillis: 1000,
          reason: "tunnelDropped",
        },
      });
      yield* link.restore;
      yield* TestClock.adjust("1 second");
      expect(yield* joining.nextEvent).toMatchObject({
        type: "tunnel_connected",
        data: { roomCode: room.code, participantId: "arthur-1", attempt: 1 },
      });

      yield* joining.signal("SIGINT");
      expect((yield* joining.result).exitCode).toBe(0);
    }).pipe(Effect.provide(TestHub))
);

it.effect(
  "replaced by another runtime with its participant id, it ends as a remote rejection and leaves that one in the room",
  () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      const client = yield* managementClient;
      const room = yield* newRoom;
      const joining = yield* joinRoom(hub.url, room.code);

      yield* joinParticipant({
        roomCode: room.code,
        participantId: "arthur-1",
      });

      expect(yield* joining.nextEvent).toMatchObject({
        type: "left",
        data: {
          roomCode: room.code,
          participantId: "arthur-1",
          reason: "replaced",
          removed: false,
        },
      });
      expect(yield* failureOf(joining)).toMatchObject({
        exitCode: 4,
        error: {
          name: "ParticipantReplaced",
          message: `Another participant runtime joined room '${room.code}' as 'arthur-1', and the hub kept that one.`,
          details: { roomCode: room.code, participantId: "arthur-1" },
        },
      });
      // The participant with that id is the other runtime now: it stays.
      expect(
        yield* client.participants.list({ params: { code: room.code } })
      ).toMatchObject([{ id: "arthur-1", status: "online" }]);
    }).pipe(Effect.provide(TestHub))
);

it.effect(
  "taken out of the room by `participant leave`, it ends as a remote rejection and never comes back: the room stays empty",
  () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      const client = yield* managementClient;
      const room = yield* newRoom;
      const joining = yield* joinRoom(hub.url, room.code);
      const watch = yield* watchRoom(room.code);

      const leaving = yield* runCommand([
        "participant",
        "leave",
        "--room",
        room.code,
        "--participant-id",
        "arthur-1",
        "--hub",
        hub.url,
      ]);

      expect(leaving).toMatchObject({ exitCode: 0, stderr: "" });
      // The participant is out of the room, and the runtime knows it.
      expect(yield* joining.nextEvent).toMatchObject({
        type: "left",
        data: {
          roomCode: room.code,
          participantId: "arthur-1",
          reason: "removed",
          removed: true,
        },
      });
      expect(yield* failureOf(joining)).toMatchObject({
        exitCode: 4,
        error: {
          name: "ParticipantRemoved",
          message: `Participant 'arthur-1' was taken out of room '${room.code}'.`,
          details: { roomCode: room.code, participantId: "arthur-1" },
        },
      });
      // The longest wait of a reconnection passes and nobody registers.
      yield* TestClock.adjust("31 seconds");
      expect(
        yield* client.participants.list({ params: { code: room.code } })
      ).toEqual([]);
      // The room heard that it left, and the next thing it hears is someone
      // else joining: the participant never came back in between.
      expect(yield* watch.next).toMatchObject({
        type: "participant.removed",
        participantId: "arthur-1",
        reason: "left",
      });
      yield* joinParticipant({ roomCode: room.code, participantId: "ze-1" });
      expect(yield* watch.next).toMatchObject({
        type: "participant.joined",
        participant: { id: "ze-1" },
      });
    }).pipe(Effect.provide(TestHub))
);

it.effect(
  "refused by the hub on its way back, it ends with the hub's refusal",
  () =>
    Effect.gen(function* () {
      const first = yield* startHub();
      const { hubUrl, joining, port, roomCode } = yield* Effect.gen(
        function* () {
          const hub = yield* Hub;
          const room = yield* newRoom;
          return {
            hubUrl: hub.url,
            port: hub.port,
            roomCode: room.code,
            joining: yield* joinRoom(hub.url, room.code),
          };
        }
      ).pipe(Effect.provide(first.context));

      // A hub that restarts comes back without its rooms.
      yield* first.stop;
      expect((yield* joining.nextEvent).type).toBe("reconnecting");
      const second = yield* startHub(port);
      expect(Context.get(second.context, Hub).url).toBe(hubUrl);
      yield* TestClock.adjust("1 second");

      expect(yield* joining.nextEvent).toMatchObject({
        type: "left",
        data: { roomCode, reason: "refused", removed: false },
      });
      expect(yield* failureOf(joining)).toMatchObject({
        exitCode: 4,
        error: { name: "RoomNotFound", details: { roomCode } },
      });
    })
);

it.effect(
  "told to leave while the hub is gone, it stops and says the hub did not confirm",
  () =>
    Effect.gen(function* () {
      const hub = yield* startHub();
      const joining = yield* Effect.gen(function* () {
        const room = yield* newRoom;
        return yield* joinRoom((yield* Hub).url, room.code);
      }).pipe(Effect.provide(hub.context));

      yield* hub.stop;
      expect((yield* joining.nextEvent).type).toBe("reconnecting");
      yield* joining.signal("SIGTERM");

      expect((yield* joining.nextEvent).type).toBe("leaving");
      expect(yield* joining.nextEvent).toMatchObject({
        type: "left",
        data: { reason: "stopped", removed: false },
      });
      expect((yield* joining.result).exitCode).toBe(0);
    })
);

/**
 * A server in front of the hub of the test that passes plain requests on
 * and never answers `held`: the tunnel's WebSocket upgrade, the registration
 * (which then never reaches the hub), or everything.
 */
const hubThatHolds = (held: "the tunnel" | "the registration" | "everything") =>
  Effect.gen(function* () {
    const hub = yield* Hub;
    const holding = Deferred.makeUnsafe<void>();
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          idleTimeout: 0,
          fetch: async (request) => {
            const isHeld =
              held === "everything" ||
              (held === "the tunnel" && request.headers.has("upgrade")) ||
              (held === "the registration" && request.method === "PUT");
            if (isHeld) {
              Deferred.doneUnsafe(holding, Effect.void);
              return new Promise<Response>(() => undefined);
            }
            const { pathname, search } = new URL(request.url);
            return fetch(`${hub.url}${pathname}${search}`, {
              method: request.method,
              headers: request.headers,
              body: await request.text(),
            });
          },
        })
      ),
      (running) => Effect.promise(() => running.stop(true))
    );
    return {
      url: `http://127.0.0.1:${server.port}`,
      /** Completes when the server is holding its first request. */
      holding: Deferred.await(holding),
    };
  });

it.effect(
  "told to leave after it registered and before its tunnel opened, it still leaves the room and ends with 0",
  () =>
    Effect.gen(function* () {
      const room = yield* newRoom;
      const provider = yield* fakeProvider();
      const watch = yield* watchRoom(room.code);
      const joining = yield* startCommand([
        "participant",
        "join",
        "--room",
        room.code,
        "--participant-id",
        "arthur-1",
        "--model",
        FAKE_MODEL,
        "--endpoint",
        provider.url,
        "--no-specs",
        "--hub",
        (yield* hubThatHolds("the tunnel")).url,
      ]);
      expect((yield* watch.next).type).toBe("participant.joined");

      yield* joining.signal("SIGINT");

      expect(yield* joining.nextEvent).toMatchObject({
        type: "leaving",
        data: { roomCode: room.code, signal: "SIGINT" },
      });
      expect(yield* joining.nextEvent).toMatchObject({
        type: "left",
        data: { reason: "stopped", removed: true },
      });
      expect((yield* joining.result).exitCode).toBe(0);
      expect(yield* watch.next).toMatchObject({
        type: "participant.removed",
        reason: "left",
      });
    }).pipe(Effect.provide(TestHub))
);

it.effect(
  "told to leave while the hub has not answered the registration, it ends with 0 without waiting for the hub",
  () =>
    Effect.gen(function* () {
      const room = yield* newRoom;
      const provider = yield* fakeProvider();
      const frozen = yield* hubThatHolds("everything");
      const joining = yield* startCommand([
        "participant",
        "join",
        "--room",
        room.code,
        "--participant-id",
        "arthur-1",
        "--model",
        FAKE_MODEL,
        "--endpoint",
        provider.url,
        "--no-specs",
        "--hub",
        frozen.url,
      ]);
      // The registration reached the hub, which does not answer it.
      yield* frozen.holding;

      yield* joining.signal("SIGTERM");

      expect((yield* joining.nextEvent).type).toBe("leaving");
      // The hub does not answer the removal either; leaving gives up on it.
      yield* TestClock.adjust("3 seconds");
      expect(yield* joining.nextEvent).toMatchObject({
        type: "left",
        data: { reason: "stopped", removed: false },
      });
      expect((yield* joining.result).exitCode).toBe(0);
    }).pipe(Effect.provide(TestHub))
);

/**
 * `participant join` as `arthur-1`, told to leave while its registration is
 * still on its way to the hub, in a room where another runtime is already
 * `arthur-1`: `online`, or `offline` because it only registered so far.
 */
const signalledBeforeItRegistered = (
  other: "online" | "offline",
  ...flags: readonly string[]
) =>
  Effect.gen(function* () {
    const client = yield* managementClient;
    const room = yield* newRoom;
    const provider = yield* fakeProvider();
    yield* other === "online"
      ? joinParticipant({ roomCode: room.code, participantId: "arthur-1" })
      : client.participants.register({
          params: { code: room.code, id: "arthur-1" },
          payload: {
            nickname: "Arthur",
            model: FAKE_MODEL,
            runtimeId: "another-runtime",
            version: GAMBI_VERSION,
          },
        });
    const slow = yield* hubThatHolds("the registration");
    const joining = yield* startCommand([
      "participant",
      "join",
      "--room",
      room.code,
      "--participant-id",
      "arthur-1",
      "--model",
      FAKE_MODEL,
      "--endpoint",
      provider.url,
      "--no-specs",
      "--hub",
      slow.url,
      ...flags,
    ]);
    yield* slow.holding;
    yield* joining.signal("SIGTERM");
    return {
      joining,
      roomCode: room.code,
      participants: client.participants.list({ params: { code: room.code } }),
    };
  });

it.effect(
  "told to leave before its registration reached the hub, it does not take out of the room who is online with its participant id",
  () =>
    Effect.gen(function* () {
      const { joining, participants } =
        yield* signalledBeforeItRegistered("online");

      expect((yield* joining.nextEvent).type).toBe("leaving");
      expect(yield* joining.nextEvent).toMatchObject({
        type: "left",
        data: { reason: "stopped", removed: false },
      });
      expect((yield* joining.result).exitCode).toBe(0);
      expect(yield* participants).toMatchObject([
        { id: "arthur-1", status: "online" },
      ]);
    }).pipe(Effect.provide(TestHub))
);

// What the review of #122 left open (S6): an entry that is offline looks like
// the one this command would have registered, and is another runtime's.
it.effect(
  "nor who is offline with its participant id: a participant another runtime registered stays in the room",
  () =>
    Effect.gen(function* () {
      const { joining, participants } =
        yield* signalledBeforeItRegistered("offline");

      expect((yield* joining.nextEvent).type).toBe("leaving");
      expect(yield* joining.nextEvent).toMatchObject({
        type: "left",
        data: { reason: "stopped", removed: false },
      });
      expect((yield* joining.result).exitCode).toBe(0);
      expect(yield* participants).toMatchObject([
        { id: "arthur-1", status: "offline", runtimeId: "another-runtime" },
      ]);
    }).pipe(Effect.provide(TestHub))
);

it.effect(
  "and it tells the person that the participant in the room is another one, not that the hub did not confirm",
  () =>
    Effect.gen(function* () {
      const { joining, roomCode } = yield* signalledBeforeItRegistered(
        "online",
        "--format",
        "text",
        "--log-level",
        "none"
      );

      expect(yield* joining.nextLine).toBe(
        `Leaving room ${roomCode} (SIGTERM)...`
      );
      expect(yield* joining.nextLine).toBe(
        `Stopped. Another participant runtime holds arthur-1 in room ${roomCode}, and it stays there.`
      );
      expect((yield* joining.result).exitCode).toBe(0);
    }).pipe(Effect.provide(TestHub))
);
