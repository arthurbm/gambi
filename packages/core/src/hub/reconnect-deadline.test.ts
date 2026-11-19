import { expect } from "bun:test";
import { GAMBI_VERSION } from "@gambi/protocol";
import { it } from "@gambi/testing/effect";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { layerHub, managementClient, watchRoom } from "../testing/hub.ts";
import { joinParticipant } from "../testing/participant.ts";
import { Tunnels } from "./tunnels.ts";

/**
 * These hubs are built inside the test, so they read the test clock. The ping
 * of the tunnels is set out of the way: moving the clock with a tunnel open
 * would otherwise trip its timeout.
 */
const hub = layerHub({ tunnelPingInterval: "1 hour" });

/** A new room, and the id and status of its participants as the management plane lists them. */
const makeRoom = (name: string) =>
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
    return { code: room.code, statuses };
  });

it.effect(
  "a participant that loses its tunnel stays in the room, offline, and is removed after 60 s without reconnecting",
  () =>
    Effect.gen(function* () {
      const tunnels = yield* Tunnels;
      const room = yield* makeRoom("Frevo");
      const participant = yield* joinParticipant({
        roomCode: room.code,
        participantId: "arthur-1",
      });
      yield* participant.kill;
      yield* tunnels.awaitDrop(room.code, "arthur-1");
      const watch = yield* watchRoom(room.code);

      yield* TestClock.adjust("59 seconds");
      const before = yield* room.statuses;
      yield* TestClock.adjust("1 second");
      const removed = yield* watch.next;

      expect(before).toEqual([["arthur-1", "offline"]]);
      expect(removed).toEqual({
        type: "participant.removed",
        roomCode: room.code,
        timestamp: expect.any(Number),
        participantId: "arthur-1",
        reason: "reconnectDeadlinePassed",
      });
      expect(yield* room.statuses).toEqual([]);
    }).pipe(Effect.provide(hub))
);

it.effect(
  "a participant that reconnects before the 60 s stays in the room, and a later drop starts the 60 s again",
  () =>
    Effect.gen(function* () {
      const tunnels = yield* Tunnels;
      const room = yield* makeRoom("Maracatu");
      const first = yield* joinParticipant({
        roomCode: room.code,
        participantId: "arthur-1",
      });
      yield* first.kill;
      yield* tunnels.awaitDrop(room.code, "arthur-1");
      yield* TestClock.adjust("59 seconds");

      const second = yield* joinParticipant({
        roomCode: room.code,
        participantId: "arthur-1",
      });
      // Long past the deadline of the first drop.
      yield* TestClock.adjust("5 minutes");
      const reconnected = yield* room.statuses;

      yield* second.kill;
      yield* tunnels.awaitDrop(room.code, "arthur-1");
      const watch = yield* watchRoom(room.code);
      yield* TestClock.adjust("59 seconds");
      const droppedAgain = yield* room.statuses;
      yield* TestClock.adjust("1 second");
      const removed = yield* watch.next;

      expect(reconnected).toEqual([["arthur-1", "online"]]);
      expect(droppedAgain).toEqual([["arthur-1", "offline"]]);
      expect(removed.type).toBe("participant.removed");
      expect(yield* room.statuses).toEqual([]);
    }).pipe(Effect.provide(hub))
);

it.effect(
  "a participant that registers and never opens its tunnel is removed after 60 s; registering again starts them over",
  () =>
    Effect.gen(function* () {
      const client = yield* managementClient;
      const room = yield* makeRoom("Ciranda");
      const register = client.participants.register({
        params: { code: room.code, id: "arthur-1" },
        payload: {
          nickname: "Arthur",
          model: "llama3.1:8b",
          runtimeId: "runtime-of-arthur",
          version: GAMBI_VERSION,
        },
      });
      yield* register;
      const watch = yield* watchRoom(room.code);

      yield* TestClock.adjust("59 seconds");
      // What a participant runtime does on its way back: it registers for
      // a new bootstrap token, which is valid for another 60 s.
      yield* register;
      const updated = yield* watch.next;
      yield* TestClock.adjust("59 seconds");
      const waiting = yield* room.statuses;
      yield* TestClock.adjust("1 second");
      const removed = yield* watch.next;

      expect(updated.type).toBe("participant.updated");
      expect(waiting).toEqual([["arthur-1", "offline"]]);
      expect(removed).toMatchObject({
        type: "participant.removed",
        reason: "reconnectDeadlinePassed",
      });
      expect(yield* room.statuses).toEqual([]);
    }).pipe(Effect.provide(hub))
);

it.effect(
  "how long an offline participant is kept is a setting of the hub",
  () =>
    Effect.gen(function* () {
      const client = yield* managementClient;
      const room = yield* makeRoom("Coco");
      yield* client.participants.register({
        params: { code: room.code, id: "arthur-1" },
        payload: {
          nickname: "Arthur",
          model: "llama3.1:8b",
          runtimeId: "runtime-of-arthur",
          version: GAMBI_VERSION,
        },
      });
      const watch = yield* watchRoom(room.code);

      yield* TestClock.adjust("5 seconds");

      expect((yield* watch.next).type).toBe("participant.removed");
    }).pipe(Effect.provide(layerHub({ reconnectDeadline: "5 seconds" })))
);
