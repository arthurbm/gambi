import { expect } from "bun:test";
import type { RoomEvent, StatusEvent } from "@gambi/protocol";
import { it } from "@gambi/testing/effect";
import { Duration, Effect, Layer, Queue, Stream } from "effect";
import { HarnessClients } from "./harness-clients.ts";
import { Participants } from "./participants.ts";
import { RoomEvents } from "./room-events.ts";
import { HubSettings } from "./settings.ts";

const ROOM = "FREVO1";
// The participant runtime behind every event of these tests.
const RUNTIME = "runtime-1";
const profile = { nickname: "Arthur", model: "llama3.1:8b" };

// `Participants` reads one setting of the hub, the reconnection deadline.
const Settings = Layer.succeed(HubSettings, {
  harnessClientBuffer: 16,
  reconnectDeadline: Duration.seconds(60),
} as HubSettings["Service"]);

const layerParticipants = Participants.layer.pipe(
  Layer.provideMerge(RoomEvents.layer),
  Layer.provide(HarnessClients.layer),
  Layer.provide(Settings)
);

/** Starts watching the room; `next` is each event after the snapshot, in order. */
const watching = Effect.gen(function* () {
  const events = yield* RoomEvents;
  const received = yield* Queue.unbounded<RoomEvent>();
  const snapshot = Effect.succeed({
    room: {
      id: "room-1",
      code: ROOM,
      name: "Frevo",
      hostId: "host-1",
      createdAt: 0,
      passwordProtected: false,
      participantCount: 0,
    },
    participants: [],
  });
  yield* events.watch(ROOM, snapshot).pipe(
    Stream.runForEach((event) => Queue.offer(received, event)),
    Effect.forkScoped
  );
  // The snapshot arriving says the watch is in place.
  yield* Queue.take(received);
  return Queue.take(received);
});

/**
 * Puts a participant in the room, takes it through `history`, and from then
 * on watches the room.
 */
const participantAfter = (...history: StatusEvent[]) =>
  Effect.gen(function* () {
    const participants = yield* Participants;
    yield* participants.register(ROOM, "arthur-1", profile, RUNTIME);
    for (const event of history) {
      yield* participants.transition(ROOM, "arthur-1", event, RUNTIME);
    }
    const nextEvent = yield* watching;
    return {
      happens: (event: StatusEvent) =>
        participants.transition(ROOM, "arthur-1", event, RUNTIME),
      registersAgain: participants.register(
        ROOM,
        "arthur-1",
        { ...profile, nickname: "Arthur M." },
        RUNTIME
      ),
      nextEvent,
    };
  });

/**
 * One room event per row of the status table of the spec (#109), and none
 * where the table has no row.
 */
it.effect("a participant that registers in a room joins it", () =>
  Effect.gen(function* () {
    const participants = yield* Participants;
    const nextEvent = yield* watching;

    const { participant } = yield* participants.register(
      ROOM,
      "arthur-1",
      profile,
      RUNTIME
    );

    expect(yield* nextEvent).toEqual({
      type: "participant.joined",
      roomCode: ROOM,
      timestamp: 0,
      participant,
    });
    expect(participant.status).toBe("offline");
  }).pipe(Effect.provide(layerParticipants))
);

it.effect(
  "a participant that registers again is updated and keeps its status",
  () =>
    Effect.gen(function* () {
      const participant = yield* participantAfter("tunnelOpened");

      const { participant: updated } = yield* participant.registersAgain;

      expect(yield* participant.nextEvent).toEqual({
        type: "participant.updated",
        roomCode: ROOM,
        timestamp: 0,
        participant: updated,
      });
      expect(updated).toMatchObject({
        nickname: "Arthur M.",
        status: "online",
      });
    }).pipe(Effect.provide(layerParticipants))
);

it.effect("an offline participant whose tunnel opens is online", () =>
  Effect.gen(function* () {
    const participant = yield* participantAfter();

    yield* participant.happens("tunnelOpened");

    expect(yield* participant.nextEvent).toMatchObject({
      type: "participant.online",
      previousStatus: "offline",
      participant: { id: "arthur-1", status: "online" },
    });
  }).pipe(Effect.provide(layerParticipants))
);

it.effect("an online participant the hub dispatches a request to is busy", () =>
  Effect.gen(function* () {
    const participant = yield* participantAfter("tunnelOpened");

    yield* participant.happens("requestDispatched");

    expect(yield* participant.nextEvent).toMatchObject({
      type: "participant.busy",
      previousStatus: "online",
      participant: { id: "arthur-1", status: "busy" },
    });
  }).pipe(Effect.provide(layerParticipants))
);

it.effect(
  "a busy participant whose request ends, is cancelled or times out is online again",
  () =>
    Effect.gen(function* () {
      const participant = yield* participantAfter(
        "tunnelOpened",
        "requestDispatched"
      );

      yield* participant.happens("requestEnded");

      expect(yield* participant.nextEvent).toMatchObject({
        type: "participant.online",
        previousStatus: "busy",
        participant: { id: "arthur-1", status: "online" },
      });
    }).pipe(Effect.provide(layerParticipants))
);

it.effect.each([
  { status: "online", history: ["tunnelOpened"] },
  { status: "busy", history: ["tunnelOpened", "requestDispatched"] },
] as const)(
  "a participant whose tunnel drops is offline, whatever it was doing",
  ({ status, history }) =>
    Effect.gen(function* () {
      const participant = yield* participantAfter(...history);

      yield* participant.happens("tunnelDropped");

      // biome-ignore lint/suspicious/noMisplacedAssertion: the rule does not know `it.effect.each`
      expect(yield* participant.nextEvent).toMatchObject({
        type: "participant.offline",
        previousStatus: status,
        participant: { id: "arthur-1", status: "offline" },
      });
    }).pipe(Effect.provide(layerParticipants))
);

it.effect(
  "an offline participant that does not reconnect in time is removed",
  () =>
    Effect.gen(function* () {
      const participant = yield* participantAfter();

      yield* participant.happens("reconnectDeadlinePassed");

      expect(yield* participant.nextEvent).toEqual({
        type: "participant.removed",
        roomCode: ROOM,
        timestamp: 0,
        participantId: "arthur-1",
        reason: "reconnectDeadlinePassed",
      });
    }).pipe(Effect.provide(layerParticipants))
);

it.effect.each([
  { history: [] },
  { history: ["tunnelOpened"] },
  { history: ["tunnelOpened", "requestDispatched"] },
] as const)(
  "a participant that leaves the room is removed, whatever its status",
  ({ history }) =>
    Effect.gen(function* () {
      const participant = yield* participantAfter(...history);

      yield* participant.happens("left");

      // biome-ignore lint/suspicious/noMisplacedAssertion: the rule does not know `it.effect.each`
      expect(yield* participant.nextEvent).toEqual({
        type: "participant.removed",
        roomCode: ROOM,
        timestamp: 0,
        participantId: "arthur-1",
        reason: "left",
      });
    }).pipe(Effect.provide(layerParticipants))
);

// A second runtime dialed with the participant's id: the hub hands the
// participant to it before it closes the tunnel it replaces.
it.effect(
  "a participant handed over to a runtime whose tunnel is on its way in is no longer the old runtime's to take out",
  () =>
    Effect.gen(function* () {
      const participants = yield* Participants;
      const participant = yield* participantAfter("tunnelOpened");

      yield* participants.handOver(
        ROOM,
        "arthur-1",
        "runtime-2",
        (yield* participants.generation(ROOM, "arthur-1")) ?? 0
      );

      // A removal the old runtime asked for is late from this moment on.
      expect(
        yield* participants.transition(ROOM, "arthur-1", "left", RUNTIME)
      ).toBeUndefined();
      expect(yield* participants.get(ROOM, "arthur-1")).toMatchObject({
        status: "online",
        runtimeId: "runtime-2",
      });
      yield* participants.transition(ROOM, "arthur-1", "left", "runtime-2");
      expect(yield* participant.nextEvent).toMatchObject({
        type: "participant.removed",
        participantId: "arthur-1",
      });
    }).pipe(Effect.provide(layerParticipants))
);

it.effect("what the status table does not list is not an event", () =>
  Effect.gen(function* () {
    const participant = yield* participantAfter();

    yield* participant.happens("requestDispatched");
    yield* participant.happens("requestEnded");
    yield* participant.happens("tunnelDropped");
    yield* participant.happens("tunnelOpened");

    // The first event is the one of the only row among the four.
    expect((yield* participant.nextEvent).type).toBe("participant.online");
  }).pipe(Effect.provide(layerParticipants))
);
