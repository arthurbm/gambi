/**
 * The long-lived `HarnessEvents` stream: the hub opens it when it accepts a
 * tunnel, and everything that is born on the participant goes up through it.
 * The spike behind ADR-0007 did not cover a call that stays open for the life
 * of the tunnel, so this file proves it on a real hub and a real socket.
 */
import { expect } from "bun:test";
import {
  type HarnessAttachEvent,
  type HarnessEvent,
  TunnelRpcs,
} from "@gambi/protocol";
import { layer } from "@gambi/testing/effect";
import { Deferred, Effect, Queue, Stream } from "effect";
import { layerHub, managementClient } from "../testing/hub.ts";
import {
  joinParticipant,
  type TestParticipant,
} from "../testing/participant.ts";
import { HarnessClients } from "./harness-clients.ts";
import { Tunnels } from "./tunnels.ts";

const makeRoom = (name: string) =>
  Effect.gen(function* () {
    const client = yield* managementClient;
    const { room } = yield* client.rooms.create({ payload: { name } });
    return room.code;
  });

const message = (sessionId: string, text: string): HarnessEvent => ({
  type: "harness.message",
  sessionId,
  message: {
    jsonrpc: "2.0",
    method: "session/update",
    params: { sessionId, text },
  },
});

/**
 * A participant whose `HarnessEvents` handler streams whatever the test puts
 * in `produced`, and says when the hub opened the call.
 */
const harnessLike = Effect.gen(function* () {
  const produced = yield* Queue.unbounded<HarnessEvent>();
  const opened = yield* Queue.unbounded<void>();
  return {
    handlers: TunnelRpcs.toLayerHandler("HarnessEvents", () =>
      Stream.fromQueue(produced).pipe(
        Stream.onStart(Queue.offer(opened, undefined))
      )
    ),
    /** Completes once per `HarnessEvents` call the hub opened. */
    opened: Queue.take(opened),
    produce: (event: HarnessEvent) => Queue.offer(produced, event),
  };
});

/**
 * Attaches to the participant's events in the hub and gives them one at a
 * time, in the order the hub delivered them.
 */
const attach = (roomCode: string, participantId: string) =>
  Effect.gen(function* () {
    const clients = yield* HarnessClients;
    const received = yield* Queue.unbounded<HarnessAttachEvent>();
    const events = yield* clients.attach(roomCode, participantId);
    yield* Stream.runForEach(events, (event) =>
      Queue.offer(received, event)
    ).pipe(Effect.forkScoped);
    return Queue.take(received);
  });

const isPong = (frame: string) => frame.includes('"Pong"');

/** Waits until the tunnel has carried `count` more ping and pong round trips. */
const crossPings = (participant: TestParticipant, count: number) =>
  Effect.gen(function* () {
    const before = (yield* participant.sentToHub).filter(isPong).length;
    yield* participant.awaitSent(
      (sent) => sent.filter(isPong).length >= before + count
    );
  });

// The hub pings every 100 ms here, so "idle across pings" takes no real wait.
// Not shorter: a ping that goes unanswered for one interval drops the tunnel,
// and a busy test process can stall for a few milliseconds.
layer(layerHub({ tunnelPingInterval: "100 millis" }), {
  excludeTestServices: true,
})("the long-lived harness stream", (it) => {
  it.effect(
    "the hub opens the stream when it accepts the tunnel, and what the participant produces over time arrives in order",
    () =>
      Effect.gen(function* () {
        const roomCode = yield* makeRoom("Frevo");
        const harness = yield* harnessLike;
        const next = yield* attach(roomCode, "harness-1");
        expect(yield* next).toEqual({
          type: "harness.disconnected",
          reason: "NoTunnel",
        });

        const participant = yield* joinParticipant({
          roomCode,
          participantId: "harness-1",
          handlers: harness.handlers,
        });

        // Nothing on the hub asked for it: accepting the tunnel opened it.
        yield* harness.opened;
        expect(yield* next).toEqual({ type: "harness.connected" });

        yield* harness.produce(message("s1", "um"));
        expect(yield* next).toEqual(message("s1", "um"));

        // Idle, with only pings and pongs on the socket.
        yield* crossPings(participant, 3);

        yield* harness.produce(message("s1", "dois"));
        yield* harness.produce(message("s2", "três"));
        expect(yield* next).toEqual(message("s1", "dois"));
        expect(yield* next).toEqual(message("s2", "três"));

        yield* crossPings(participant, 3);

        const burst = Array.from({ length: 200 }, (_, index) =>
          message("s1", `rajada ${index}`)
        );
        yield* Effect.forEach(burst, harness.produce, { discard: true });
        for (const expected of burst) {
          expect(yield* next).toEqual(expected);
        }
      })
  );

  it.effect(
    "ordinary calls to the participant work while the stream is open",
    () =>
      Effect.gen(function* () {
        const tunnels = yield* Tunnels;
        const roomCode = yield* makeRoom("Maracatu");
        const harness = yield* harnessLike;
        const next = yield* attach(roomCode, "harness-1");
        const participant = yield* joinParticipant({
          roomCode,
          participantId: "harness-1",
          handlers: harness.handlers,
        });
        yield* harness.opened;
        const tunnel = yield* tunnels.client(roomCode, "harness-1");

        expect(yield* tunnel.Echo({ text: "olinda" })).toBe("olinda");
        yield* harness.produce(message("s1", "antes"));
        const ticks = yield* Stream.runCollect(tunnel.Ticks({ count: 500 }));
        expect(ticks).toHaveLength(500);
        yield* crossPings(participant, 3);
        expect(yield* tunnel.Echo({ text: "recife" })).toBe("recife");
        yield* harness.produce(message("s1", "depois"));

        expect(yield* next).toEqual({
          type: "harness.disconnected",
          reason: "NoTunnel",
        });
        expect(yield* next).toEqual({ type: "harness.connected" });
        expect(yield* next).toEqual(message("s1", "antes"));
        expect(yield* next).toEqual(message("s1", "depois"));
      })
  );

  it.effect(
    "when the participant dies, the stream ends with a typed error instead of hanging",
    () =>
      Effect.gen(function* () {
        const tunnels = yield* Tunnels;
        const roomCode = yield* makeRoom("Caboclinho");
        const harness = yield* harnessLike;
        const next = yield* attach(roomCode, "harness-1");
        const participant = yield* joinParticipant({
          roomCode,
          participantId: "harness-1",
          handlers: harness.handlers,
        });
        yield* harness.opened;
        yield* next;
        expect(yield* next).toEqual({ type: "harness.connected" });
        yield* harness.produce(message("s1", "último"));
        expect(yield* next).toEqual(message("s1", "último"));

        yield* participant.kill;

        expect(yield* next).toEqual({
          type: "harness.disconnected",
          reason: "SocketCloseError",
          message: "SocketCloseError: 1006",
        });
        yield* tunnels.awaitDrop(roomCode, "harness-1");
      })
  );

  it.effect(
    "a tunnel the hub closes ends the stream with the reason of the close",
    () =>
      Effect.gen(function* () {
        const tunnels = yield* Tunnels;
        const roomCode = yield* makeRoom("Afoxé");
        const harness = yield* harnessLike;
        const next = yield* attach(roomCode, "harness-1");
        yield* joinParticipant({
          roomCode,
          participantId: "harness-1",
          handlers: harness.handlers,
        });
        yield* harness.opened;
        yield* next;
        yield* next;

        yield* tunnels.close(roomCode, "harness-1", "the participant left");

        expect(yield* next).toEqual({
          type: "harness.disconnected",
          reason: "SocketCloseError",
          message: "SocketCloseError: 1001: the participant left",
        });
      })
  );

  it.effect(
    "a participant that comes back gets a new stream, and a client that was attached keeps reading",
    () =>
      Effect.gen(function* () {
        const tunnels = yield* Tunnels;
        const roomCode = yield* makeRoom("Ciranda");
        const harness = yield* harnessLike;
        const next = yield* attach(roomCode, "harness-1");
        const first = yield* joinParticipant({
          roomCode,
          participantId: "harness-1",
          handlers: harness.handlers,
        });
        yield* harness.opened;
        yield* next;
        yield* next;

        yield* first.kill;
        yield* tunnels.awaitDrop(roomCode, "harness-1");
        expect((yield* next).type).toBe("harness.disconnected");

        yield* joinParticipant({
          roomCode,
          participantId: "harness-1",
          handlers: harness.handlers,
        });
        yield* harness.opened;
        expect(yield* next).toEqual({ type: "harness.connected" });
        yield* harness.produce(message("s1", "de volta"));
        expect(yield* next).toEqual(message("s1", "de volta"));
      })
  );

  it.effect(
    "a participant that shares a model endpoint answers the stream with CallNotSupported and keeps its tunnel",
    () =>
      Effect.gen(function* () {
        const tunnels = yield* Tunnels;
        const roomCode = yield* makeRoom("Coco");
        const next = yield* attach(roomCode, "endpoint-1");
        yield* next;

        yield* joinParticipant({ roomCode, participantId: "endpoint-1" });

        expect(yield* next).toEqual({ type: "harness.connected" });
        expect(yield* next).toEqual({
          type: "harness.disconnected",
          reason: "CallNotSupported",
          message:
            "This participant does not serve the 'HarnessEvents' tunnel call.",
        });
        const tunnel = yield* tunnels.client(roomCode, "endpoint-1");
        expect(yield* tunnel.Echo({ text: "segue" })).toBe("segue");
      })
  );

  it.effect(
    "a handler that was never called is not opened twice on one tunnel",
    () =>
      Effect.gen(function* () {
        const roomCode = yield* makeRoom("Baião");
        const calls = yield* Deferred.make<void>();
        let count = 0;
        const participant = yield* joinParticipant({
          roomCode,
          participantId: "harness-1",
          handlers: TunnelRpcs.toLayerHandler("HarnessEvents", () =>
            Stream.never.pipe(
              Stream.onStart(
                Effect.suspend(() => {
                  count++;
                  return Deferred.succeed(calls, undefined);
                })
              )
            )
          ),
        });

        yield* Deferred.await(calls);
        yield* crossPings(participant, 3);

        expect(count).toBe(1);
      })
  );
});

layer(layerHub(), { excludeTestServices: true })(
  "the long-lived harness stream under load",
  (it) => {
    it.effect(
      "a client that stopped reading does not hold back the tunnel or the other clients",
      () =>
        Effect.gen(function* () {
          const tunnels = yield* Tunnels;
          const clients = yield* HarnessClients;
          const roomCode = yield* makeRoom("Xote");
          const harness = yield* harnessLike;
          // Attached and never read.
          yield* clients.attach(roomCode, "harness-1");
          const next = yield* attach(roomCode, "harness-1");
          yield* joinParticipant({
            roomCode,
            participantId: "harness-1",
            handlers: harness.handlers,
          });
          yield* harness.opened;
          yield* next;
          yield* next;
          const tunnel = yield* tunnels.client(roomCode, "harness-1");

          const flood = Array.from({ length: 5000 }, (_, index) =>
            message("s1", `enchente ${index}`)
          );
          yield* Effect.forEach(flood, harness.produce, { discard: true });
          for (const expected of flood) {
            expect(yield* next).toEqual(expected);
          }

          expect(yield* tunnel.Echo({ text: "vivo" })).toBe("vivo");
        })
    );
  }
);
