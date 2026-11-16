/**
 * A harness participant from the hub's side: a real hub, a real participant
 * runtime, and the `fake` harness running as a subprocess. The hub calls the
 * participant through its tunnel and reads what the harness says through the
 * long-lived stream.
 */
import { expect } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import type { HarnessAttachEvent } from "@gambi/protocol";
import { layer } from "@gambi/testing/effect";
import {
  Context,
  Effect,
  FileSystem,
  Layer,
  Logger,
  Path,
  Queue,
  Stream,
} from "effect";
import { HarnessClients } from "../hub/harness-clients.ts";
import { Tunnels } from "../hub/tunnels.ts";
import { layerHub, managementClient } from "../testing/hub.ts";
import { joinParticipant } from "../testing/participant.ts";
import { fakeHarnessCommand } from "./adapters.ts";
import { Harness } from "./harness.ts";
import { HarnessParticipantHandlers } from "./tunnel-handlers.ts";

const makeRoom = (name: string) =>
  Effect.gen(function* () {
    const client = yield* managementClient;
    const { room } = yield* client.rooms.create({ payload: { name } });
    return room.code;
  });

/** The `fake` harness, running in a new Workspace until the test ends. */
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
  return { context, harness: Context.get(context, Harness), workspacePath };
});

/** Joins the room as a harness participant that serves the given harness. */
const joinWith = (
  roomCode: string,
  participantId: string,
  harness: Context.Context<Harness>
) =>
  joinParticipant({
    roomCode,
    participantId,
    profile: { model: "fake", harness: { id: "fake" } },
    handlers: HarnessParticipantHandlers.pipe(
      Layer.provide(Layer.succeedContext(harness))
    ),
  });

/** A client attached in the hub: its events, one at a time. */
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

const prompt = (id: number, sessionId: string, text: string) => ({
  jsonrpc: "2.0",
  id,
  method: "session/prompt",
  params: { sessionId, prompt: [{ type: "text", text }] },
});

layer(Layer.merge(layerHub(), BunServices.layer), {
  excludeTestServices: true,
})("a harness participant", (it) => {
  it.effect(
    "the hub sends an ACP message through the tunnel and reads the harness's answer from the stream",
    () =>
      Effect.gen(function* () {
        const tunnels = yield* Tunnels;
        const roomCode = yield* makeRoom("Frevo");
        const { context } = yield* startHarness;
        const next = yield* attach(roomCode, "harness-1");
        yield* joinWith(roomCode, "harness-1", context);
        const tunnel = yield* tunnels.client(roomCode, "harness-1");

        expect((yield* next).type).toBe("harness.disconnected");
        expect(yield* next).toEqual({ type: "harness.connected" });
        // The session the runtime opened before it joined.
        expect(yield* next).toEqual({
          type: "harness.session",
          sessionId: "main",
          status: "opened",
        });

        yield* tunnel.HarnessSend({
          sessionId: "main",
          message: prompt(1, "main", "oi"),
        });

        const update = yield* next;
        expect(update.type).toBe("harness.message");
        expect(update).toMatchObject({
          sessionId: "main",
          message: {
            method: "session/update",
            params: {
              sessionId: "main",
              update: {
                content: { type: "text", text: "Fake ACP response: oi" },
              },
            },
          },
        });
        expect(yield* next).toEqual({
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
    "the hub opens and closes harness sessions with ordinary calls, and their failures are typed",
    () =>
      Effect.gen(function* () {
        const tunnels = yield* Tunnels;
        const path = yield* Path.Path;
        const roomCode = yield* makeRoom("Maracatu");
        const { context, workspacePath } = yield* startHarness;
        const next = yield* attach(roomCode, "harness-1");
        yield* joinWith(roomCode, "harness-1", context);
        const tunnel = yield* tunnels.client(roomCode, "harness-1");
        yield* next;
        yield* next;
        yield* next;

        yield* tunnel.HarnessOpenSession({ sessionId: "squad-a" });
        expect(yield* next).toEqual({
          type: "harness.session",
          sessionId: "squad-a",
          status: "opened",
        });

        const outside = yield* tunnel
          .HarnessOpenSession({
            sessionId: "escape",
            cwd: path.join(workspacePath, ".."),
          })
          .pipe(Effect.flip);
        expect(outside._tag).toBe("HarnessSessionOutsideWorkspace");

        yield* tunnel.HarnessCloseSession({ sessionId: "squad-a" });
        expect(yield* next).toEqual({
          type: "harness.session",
          sessionId: "squad-a",
          status: "closed",
        });

        const closed = yield* tunnel
          .HarnessSend({
            sessionId: "squad-a",
            message: prompt(1, "squad-a", "tarde"),
          })
          .pipe(Effect.flip);
        expect(closed._tag).toBe("HarnessSessionNotOpen");
        expect(closed.message).toBe("Harness session 'squad-a' is not open.");
      })
  );

  it.effect("the room shows which harness the participant contributes", () =>
    Effect.gen(function* () {
      const client = yield* managementClient;
      const roomCode = yield* makeRoom("Ciranda");
      const { context } = yield* startHarness;
      yield* joinWith(roomCode, "harness-1", context);
      yield* joinParticipant({ roomCode, participantId: "endpoint-1" });

      const participants = yield* client.participants.list({
        params: { code: roomCode },
      });

      expect(
        participants.map((participant) => [participant.id, participant.harness])
      ).toEqual([
        ["harness-1", { id: "fake" }],
        ["endpoint-1", undefined],
      ]);
    })
  );

  it.effect(
    "a participant that shares a model endpoint answers the harness calls with CallNotSupported",
    () =>
      Effect.gen(function* () {
        const tunnels = yield* Tunnels;
        const roomCode = yield* makeRoom("Coco");
        yield* joinParticipant({ roomCode, participantId: "endpoint-1" });
        const tunnel = yield* tunnels.client(roomCode, "endpoint-1");

        const errors = yield* Effect.all([
          Effect.flip(
            tunnel.HarnessSend({
              sessionId: "main",
              message: prompt(1, "main", "oi"),
            })
          ),
          Effect.flip(tunnel.HarnessOpenSession({ sessionId: "squad-a" })),
          Effect.flip(tunnel.HarnessCloseSession({ sessionId: "squad-a" })),
        ]);

        expect(errors.map((error) => [error._tag, error.message])).toEqual([
          [
            "CallNotSupported",
            "This participant does not serve the 'HarnessSend' tunnel call.",
          ],
          [
            "CallNotSupported",
            "This participant does not serve the 'HarnessOpenSession' tunnel call.",
          ],
          [
            "CallNotSupported",
            "This participant does not serve the 'HarnessCloseSession' tunnel call.",
          ],
        ]);
      })
  );

  it.effect(
    "the harness outlives a tunnel: what it says while the tunnel is down goes up on the next one, and its sessions are still open",
    () =>
      Effect.gen(function* () {
        const tunnels = yield* Tunnels;
        const roomCode = yield* makeRoom("Caboclinho");
        const { context, harness } = yield* startHarness;
        const next = yield* attach(roomCode, "harness-1");
        const first = yield* joinWith(roomCode, "harness-1", context);
        yield* next;
        yield* next;
        yield* next;
        const pid = harness.pid;

        yield* first.kill;
        yield* tunnels.awaitDrop(roomCode, "harness-1");
        expect((yield* next).type).toBe("harness.disconnected");
        // The harness keeps working with no tunnel.
        yield* harness.send("main", prompt(5, "main", "sem túnel"));

        yield* joinWith(roomCode, "harness-1", context);
        expect(yield* next).toEqual({ type: "harness.connected" });
        expect((yield* next).type).toBe("harness.message");
        expect(yield* next).toMatchObject({
          type: "harness.message",
          message: { id: 5 },
        });
        expect(harness.pid).toBe(pid);

        const tunnel = yield* tunnels.client(roomCode, "harness-1");
        yield* tunnel.HarnessSend({
          sessionId: "main",
          message: prompt(6, "main", "de volta"),
        });
        expect((yield* next).type).toBe("harness.message");
        expect(yield* next).toMatchObject({ message: { id: 6 } });
      })
  );
});
