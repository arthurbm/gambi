import { expect } from "bun:test";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub, managementClient } from "@gambi/core/testing/hub";
import { linkToHub } from "@gambi/core/testing/hub-link";
import { joinParticipant } from "@gambi/core/testing/participant";
import { FAKE_MODEL, fakeProvider } from "@gambi/core/testing/provider";
import { it } from "@gambi/testing/effect";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { TestClock } from "effect/testing";
import { type RunningCommand, startCommand } from "./testing.ts";

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
    expect((yield* joining.nextEvent).type).toBe("registered");
    expect((yield* joining.nextEvent).type).toBe("tunnel_connected");
    return joining;
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
