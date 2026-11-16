/**
 * The artifacts of a harness participant, from outside the hub: a harness
 * participant hosted whole (`harnessParticipant`), with the `fake` harness as
 * a subprocess in a real folder, and a management client attached over SSE.
 * Files change on the participant's machine and the client reads artifacts.
 */
import { expect } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import type { HarnessAttachEvent } from "@gambi/protocol";
import { layer } from "@gambi/testing/effect";
import {
  Context,
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
import { Socket } from "effect/socket";
import { fakeHarnessCommand } from "../harness/adapters.ts";
import { Harness } from "../harness/harness.ts";
import { harnessParticipant } from "../harness/harness-participant.ts";
import { HarnessParticipantHandlers } from "../harness/tunnel-handlers.ts";
import { Workspace } from "../harness/workspace.ts";
import { layerHub, managementClient } from "../testing/hub.ts";
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

/**
 * A harness participant in the room, hosted the way a host does it, in a new
 * folder of its own. It is online, and its session `main` is open, when this
 * returns. `stop` closes it the way its host does.
 */
const host = (roomCode: string) =>
  Effect.gen(function* () {
    const hub = yield* Hub;
    const fs = yield* FileSystem.FileSystem;
    const folder = yield* fs.makeTempDirectoryScoped({
      prefix: "gambi-artifacts-",
    });
    // The harness says `main` opened as soon as the hub reads it. A client
    // of the hub itself waits for that, so a client a test attaches later
    // starts after it.
    const clients = yield* HarnessClients;
    const mainOpened = yield* (yield* clients.attach(
      roomCode,
      "harness-1"
    )).pipe(
      Stream.filter((event) => event.type === "harness.session"),
      Stream.runHead,
      Effect.forkScoped
    );
    const scope = yield* Scope.fork(yield* Effect.scope);
    yield* Layer.buildWithScope(
      harnessParticipant({
        runtime: {
          hubUrl: hub.url,
          roomCode,
          participantId: "harness-1",
          profile: {
            nickname: "Ana",
            model: "fake",
            harness: { id: "fake" },
          },
        },
        harness: { command: fakeHarnessCommand(), sessionId: "main" },
        // The real wait is one second. Here the test waits for the artifact
        // itself, so the stillness that precedes it is kept short.
        artifacts: { settleTime: "20 millis" },
      }).pipe(
        Layer.provide(
          Workspace.layerLocalDirectory({
            roomCode,
            participantId: "harness-1",
            harness: "fake",
            model: "fake",
            path: folder,
          })
        ),
        Layer.provide(Socket.layerWebSocketConstructorGlobal),
        Layer.provide(Logger.layer([]))
      ),
      scope
    );
    yield* Fiber.join(mainOpened);
    return { folder, stop: Scope.close(scope, Exit.void) };
  });

/**
 * Attaches a management client over SSE. Returns once the hub answered with
 * the first event, so what the test does next is in `next`, in order.
 */
const attach = (roomCode: string) =>
  Effect.gen(function* () {
    const client = yield* managementClient;
    const received = yield* Queue.unbounded<HarnessAttachEvent>();
    yield* client.harness
      .events({ params: { code: roomCode, id: "harness-1" } })
      .pipe(
        Stream.unwrap,
        Stream.runForEach((event) => Queue.offer(received, event)),
        Effect.orDie,
        Effect.forkScoped
      );
    const first = yield* Queue.take(received);
    return { first, next: Queue.take(received) };
  });

layer(Layer.merge(layerHub(), BunServices.layer), {
  excludeTestServices: true,
})("the artifacts of a harness participant", (it) => {
  it.effect(
    "every attached client reads an artifact after a file of the Workspace changed",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const roomCode = yield* makeRoom("Frevo");
        const { folder } = yield* host(roomCode);
        const first = yield* attach(roomCode);
        const second = yield* attach(roomCode);
        expect(first.first).toEqual({ type: "harness.connected" });

        yield* fs.writeFileString(
          path.join(folder, "index.html"),
          "<h1>frevo</h1>\n"
        );

        for (const attached of [first, second]) {
          expect(yield* attached.next).toEqual({
            type: "harness.artifact",
            sessionId: "main",
            version: 1,
            reason: "watch",
            files: [
              {
                path: "index.html",
                encoding: "utf8",
                content: "<h1>frevo</h1>\n",
              },
            ],
          });
        }
      })
  );

  it.effect(
    "a participant that closes sends a last artifact, and its clients read it before they hear the harness went away",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const roomCode = yield* makeRoom("Maracatu");
        const { folder, stop } = yield* host(roomCode);
        const attached = yield* attach(roomCode);
        yield* fs.writeFileString(path.join(folder, "notes.md"), "# um\n");
        expect(yield* attached.next).toMatchObject({
          type: "harness.artifact",
          version: 1,
          reason: "watch",
        });
        yield* fs.writeFileString(path.join(folder, "notes.md"), "# dois\n");

        // Closed at once, before the change had its stillness.
        yield* stop;

        expect(yield* attached.next).toEqual({
          type: "harness.artifact",
          sessionId: "main",
          version: 2,
          reason: "final",
          files: [{ path: "notes.md", encoding: "utf8", content: "# dois\n" }],
        });
        expect((yield* attached.next).type).toBe("harness.disconnected");
      })
  );

  it.effect(
    "artifacts that waited while the tunnel was down go up one message each: together they are more than the hub accepts in one, and the tunnel stays open",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const tunnels = yield* Tunnels;
        const clients = yield* HarnessClients;
        const roomCode = yield* makeRoom("Caboclinho");
        const workspacePath = yield* fs.makeTempDirectoryScoped({
          prefix: "gambi-artifacts-",
        });
        const running = yield* Layer.build(
          Harness.layer({
            command: fakeHarnessCommand(),
            workspacePath,
            sessionId: "main",
          }).pipe(Layer.provide(Logger.layer([])))
        );
        const harness = Context.get(running, Harness);
        // Three artifacts of 6 MiB: 18 MiB waiting, and the hub drops a
        // tunnel on a message of 16 MiB.
        const content = "A".repeat(6 * 1024 * 1024);
        for (const version of [1, 2, 3]) {
          yield* harness.publish({
            type: "harness.artifact",
            sessionId: "main",
            version,
            reason: "watch",
            files: [{ path: "big.bin", encoding: "base64", content }],
          });
        }
        const received = yield* Queue.unbounded<HarnessAttachEvent>();
        yield* (yield* clients.attach(roomCode, "harness-1")).pipe(
          Stream.runForEach((event) => Queue.offer(received, event)),
          Effect.forkScoped
        );

        yield* joinParticipant({
          roomCode,
          participantId: "harness-1",
          profile: { model: "fake", harness: { id: "fake" } },
          handlers: HarnessParticipantHandlers.pipe(
            Layer.provide(Layer.succeedContext(running))
          ),
        });

        const heard: (readonly [string, number])[] = [];
        while (heard.length < 6) {
          const event = yield* Queue.take(received);
          heard.push([
            event.type,
            event.type === "harness.artifact" ? event.version : 0,
          ]);
        }
        const tunnel = yield* tunnels.client(roomCode, "harness-1");
        expect(heard).toEqual([
          ["harness.disconnected", 0],
          ["harness.connected", 0],
          ["harness.session", 0],
          ["harness.artifact", 1],
          ["harness.artifact", 2],
          ["harness.artifact", 3],
        ]);
        expect(yield* tunnel.Echo({ text: "ainda aqui" })).toBe("ainda aqui");
      }),
    20_000
  );
});
