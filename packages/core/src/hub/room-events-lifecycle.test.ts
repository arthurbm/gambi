import { expect } from "bun:test";
import { it } from "@gambi/testing/effect";
import { Duration, Effect, Exit, Fiber, Layer, Scope, Stream } from "effect";
import { layerHub, managementClient, watchRoom } from "../testing/hub.ts";
import { joinParticipant } from "../testing/participant.ts";

/** Starts a hub in a scope of its own, so the test decides when it closes. */
const startHub = Effect.gen(function* () {
  const scope = yield* Scope.make();
  const context = yield* Layer.buildWithScope(layerHub(), scope).pipe(
    Effect.onError(() => Scope.close(scope, Exit.void))
  );
  return { context, close: Scope.close(scope, Exit.void) };
});

it.live(
  "closing the hub ends the open event streams first: it takes under a second and each client sees its stream complete",
  () =>
    Effect.gen(function* () {
      const hub = yield* startHub;
      const watchers = yield* Effect.gen(function* () {
        const client = yield* managementClient;
        const { room } = yield* client.rooms.create({
          payload: { name: "Frevo" },
        });
        // A tunnel too, in another room: the hub closes both kinds of open
        // connection.
        const other = yield* client.rooms.create({
          payload: { name: "Maracatu" },
        });
        yield* joinParticipant({ roomCode: other.room.code });
        // Streams that are being read, each past its snapshot...
        const reading = yield* Effect.forEach([1, 2, 3], () =>
          client.events
            .watch({ params: { code: room.code } })
            .pipe(
              Stream.unwrap,
              Stream.runCount,
              Effect.forkChild({ startImmediately: true })
            )
        );
        // ...and they are open on the hub: these arrived after them.
        yield* watchRoom(room.code);
        return reading;
      }).pipe(Effect.provide(hub.context));

      const [elapsed] = yield* Effect.timed(hub.close);

      expect(Duration.toMillis(elapsed)).toBeLessThan(1000);
      for (const watcher of watchers) {
        // The stream ended without an error, after the snapshot.
        expect(yield* Fiber.join(watcher)).toBe(1);
      }
    })
);
