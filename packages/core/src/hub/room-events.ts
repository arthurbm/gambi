/**
 * The room events of one hub: who publishes and who is watching.
 *
 * `publish` is how anything in the hub tells the watchers of a room that
 * something happened. It never waits for them: each room keeps the last
 * `ROOM_EVENT_BUFFER` events, and a watcher that falls further behind than
 * that loses the oldest ones. A slow watcher holds back neither the hub nor
 * the other watchers.
 *
 * The events are defined in `@gambi/protocol` (`room-event.ts`).
 */
import type { RoomEvent, RoomEventBody, RoomSnapshot } from "@gambi/protocol";
import { Clock, Context, Effect, Layer, PubSub, Stream } from "effect";

/** How many events a room keeps for a watcher that is not keeping up. */
export const ROOM_EVENT_BUFFER = 256;

/** What a snapshot says about the room; the hub stamps the rest. */
export type RoomSnapshotBody = Omit<
  RoomSnapshot,
  "roomCode" | "timestamp" | "type"
>;

export class RoomEvents extends Context.Service<
  RoomEvents,
  {
    /**
     * Tells the watchers of the room that `event` happened. The hub stamps
     * the room code and the time. With nobody watching it does nothing.
     *
     * @example
     * yield* events.publish(room.code, { type: "participant.joined", participant });
     */
    readonly publish: (
      roomCode: string,
      event: RoomEventBody
    ) => Effect.Effect<void>;
    /**
     * The stream a client watches: a snapshot of the room, then every event
     * published after it. `snapshot` runs once the stream is subscribed, so
     * no change falls between the two.
     */
    readonly watch: (
      roomCode: string,
      snapshot: Effect.Effect<RoomSnapshotBody>
    ) => Stream.Stream<RoomEvent>;
  }
>()("gambi/core/RoomEvents") {
  static readonly layer = Layer.effect(
    RoomEvents,
    Effect.gen(function* () {
      const byRoom = new Map<string, PubSub.PubSub<RoomEvent>>();
      yield* Effect.addFinalizer(() =>
        Effect.forEach([...byRoom.values()], PubSub.shutdown, { discard: true })
      );

      const publish = Effect.fnUntraced(function* (
        roomCode: string,
        event: RoomEventBody
      ) {
        const room = byRoom.get(roomCode);
        if (room === undefined) {
          return;
        }
        const timestamp = yield* Clock.currentTimeMillis;
        yield* PubSub.publish(room, {
          ...event,
          roomCode,
          timestamp,
        } as RoomEvent);
      });

      const watch = (
        roomCode: string,
        snapshot: Effect.Effect<RoomSnapshotBody>
      ) =>
        Stream.unwrap(
          Effect.gen(function* () {
            let room = byRoom.get(roomCode);
            if (room === undefined) {
              room = yield* PubSub.sliding<RoomEvent>(ROOM_EVENT_BUFFER);
              byRoom.set(roomCode, room);
            }
            const subscription = yield* PubSub.subscribe(room);
            const first: RoomSnapshot = {
              type: "room.snapshot",
              roomCode,
              timestamp: yield* Clock.currentTimeMillis,
              ...(yield* snapshot),
            };
            return Stream.concat(
              Stream.succeed<RoomEvent>(first),
              Stream.fromSubscription(subscription)
            );
          })
        );

      return RoomEvents.of({ publish, watch });
    })
  );
}
