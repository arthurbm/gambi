import { expect } from "bun:test";
import { GAMBI_VERSION, TunnelRpcs } from "@gambi/protocol";
import { layer } from "@gambi/testing/effect";
import { Deferred, Effect, Fiber, Layer, Stream } from "effect";
import { TunnelDiagnostics } from "../participant/diagnostics.ts";
import { layerHub, managementClient } from "../testing/hub.ts";
import { joinParticipant } from "../testing/participant.ts";
import { TunnelNotOpen, Tunnels } from "./tunnels.ts";

/** A new room, and the statuses of its participants as the management plane lists them. */
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

/**
 * A handler body that never answers, and says when it started and when it was
 * interrupted. Waiting on `interrupted` is how a test sees a cancellation
 * arrive on the participant.
 */
const observedHandler = Effect.gen(function* () {
  const started = yield* Deferred.make<void>();
  const interrupted = yield* Deferred.make<void>();
  return {
    run: Deferred.succeed(started, undefined).pipe(
      Effect.andThen(Effect.never),
      Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined))
    ),
    started: Deferred.await(started),
    interrupted: Deferred.await(interrupted),
  };
});

layer(layerHub(), { excludeTestServices: true })("tunnel", (it) => {
  it.effect(
    "a participant registers, dials its tunnel and shows up online; when the tunnel drops it goes offline",
    () =>
      Effect.gen(function* () {
        const tunnels = yield* Tunnels;
        const room = yield* makeRoom("Frevo");

        const participant = yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
        });

        expect(participant.runtime.participant.id).toBe("arthur-1");
        expect(yield* room.statuses).toEqual([["arthur-1", "online"]]);

        yield* participant.stop;
        yield* tunnels.awaitDrop(room.code, "arthur-1");

        expect(yield* room.statuses).toEqual([["arthur-1", "offline"]]);
      })
  );

  it.effect("a unary call goes to the participant and comes back", () =>
    Effect.gen(function* () {
      const tunnels = yield* Tunnels;
      const room = yield* makeRoom("Maracatu");
      yield* joinParticipant({
        roomCode: room.code,
        participantId: "arthur-1",
      });
      const tunnel = yield* tunnels.client(room.code, "arthur-1");

      const answer = yield* tunnel.Echo({ text: "olinda" });

      expect(answer).toBe("olinda");
    })
  );

  it.effect("a stream call delivers every chunk, in order", () =>
    Effect.gen(function* () {
      const tunnels = yield* Tunnels;
      const room = yield* makeRoom("Ciranda");
      yield* joinParticipant({
        roomCode: room.code,
        participantId: "arthur-1",
      });
      const tunnel = yield* tunnels.client(room.code, "arthur-1");

      const ticks = yield* Stream.runCollect(tunnel.Ticks({ count: 500 }));

      expect(ticks).toEqual(Array.from({ length: 500 }, (_, index) => index));
    })
  );

  it.effect("calls reach the participant they were made to", () =>
    Effect.gen(function* () {
      const tunnels = yield* Tunnels;
      const room = yield* makeRoom("Coco");
      const shouting = TunnelDiagnostics.pipe(
        Layer.merge(
          TunnelRpcs.toLayerHandler("Echo", ({ text }) =>
            Effect.succeed(text.toUpperCase())
          )
        )
      );
      yield* joinParticipant({ roomCode: room.code, participantId: "quiet" });
      yield* joinParticipant({
        roomCode: room.code,
        participantId: "loud",
        handlers: shouting,
      });
      const quiet = yield* tunnels.client(room.code, "quiet");
      const loud = yield* tunnels.client(room.code, "loud");

      const answers = yield* Effect.all(
        [
          quiet.Echo({ text: "frevo" }),
          loud.Echo({ text: "frevo" }),
          quiet.Echo({ text: "passo" }),
          loud.Echo({ text: "passo" }),
        ],
        { concurrency: "unbounded" }
      );

      expect(answers).toEqual(["frevo", "FREVO", "passo", "PASSO"]);
    })
  );

  it.effect(
    "interrupting a stream call on the hub interrupts its handler on the participant",
    () =>
      Effect.gen(function* () {
        const tunnels = yield* Tunnels;
        const room = yield* makeRoom("Baião");
        const handler = yield* observedHandler;
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
          handlers: TunnelDiagnostics.pipe(
            Layer.merge(
              TunnelRpcs.toLayerHandler("Ticks", () =>
                Stream.concat(Stream.make(0), Stream.fromEffect(handler.run))
              )
            )
          ),
        });
        const tunnel = yield* tunnels.client(room.code, "arthur-1");

        const call = yield* Effect.forkChild(
          Stream.runDrain(tunnel.Ticks({ count: 1 }))
        );
        yield* handler.started;
        yield* Fiber.interrupt(call);

        yield* handler.interrupted;
        // The tunnel is still good for the next call.
        expect(yield* tunnel.Echo({ text: "segue" })).toBe("segue");
      })
  );

  it.effect(
    "a consumer that stops reading a stream early stops the handler too",
    () =>
      Effect.gen(function* () {
        const tunnels = yield* Tunnels;
        const room = yield* makeRoom("Xote");
        const handler = yield* observedHandler;
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
          handlers: TunnelDiagnostics.pipe(
            Layer.merge(
              TunnelRpcs.toLayerHandler("Ticks", () =>
                Stream.concat(
                  Stream.make(0, 1, 2),
                  Stream.fromEffect(handler.run)
                )
              )
            )
          ),
        });
        const tunnel = yield* tunnels.client(room.code, "arthur-1");

        const taken = yield* tunnel
          .Ticks({ count: 1 })
          .pipe(Stream.take(2), Stream.runCollect);

        expect(taken).toEqual([0, 1]);
        yield* handler.interrupted;
      })
  );

  it.effect(
    "interrupting a unary call on the hub interrupts its handler on the participant",
    () =>
      Effect.gen(function* () {
        const tunnels = yield* Tunnels;
        const room = yield* makeRoom("Forró");
        const handler = yield* observedHandler;
        yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
          handlers: TunnelDiagnostics.pipe(
            Layer.merge(
              TunnelRpcs.toLayerHandler("Echo", ({ text }) =>
                text === "wait" ? handler.run : Effect.succeed(text)
              )
            )
          ),
        });
        const tunnel = yield* tunnels.client(room.code, "arthur-1");

        const call = yield* Effect.forkChild(tunnel.Echo({ text: "wait" }));
        yield* handler.started;
        yield* Fiber.interrupt(call);

        yield* handler.interrupted;
        expect(yield* tunnel.Echo({ text: "segue" })).toBe("segue");
      })
  );

  it.effect(
    "when the participant dies, the calls in flight fail with a typed error and it goes offline",
    () =>
      Effect.gen(function* () {
        const tunnels = yield* Tunnels;
        const room = yield* makeRoom("Caboclinho");
        const unary = yield* observedHandler;
        const stream = yield* observedHandler;
        const participant = yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
          handlers: Layer.mergeAll(
            TunnelRpcs.toLayerHandler("Echo", () => unary.run),
            TunnelRpcs.toLayerHandler("Ticks", () =>
              Stream.concat(Stream.make(0), Stream.fromEffect(stream.run))
            )
          ),
        });
        const tunnel = yield* tunnels.client(room.code, "arthur-1");
        const unaryCall = yield* Effect.forkChild(
          Effect.flip(tunnel.Echo({ text: "wait" }))
        );
        const streamCall = yield* Effect.forkChild(
          Effect.flip(Stream.runDrain(tunnel.Ticks({ count: 1 })))
        );
        yield* unary.started;
        yield* stream.started;

        yield* participant.kill;

        const unaryError = yield* Fiber.join(unaryCall);
        const streamError = yield* Fiber.join(streamCall);
        expect(unaryError._tag).toBe("RpcClientError");
        expect(unaryError.reason._tag).toBe("SocketCloseError");
        expect(streamError._tag).toBe("RpcClientError");
        expect(streamError.reason._tag).toBe("SocketCloseError");

        yield* tunnels.awaitDrop(room.code, "arthur-1");
        expect(yield* room.statuses).toEqual([["arthur-1", "offline"]]);
        const gone = yield* tunnels
          .client(room.code, "arthur-1")
          .pipe(Effect.flip);
        expect(gone).toBeInstanceOf(TunnelNotOpen);
        // A call on the dead tunnel fails the same way; it does not hang.
        const late = yield* tunnel.Echo({ text: "tarde" }).pipe(Effect.flip);
        expect(late._tag).toBe("RpcClientError");
        // The runtime noticed too.
        yield* participant.runtime.tunnelDropped;
      })
  );

  it.effect("a participant without a tunnel has no client", () =>
    Effect.gen(function* () {
      const tunnels = yield* Tunnels;
      const client = yield* managementClient;
      const room = yield* makeRoom("Cavalo-marinho");
      yield* client.participants.register({
        params: { code: room.code, id: "arthur-1" },
        payload: { nickname: "Arthur", model: "m", version: GAMBI_VERSION },
      });

      const error = yield* tunnels
        .client(room.code, "arthur-1")
        .pipe(Effect.flip);

      expect(error).toBeInstanceOf(TunnelNotOpen);
      expect(error.message).toBe(
        `Participant 'arthur-1' of room '${room.code}' has no open tunnel.`
      );
    })
  );

  it.effect(
    "a tunnel the hub closes drops like any other: offline, typed error, handlers interrupted",
    () =>
      Effect.gen(function* () {
        const tunnels = yield* Tunnels;
        const room = yield* makeRoom("Afoxé");
        const handler = yield* observedHandler;
        const participant = yield* joinParticipant({
          roomCode: room.code,
          participantId: "arthur-1",
          handlers: TunnelDiagnostics.pipe(
            Layer.merge(TunnelRpcs.toLayerHandler("Echo", () => handler.run))
          ),
        });
        const tunnel = yield* tunnels.client(room.code, "arthur-1");
        const call = yield* Effect.forkChild(
          Effect.flip(tunnel.Echo({ text: "wait" }))
        );
        yield* handler.started;

        yield* tunnels.close(room.code, "arthur-1", "the participant left");

        expect((yield* Fiber.join(call)).message).toBe(
          "SocketCloseError: 1001: the participant left"
        );
        expect(yield* room.statuses).toEqual([["arthur-1", "offline"]]);
        yield* participant.runtime.tunnelDropped;
        yield* handler.interrupted;
        // Closing what is not open is not an error.
        yield* tunnels.close(room.code, "arthur-1", "again");
      })
  );
});
