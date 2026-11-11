import { expect } from "bun:test";
import { TunnelRpcs } from "@gambi/protocol";
import { it } from "@gambi/testing/effect";
import {
  Context,
  Deferred,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Scope,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { layerHub, managementClient } from "../testing/hub.ts";
import { joinParticipant } from "../testing/participant.ts";
import { Tunnels } from "./tunnels.ts";

/** Starts a hub in a scope of its own, so the test decides when it closes. */
const startHub = Effect.gen(function* () {
  const scope = yield* Scope.make();
  const context = yield* Layer.buildWithScope(layerHub(), scope).pipe(
    Effect.onError(() => Scope.close(scope, Exit.void))
  );
  return { context, close: Scope.close(scope, Exit.void) };
});

it.live(
  "closing the hub closes the tunnels first: it takes under a second and the calls in flight fail with a typed error",
  () =>
    Effect.gen(function* () {
      const hub = yield* startHub;
      const started = yield* Deferred.make<void>();
      const { tunnels, calls, participants } = yield* Effect.gen(function* () {
        const client = yield* managementClient;
        const { room } = yield* client.rooms.create({
          payload: { name: "Frevo" },
        });
        const waiting = TunnelRpcs.toLayerHandler("Echo", () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never)
          )
        );
        const joined = yield* Effect.forEach(["a", "b", "c"], (participantId) =>
          joinParticipant({
            roomCode: room.code,
            participantId,
            handlers: Layer.mergeAll(
              waiting,
              TunnelRpcs.toLayerHandler("Ticks", () => Stream.never)
            ),
          })
        );
        const service = yield* Tunnels;
        const tunnel = yield* service.client(room.code, "a");
        const unary = yield* Effect.forkChild(
          Effect.flip(tunnel.Echo({ text: "wait" }))
        );
        const stream = yield* Effect.forkChild(
          Effect.flip(Stream.runDrain(tunnel.Ticks({ count: 1 })))
        );
        yield* Deferred.await(started);
        return {
          tunnels: service,
          calls: [Fiber.join(unary), Fiber.join(stream)],
          participants: joined,
        };
      }).pipe(Effect.provide(hub.context));

      const [elapsed] = yield* Effect.timed(hub.close);

      expect(Duration.toMillis(elapsed)).toBeLessThan(1000);
      for (const call of calls) {
        const error = yield* call;
        expect(error._tag).toBe("RpcClientError");
        expect(error.message).toBe(
          "SocketCloseError: 1001: the hub is closing"
        );
      }
      // Every participant runtime saw its tunnel drop.
      for (const participant of participants) {
        yield* participant.runtime.tunnelDropped;
      }
      expect(Context.get(hub.context, Tunnels)).toBe(tunnels);
    })
);

it.live("a new tunnel of the same participant replaces the one it had", () =>
  Effect.gen(function* () {
    const hub = yield* startHub;
    yield* Effect.gen(function* () {
      const client = yield* managementClient;
      const tunnels = yield* Tunnels;
      const { room } = yield* client.rooms.create({
        payload: { name: "Maracatu" },
      });
      const started = yield* Deferred.make<void>();
      const first = yield* joinParticipant({
        roomCode: room.code,
        participantId: "arthur-1",
        handlers: Layer.mergeAll(
          TunnelRpcs.toLayerHandler("Echo", () =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never)
            )
          ),
          TunnelRpcs.toLayerHandler("Ticks", () => Stream.never)
        ),
      });
      const old = yield* tunnels.client(room.code, "arthur-1");
      const inFlight = yield* Effect.forkChild(
        Effect.flip(old.Echo({ text: "wait" }))
      );
      yield* Deferred.await(started);

      // The same participant comes back, as it does after a drop it
      // noticed before the hub did.
      yield* joinParticipant({
        roomCode: room.code,
        participantId: "arthur-1",
      });

      yield* first.runtime.tunnelDropped;
      const error = yield* Fiber.join(inFlight);
      expect(error.message).toBe(
        "SocketCloseError: 1001: superseded by a new tunnel"
      );
      const current = yield* tunnels.client(room.code, "arthur-1");
      expect(yield* current.Echo({ text: "voltei" })).toBe("voltei");
      const listed = yield* client.participants.list({
        params: { code: room.code },
      });
      expect(
        listed.map((participant) => [participant.id, participant.status])
      ).toEqual([["arthur-1", "online"]]);
    }).pipe(Effect.provide(hub.context));
    yield* hub.close;
  })
);

// The hub is built inside the test, so it reads the test clock. Moving that
// clock with a tunnel open can trip the hub's ping timeout, because a jump
// leaves no time for the pong: with the default 5 s interval, these two steps
// drop the tunnel. A test that needs the clock and a tunnel sets the interval
// out of its way.
it.effect("the ping interval of the tunnels is a setting of the hub", () =>
  Effect.gen(function* () {
    const client = yield* managementClient;
    const { room } = yield* client.rooms.create({
      payload: { name: "Coco" },
    });
    yield* joinParticipant({ roomCode: room.code, participantId: "arthur-1" });
    const status = client.participants
      .list({ params: { code: room.code } })
      .pipe(Effect.map((listed) => listed[0]?.status));

    yield* TestClock.adjust("4 seconds");
    expect(yield* status).toBe("online");
    yield* TestClock.adjust("6 seconds");

    expect(yield* status).toBe("online");
  }).pipe(Effect.provide(layerHub({ tunnelPingInterval: "1 hour" })))
);
