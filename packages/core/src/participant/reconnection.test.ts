import { expect } from "bun:test";
import { it } from "@gambi/testing/effect";
import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { layerHub, managementClient } from "../testing/hub.ts";
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
