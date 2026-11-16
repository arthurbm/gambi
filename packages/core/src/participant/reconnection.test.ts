import { expect } from "bun:test";
import { GAMBI_VERSION, RoomNotFound, VersionMismatch } from "@gambi/protocol";
import { it, layer } from "@gambi/testing/effect";
import { Context, Effect, Exit, Layer, Scope } from "effect";
import { TestClock } from "effect/testing";
import { Hub } from "../hub/hub.ts";
import { Tunnels } from "../hub/tunnels.ts";
import {
  layerHub,
  managementClient,
  type TestHubOptions,
} from "../testing/hub.ts";
import { linkToHub } from "../testing/hub-link.ts";
import {
  joinParticipant,
  type TestParticipant,
} from "../testing/participant.ts";

/** A new room on the hub in the environment, and how its participants look from outside. */
const newRoom = (name: string) =>
  Effect.gen(function* () {
    const client = yield* managementClient;
    const { room } = yield* client.rooms.create({ payload: { name } });
    const statuses = client.participants
      .list({ params: { code: room.code } })
      .pipe(
        Effect.map((participants) =>
          participants.map((participant) => [
            participant.id,
            participant.status,
          ])
        )
      );
    return { roomCode: room.code, statuses };
  });

/** How many times the participant has registered so far. */
const registrations = (participant: TestParticipant) =>
  participant.sentToHub.pipe(
    Effect.map((sent) => sent.filter((line) => line.startsWith("PUT ")).length)
  );

/**
 * Starts a hub in a scope of its own, so the test decides when it stops. A
 * hub that restarts is one that stops and another that starts on its port.
 */
const startHub = (options?: TestHubOptions) =>
  Effect.gen(function* () {
    const scope = yield* Scope.fork(yield* Effect.scope);
    const context = yield* Layer.buildWithScope(layerHub(options), scope);
    return {
      context,
      port: Context.get(context, Hub).port,
      stop: Scope.close(scope, Exit.void),
    };
  });

// The hub of these tests is built inside each test, so it reads the test
// clock, and it pings every hour: moving the clock by the waits of a
// reconnection must not also trip the hub's ping timeout.
const TestHub = layerHub({ tunnelPingInterval: "1 hour" });

it.effect(
  "comes back by itself as the same participant when the hub goes away and returns, waiting longer after each failed attempt",
  () =>
    Effect.gen(function* () {
      const { roomCode, statuses } = yield* newRoom("Frevo");
      const link = yield* linkToHub;
      const participant = yield* joinParticipant({
        roomCode,
        participantId: "arthur-1",
        hubUrl: link.url,
        reconnect: true,
      });
      expect(yield* participant.nextLifecycleEvent).toMatchObject({
        type: "connected",
        participantId: "arthur-1",
        attempt: 0,
      });

      yield* link.cut;

      // 1 s, then twice as long after each attempt that fails, up to 30 s.
      const waits = [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000];
      for (const [index, delayMillis] of waits.entries()) {
        expect(yield* participant.nextLifecycleEvent).toMatchObject({
          type: "reconnecting",
          participantId: "arthur-1",
          attempt: index + 1,
          delayMillis,
          reason: index === 0 ? "tunnelDropped" : "hubUnreachable",
        });
        // Nothing is tried before the wait is over.
        const before = yield* registrations(participant);
        yield* TestClock.adjust(delayMillis - 1);
        expect(yield* registrations(participant)).toBe(before);
        if (index === waits.length - 1) {
          // By now the hub has removed the participant: it stayed offline
          // past the 60 s deadline. Coming back registers it again.
          expect(yield* statuses).toEqual([]);
          yield* link.restore;
        }
        yield* TestClock.adjust(1);
      }

      expect(yield* participant.nextLifecycleEvent).toMatchObject({
        type: "connected",
        participantId: "arthur-1",
        attempt: waits.length,
      });
      expect(yield* statuses).toEqual([["arthur-1", "online"]]);

      // Once back, the next drop starts over from the shortest wait.
      yield* link.cut;
      expect(yield* participant.nextLifecycleEvent).toMatchObject({
        type: "reconnecting",
        attempt: 1,
        delayMillis: 1000,
      });
    }).pipe(Effect.provide(TestHub))
);

it.effect(
  "stopping the runtime while it waits to come back ends it: no further attempt reaches the hub",
  () =>
    Effect.gen(function* () {
      const tunnels = yield* Tunnels;
      const { roomCode, statuses } = yield* newRoom("Maracatu");
      const link = yield* linkToHub;
      const participant = yield* joinParticipant({
        roomCode,
        participantId: "arthur-1",
        hubUrl: link.url,
        reconnect: true,
      });
      yield* participant.nextLifecycleEvent;
      yield* link.cut;
      expect(yield* participant.nextLifecycleEvent).toMatchObject({
        type: "reconnecting",
        attempt: 1,
      });

      yield* participant.stop;

      expect(yield* participant.nextLifecycleEvent).toEqual({
        type: "left",
        roomCode,
        participantId: "arthur-1",
        reason: "stopped",
      });
      yield* participant.runtime.ended;
      // The hub is reachable again and the waits are long over.
      yield* link.restore;
      yield* TestClock.adjust("31 seconds");
      expect(yield* registrations(participant)).toBe(1);
      yield* tunnels.awaitDrop(roomCode, "arthur-1");
      expect(yield* statuses).toEqual([["arthur-1", "offline"]]);
    }).pipe(Effect.provide(TestHub))
);

it.effect(
  "stopping the runtime in the middle of an attempt to come back ends it without opening a tunnel",
  () =>
    Effect.gen(function* () {
      const { roomCode } = yield* newRoom("Ciranda");
      const link = yield* linkToHub;
      const participant = yield* joinParticipant({
        roomCode,
        participantId: "arthur-1",
        hubUrl: link.url,
        reconnect: true,
      });
      yield* participant.nextLifecycleEvent;
      // The hub stops answering, and the participant loses its tunnel.
      yield* link.freeze;
      yield* participant.kill;
      yield* participant.nextLifecycleEvent;
      yield* TestClock.adjust("1 second");
      // The registration of the first attempt is on its way, unanswered.
      expect(yield* registrations(participant)).toBe(2);

      yield* participant.stop;

      expect(yield* participant.nextLifecycleEvent).toMatchObject({
        type: "left",
        reason: "stopped",
      });
      yield* link.unfreeze;
      yield* TestClock.adjust("31 seconds");
      const dials = (yield* participant.sentToHub).filter((line) =>
        line.startsWith("DIAL ")
      );
      expect(dials).toHaveLength(1);
      expect(yield* registrations(participant)).toBe(2);
    }).pipe(Effect.provide(TestHub))
);

// This hub pings every 5 s, the default, so a participant expects to hear
// from it at least that often.
it.effect(
  "notices a hub that froze after three ping intervals of silence, and dials again",
  () =>
    Effect.gen(function* () {
      const { roomCode, statuses } = yield* newRoom("Coco");
      const link = yield* linkToHub;
      const participant = yield* joinParticipant({
        roomCode,
        participantId: "arthur-1",
        hubUrl: link.url,
        reconnect: true,
      });
      yield* participant.nextLifecycleEvent;

      yield* link.freeze;
      yield* TestClock.adjust("14999 millis");
      expect(
        (yield* participant.lifecycleEvents).map((event) => event.type)
      ).toEqual(["connected"]);
      yield* TestClock.adjust("1 millis");

      expect(yield* participant.nextLifecycleEvent).toEqual({
        type: "reconnecting",
        roomCode,
        participantId: "arthur-1",
        attempt: 1,
        delayMillis: 1000,
        reason: "hubSilent",
      });
      // A frozen hub does not answer the registration either: the attempt
      // gives up after 10 s and the next one waits longer.
      yield* TestClock.adjust("1 second");
      expect(yield* registrations(participant)).toBe(2);
      yield* TestClock.adjust("10 seconds");
      expect(yield* participant.nextLifecycleEvent).toMatchObject({
        type: "reconnecting",
        attempt: 2,
        delayMillis: 2000,
        reason: "hubUnreachable",
      });

      yield* link.unfreeze;
      yield* TestClock.adjust("2 seconds");

      expect(yield* participant.nextLifecycleEvent).toMatchObject({
        type: "connected",
        attempt: 2,
      });
      expect(yield* statuses).toEqual([["arthur-1", "online"]]);
    }).pipe(Effect.provide(layerHub()))
);

it.effect(
  "does not take a hub that keeps talking for a frozen one: the silence counts from the last frame it sent",
  () =>
    Effect.gen(function* () {
      const tunnels = yield* Tunnels;
      const { roomCode, statuses } = yield* newRoom("Baião");
      const link = yield* linkToHub;
      const participant = yield* joinParticipant({
        roomCode,
        participantId: "arthur-1",
        hubUrl: link.url,
        reconnect: true,
      });
      const tunnel = yield* tunnels.client(roomCode, "arthur-1");

      // This hub pings every hour, so three hours of silence is the limit.
      // A call every 50 minutes keeps it talking for longer than that.
      for (let call = 0; call < 4; call++) {
        yield* TestClock.adjust("50 minutes");
        yield* tunnel.Echo({ text: "frevo" });
      }
      expect(yield* statuses).toEqual([["arthur-1", "online"]]);

      // Then it freezes, 200 minutes in.
      yield* link.freeze;
      yield* TestClock.adjust("179 minutes");
      expect(
        (yield* participant.lifecycleEvents).map((event) => event.type)
      ).toEqual(["connected"]);
      yield* TestClock.adjust("1 minute");

      yield* participant.nextLifecycleEvent;
      expect(yield* participant.nextLifecycleEvent).toMatchObject({
        type: "reconnecting",
        reason: "hubSilent",
      });
    }).pipe(Effect.provide(TestHub))
);

it.effect(
  "ends with the hub's refusal, and tries no more, when the hub comes back on another minor",
  () =>
    Effect.gen(function* () {
      const first = yield* startHub({ version: "0.8.3" });
      const { participant, roomCode } = yield* Effect.gen(function* () {
        const room = yield* newRoom("Xote");
        const joined = yield* joinParticipant({
          roomCode: room.roomCode,
          participantId: "arthur-1",
          version: "0.8.3",
          reconnect: true,
        });
        return { participant: joined, roomCode: room.roomCode };
      }).pipe(Effect.provide(first.context));
      yield* participant.nextLifecycleEvent;

      yield* first.stop;
      expect(yield* participant.nextLifecycleEvent).toMatchObject({
        type: "reconnecting",
        attempt: 1,
      });
      yield* startHub({ port: first.port, version: "0.9.0" });
      yield* TestClock.adjust("1 second");

      expect(yield* participant.nextLifecycleEvent).toEqual({
        type: "left",
        roomCode,
        participantId: "arthur-1",
        reason: "refused",
        error: {
          name: "VersionMismatch",
          message:
            "This hub runs Gambi 0.9.0 and expects participants on 0.9.x; this participant runs 0.8.3.",
        },
      });
      const error = yield* Effect.flip(participant.runtime.ended);
      expect(error).toBeInstanceOf(VersionMismatch);
      // No loop: the longest wait passes and nothing more reaches the hub.
      yield* TestClock.adjust("31 seconds");
      expect(yield* registrations(participant)).toBe(2);
      expect(
        (yield* participant.lifecycleEvents).map((event) => event.type)
      ).toEqual(["connected", "reconnecting", "left"]);
    })
);

// A hub keeps its rooms in memory, so one that restarts comes back without
// them, and a room code cannot be asked for again.
it.effect(
  "ends with RoomNotFound when the hub that comes back no longer has the room",
  () =>
    Effect.gen(function* () {
      const first = yield* startHub();
      const { participant, roomCode } = yield* Effect.gen(function* () {
        const room = yield* newRoom("Forró");
        const joined = yield* joinParticipant({
          roomCode: room.roomCode,
          participantId: "arthur-1",
          reconnect: true,
        });
        return { participant: joined, roomCode: room.roomCode };
      }).pipe(Effect.provide(first.context));
      yield* participant.nextLifecycleEvent;

      yield* first.stop;
      yield* participant.nextLifecycleEvent;
      yield* startHub({ port: first.port });
      yield* TestClock.adjust("1 second");

      expect(yield* participant.nextLifecycleEvent).toMatchObject({
        type: "left",
        reason: "refused",
        error: {
          name: "RoomNotFound",
          message: `Room '${roomCode}' was not found.`,
        },
      });
      const error = yield* Effect.flip(participant.runtime.ended);
      expect(error).toBeInstanceOf(RoomNotFound);
    })
);

layer(layerHub(), { excludeTestServices: true })(
  "lifecycle of a participant runtime",
  (it) => {
    it.effect(
      "tells its host that it connected and, once stopped, that it left",
      () =>
        Effect.gen(function* () {
          const { roomCode } = yield* newRoom("Caboclinho");
          const participant = yield* joinParticipant({
            roomCode,
            participantId: "arthur-1",
            reconnect: true,
          });

          yield* participant.stop;

          expect(yield* participant.lifecycleEvents).toEqual([
            {
              type: "connected",
              roomCode,
              participantId: "arthur-1",
              attempt: 0,
              hubVersion: GAMBI_VERSION,
            },
            {
              type: "left",
              roomCode,
              participantId: "arthur-1",
              reason: "stopped",
            },
          ]);
          yield* participant.runtime.ended;
        })
    );

    it.effect(
      "started with reconnect off, ends when its tunnel drops and does not dial again",
      () =>
        Effect.gen(function* () {
          const tunnels = yield* Tunnels;
          const { roomCode, statuses } = yield* newRoom("Cavalo-marinho");
          const participant = yield* joinParticipant({
            roomCode,
            participantId: "arthur-1",
            reconnect: false,
          });
          yield* participant.nextLifecycleEvent;

          yield* participant.kill;

          expect(yield* participant.nextLifecycleEvent).toEqual({
            type: "left",
            roomCode,
            participantId: "arthur-1",
            reason: "tunnelDropped",
          });
          yield* participant.runtime.ended;
          yield* participant.runtime.tunnelDropped;
          yield* tunnels.awaitDrop(roomCode, "arthur-1");
          expect(yield* statuses).toEqual([["arthur-1", "offline"]]);
          expect(yield* registrations(participant)).toBe(1);
        })
    );
  }
);
