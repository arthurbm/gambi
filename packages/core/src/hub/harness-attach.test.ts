/**
 * Management clients attached to a harness participant, from outside the
 * hub: the client derived from the contract reads the events over SSE and
 * sends messages and session control as requests. The harness is the `fake`
 * one, running as a subprocess.
 */
import { expect } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import {
  type HarnessAttachEvent,
  type HarnessEvent,
  TunnelRpcs,
} from "@gambi/protocol";
import { it, layer } from "@gambi/testing/effect";
import {
  Duration,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Logger,
  Path,
  Queue,
  Scope,
  Stream,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";
import { TestClock } from "effect/testing";
import { fakeHarnessCommand } from "../harness/adapters.ts";
import { Harness } from "../harness/harness.ts";
import { HarnessParticipantHandlers } from "../harness/tunnel-handlers.ts";
import { layerHub, managementClient } from "../testing/hub.ts";
import { linkToHub } from "../testing/hub-link.ts";
import { joinParticipant } from "../testing/participant.ts";
import { HarnessClients } from "./harness-clients.ts";
import { Hub } from "./hub.ts";
import { Tunnels } from "./tunnels.ts";

const makeRoom = (name: string) =>
  Effect.gen(function* () {
    const client = yield* managementClient;
    const { room } = yield* client.rooms.create({ payload: { name } });
    return room.code;
  });

/** The `fake` harness in a new Workspace, with its session `main` open. */
const startHarness = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const workspacePath = yield* fs.makeTempDirectoryScoped({
    prefix: "gambi-harness-",
  });
  const context = yield* Layer.build(
    Harness.layer({
      command: fakeHarnessCommand(),
      workspacePath,
      sessionId: "main",
    }).pipe(Layer.provide(Logger.layer([])))
  );
  return { context, workspacePath };
});

/** A harness participant in the room, online, serving the `fake` harness. */
const joinHarness = (
  roomCode: string,
  options: { readonly hubUrl?: string; readonly reconnect?: boolean } = {}
) =>
  Effect.gen(function* () {
    const harness = yield* startHarness;
    // The harness says `main` opened as soon as the hub reads it. A client
    // of the hub itself waits for that, so a client a test attaches later
    // starts after it.
    const clients = yield* HarnessClients;
    const settled = yield* clients.attach(roomCode, "harness-1");
    const mainOpened = yield* settled.pipe(
      Stream.filter((event) => event.type === "harness.session"),
      Stream.runHead,
      Effect.forkScoped
    );
    const participant = yield* joinParticipant({
      roomCode,
      participantId: "harness-1",
      profile: { model: "fake", harness: { id: "fake" } },
      handlers: HarnessParticipantHandlers.pipe(
        Layer.provide(Layer.succeedContext(harness.context))
      ),
      ...options,
    });
    yield* Fiber.join(mainOpened);
    return { ...harness, participant };
  });

/**
 * Attaches a management client over SSE. Returns once the hub answered with
 * the first event, so what the test does next is in `next`, in order.
 */
const attach = (roomCode: string, participantId = "harness-1") =>
  Effect.gen(function* () {
    const client = yield* managementClient;
    const received = yield* Queue.unbounded<HarnessAttachEvent, "ended">();
    yield* client.harness
      .events({ params: { code: roomCode, id: participantId } })
      .pipe(
        Stream.unwrap,
        Stream.runForEach((event) => Queue.offer(received, event)),
        Effect.orDie,
        Effect.andThen(Queue.fail(received, "ended")),
        Effect.forkScoped
      );
    const first = yield* Queue.take(received);
    return { first, next: Queue.take(received) };
  });

const prompt = (id: number, sessionId: string, text: string) => ({
  jsonrpc: "2.0",
  id,
  method: "session/prompt",
  params: { sessionId, prompt: [{ type: "text", text }] },
});

const params = (code: string, id = "harness-1") => ({ code, id });

layer(Layer.merge(layerHub(), BunServices.layer), {
  excludeTestServices: true,
})("attaching to a harness participant", (it) => {
  it.effect(
    "a client reads the harness over SSE and talks to it with requests",
    () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const roomCode = yield* makeRoom("Frevo");
        yield* joinHarness(roomCode);
        const attached = yield* attach(roomCode);
        expect(attached.first).toEqual({ type: "harness.connected" });

        const sent = yield* client.harness.send({
          params: params(roomCode),
          payload: { sessionId: "main", message: prompt(1, "main", "oi") },
        });

        expect(sent).toEqual({ sessionId: "main" });
        expect(yield* attached.next).toMatchObject({
          type: "harness.message",
          sessionId: "main",
          message: { method: "session/update" },
        });
        expect(yield* attached.next).toEqual({
          type: "harness.message",
          sessionId: "main",
          message: {
            jsonrpc: "2.0",
            id: 1,
            result: { stopReason: "end_turn" },
          },
        });
      })
  );

  it.effect(
    "several clients attach to the same participant, and each sees the session another one opened and closed",
    () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const roomCode = yield* makeRoom("Maracatu");
        yield* joinHarness(roomCode);
        const first = yield* attach(roomCode);
        const second = yield* attach(roomCode);

        const opened = yield* client.harness.openSession({
          params: { ...params(roomCode), sessionId: "squad-a" },
          payload: {},
        });
        yield* client.harness.send({
          params: params(roomCode),
          payload: {
            sessionId: "squad-a",
            message: prompt(1, "squad-a", "oi"),
          },
        });
        const closed = yield* client.harness.closeSession({
          params: { ...params(roomCode), sessionId: "squad-a" },
        });

        expect(opened).toEqual({ sessionId: "squad-a" });
        expect(closed).toEqual({ sessionId: "squad-a" });
        for (const attached of [first, second]) {
          const heard = [
            yield* attached.next,
            yield* attached.next,
            yield* attached.next,
            yield* attached.next,
          ];
          expect(
            heard.map((event) => [
              event.type,
              "status" in event ? event.status : "",
            ])
          ).toEqual([
            ["harness.session", "opened"],
            ["harness.message", ""],
            ["harness.message", ""],
            ["harness.session", "closed"],
          ]);
        }
      })
  );

  it.effect("what cannot be attached to says why, with a typed error", () =>
    Effect.gen(function* () {
      const client = yield* managementClient;
      const roomCode = yield* makeRoom("Ciranda");
      yield* joinParticipant({ roomCode, participantId: "endpoint-1" });
      const attachTo = (code: string, id: string) =>
        client.harness.events({ params: { code, id } }).pipe(
          Effect.flip,
          Effect.map((error) => error._tag)
        );

      expect(yield* attachTo("NOPE00", "harness-1")).toBe("RoomNotFound");
      expect(yield* attachTo(roomCode, "nobody")).toBe("ParticipantNotFound");
      expect(yield* attachTo(roomCode, "endpoint-1")).toBe(
        "NotAHarnessParticipant"
      );

      const send = yield* client.harness
        .send({
          params: params(roomCode, "endpoint-1"),
          payload: { sessionId: "main", message: prompt(1, "main", "oi") },
        })
        .pipe(Effect.flip);
      expect(send._tag).toBe("NotAHarnessParticipant");
      expect(send.message).toBe(
        `Participant 'endpoint-1' of room '${roomCode}' does not contribute a harness.`
      );
    })
  );

  it.effect(
    "what the harness refuses comes back as the same typed error, with its status and code on the wire",
    () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const hub = yield* Hub;
        const path = yield* Path.Path;
        const roomCode = yield* makeRoom("Coco");
        const { workspacePath } = yield* joinHarness(roomCode);

        const notOpen = yield* client.harness
          .send({
            params: params(roomCode),
            payload: {
              sessionId: "never-opened",
              message: prompt(1, "never-opened", "oi"),
            },
          })
          .pipe(Effect.flip);
        expect(notOpen._tag).toBe("HarnessSessionNotOpen");
        expect(notOpen.message).toBe(
          "Harness session 'never-opened' is not open."
        );

        const outside = yield* client.harness
          .openSession({
            params: { ...params(roomCode), sessionId: "escape" },
            payload: { cwd: path.join(workspacePath, "..") },
          })
          .pipe(Effect.flip);
        expect(outside._tag).toBe("HarnessSessionOutsideWorkspace");

        const response = yield* HttpClient.execute(
          HttpClientRequest.post(
            `${hub.url}/v1/rooms/${roomCode}/participants/harness-1/harness/messages`
          ).pipe(
            HttpClientRequest.bodyJsonUnsafe({
              sessionId: "never-opened",
              message: {},
            })
          )
        );
        expect(response.status).toBe(409);
        expect(yield* response.json).toEqual({
          error: {
            code: "HARNESS_SESSION_NOT_OPEN",
            message: "Harness session 'never-opened' is not open.",
            hint: "Open the session first, or use the id of a session that is open.",
            details: { sessionId: "never-opened" },
          },
          meta: { requestId: expect.any(String) },
        });
      })
  );

  it.effect(
    "a participant whose tunnel is down keeps its clients attached and refuses requests as unreachable",
    () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const tunnels = yield* Tunnels;
        const roomCode = yield* makeRoom("Caboclinho");
        const { participant } = yield* joinHarness(roomCode);
        const attached = yield* attach(roomCode);

        yield* participant.kill;
        yield* tunnels.awaitDrop(roomCode, "harness-1");

        expect(yield* attached.next).toMatchObject({
          type: "harness.disconnected",
          reason: "SocketCloseError",
        });
        const error = yield* client.harness
          .send({
            params: params(roomCode),
            payload: { sessionId: "main", message: prompt(1, "main", "oi") },
          })
          .pipe(Effect.flip);
        expect(error._tag).toBe("ParticipantUnreachable");
        expect(error.message).toBe(
          `Participant 'harness-1' of room '${roomCode}' is offline.`
        );
        // Attaching now works too, and starts by saying the harness is away.
        const late = yield* attach(roomCode);
        expect(late.first).toMatchObject({ type: "harness.disconnected" });
      })
  );

  it.effect(
    "a client is attached from the moment the hub answers, so a participant that leaves before the client reads still detaches it",
    () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const roomCode = yield* makeRoom("Samba");
        const { participant } = yield* joinHarness(roomCode);

        // The hub answered; the client has not read one event yet.
        const events = yield* client.harness.events({
          params: params(roomCode),
        });
        yield* client.participants.remove({
          params: params(roomCode),
          query: { runtimeId: participant.runtime.runtimeId },
        });

        expect(yield* Stream.runCollect(events)).toEqual([
          { type: "harness.connected" },
          { type: "harness.detached", reason: "left" },
        ]);
      })
  );

  it.effect(
    "a client that goes away is detached: the hub keeps nothing for it",
    () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const clients = yield* HarnessClients;
        const roomCode = yield* makeRoom("Choro");
        yield* joinHarness(roomCode);
        // `joinHarness` keeps one client of its own attached.
        const before = yield* clients.count(roomCode, "harness-1");

        // Reads one event and closes the connection.
        const first = yield* client.harness
          .events({ params: params(roomCode) })
          .pipe(Stream.unwrap, Stream.take(1), Stream.runCollect);

        expect(first).toEqual([{ type: "harness.connected" }]);
        // The hub notices the closed connection a moment later.
        yield* clients
          .count(roomCode, "harness-1")
          .pipe(Effect.repeat({ until: (count) => count === before }));
      })
  );

  it.effect(
    "when the participant leaves the room, its clients read why and their stream ends",
    () =>
      Effect.gen(function* () {
        const client = yield* managementClient;
        const roomCode = yield* makeRoom("Xote");
        const { participant } = yield* joinHarness(roomCode);
        const attached = yield* attach(roomCode);

        yield* client.participants.remove({
          params: params(roomCode),
          query: { runtimeId: participant.runtime.runtimeId },
        });

        expect(yield* attached.next).toEqual({
          type: "harness.detached",
          reason: "left",
        });
        expect(yield* Effect.flip(attached.next)).toBe("ended");
      })
  );
});

layer(layerHub(), { excludeTestServices: true })(
  "the harness group of the contract",
  (it) => {
    it.effect("is in the OpenAPI document, with its statuses", () =>
      Effect.gen(function* () {
        const hub = yield* Hub;
        const response = yield* HttpClient.get(`${hub.url}/v1/openapi.json`);

        expect(yield* response.json).toMatchObject({
          paths: {
            "/v1/rooms/{code}/participants/{id}/harness/events": {
              get: {
                operationId: "harness.events",
                responses: { "200": {}, "404": {}, "409": {} },
              },
            },
            "/v1/rooms/{code}/participants/{id}/harness/messages": {
              post: {
                operationId: "harness.send",
                responses: { "202": {}, "404": {}, "409": {}, "502": {} },
              },
            },
            "/v1/rooms/{code}/participants/{id}/harness/sessions/{sessionId}": {
              put: {
                operationId: "harness.openSession",
                responses: { "200": {}, "403": {}, "409": {}, "502": {} },
              },
              delete: {
                operationId: "harness.closeSession",
                responses: { "200": {}, "409": {}, "502": {} },
              },
            },
          },
        });
      })
    );
  }
);

// A hub with a small buffer per client, to see what a slow client loses.
layer(layerHub({ harnessClientBuffer: 4 }), { excludeTestServices: true })(
  "a slow client of a harness participant",
  (it) => {
    it.effect(
      "loses its oldest events, is told how many at that point of its stream, and holds back nobody",
      () =>
        Effect.gen(function* () {
          const clients = yield* HarnessClients;
          const roomCode = yield* makeRoom("Baião");
          const produced = yield* Queue.unbounded<HarnessEvent>();
          yield* joinParticipant({
            roomCode,
            participantId: "harness-1",
            profile: { harness: { id: "fake" } },
            handlers: TunnelRpcs.toLayerHandler("HarnessEvents", () =>
              Stream.fromQueue(produced)
            ),
          });
          const event = (index: number): HarnessEvent => ({
            type: "harness.message",
            sessionId: "main",
            message: { index },
          });
          // Two clients in the hub: one reads as events come, one does not.
          const slow = yield* clients.attach(roomCode, "harness-1");
          const fast = yield* clients.attach(roomCode, "harness-1");
          const seen = yield* Queue.unbounded<HarnessAttachEvent>();
          yield* Stream.runForEach(fast, (item) =>
            Queue.offer(seen, item)
          ).pipe(Effect.forkScoped);
          yield* Queue.take(seen);

          yield* Effect.forEach(
            Array.from({ length: 10 }, (_, index) => index),
            (index) => Queue.offer(produced, event(index)),
            { discard: true }
          );
          // The client that reads got every one of them.
          for (let index = 0; index < 10; index++) {
            expect(yield* Queue.take(seen)).toEqual(event(index));
          }

          // The initial state precedes the loss notice and the last four events.
          const kept = yield* slow.pipe(
            Stream.takeUntil(
              (item) =>
                item.type === "harness.message" && item.message.index === 9
            ),
            Stream.runCollect
          );
          expect(kept).toEqual([
            { type: "harness.connected" },
            { type: "harness.dropped", count: 6 },
            event(6),
            event(7),
            event(8),
            event(9),
          ]);
        })
    );
  }
);

it.live(
  "closing the hub ends the attached streams first: it takes under a second and each client sees its stream complete",
  () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(layerHub(), scope);
      const readers = yield* Effect.gen(function* () {
        const client = yield* managementClient;
        const roomCode = yield* makeRoom("Afoxé");
        yield* joinParticipant({
          roomCode,
          participantId: "harness-1",
          profile: { harness: { id: "fake" } },
          handlers: TunnelRpcs.toLayerHandler(
            "HarnessEvents",
            () => Stream.never
          ),
        });
        const reading = yield* Effect.forEach([1, 2, 3], () =>
          client.harness
            .events({ params: params(roomCode) })
            .pipe(
              Stream.unwrap,
              Stream.runCount,
              Effect.forkChild({ startImmediately: true })
            )
        );
        // They are open on the hub: this one arrived after them.
        yield* attach(roomCode);
        return reading;
      }).pipe(Effect.provide(context));

      const [elapsed] = yield* Effect.timed(Scope.close(scope, Exit.void));

      expect(Duration.toMillis(elapsed)).toBeLessThan(1000);
      for (const reader of readers) {
        // Each stream ended without an error, after its first event.
        expect(yield* Fiber.join(reader)).toBeGreaterThanOrEqual(1);
      }
    })
);

it.effect(
  "clients stay attached while the participant runtime reconnects by itself, and read the harness again when it is back",
  () =>
    Effect.gen(function* () {
      const client = yield* managementClient;
      const roomCode = yield* makeRoom("Forró");
      const link = yield* linkToHub;
      const { participant } = yield* joinHarness(roomCode, {
        hubUrl: link.url,
        reconnect: true,
      });
      yield* participant.nextLifecycleEvent;
      const attached = yield* attach(roomCode);
      expect(attached.first).toEqual({ type: "harness.connected" });

      // The path to the hub goes away. The hub and the harness keep running.
      yield* link.cut;
      expect((yield* participant.nextLifecycleEvent).type).toBe("reconnecting");
      expect((yield* attached.next).type).toBe("harness.disconnected");

      yield* link.restore;
      yield* TestClock.adjust("1 second");
      expect((yield* participant.nextLifecycleEvent).type).toBe("connected");

      expect(yield* attached.next).toEqual({ type: "harness.connected" });
      yield* client.harness.send({
        params: params(roomCode),
        payload: { sessionId: "main", message: prompt(9, "main", "de volta") },
      });
      expect((yield* attached.next).type).toBe("harness.message");
      expect(yield* attached.next).toMatchObject({ message: { id: 9 } });
    }).pipe(
      Effect.provide(
        Layer.merge(
          layerHub({ tunnelPingInterval: "1 hour" }),
          BunServices.layer
        )
      )
    ),
  20_000
);
