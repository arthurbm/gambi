/**
 * The tunnel has no channel that writes a file on the participant's machine
 * (ADR-0006): artifacts go up, and nothing comes down into the Workspace.
 *
 * This holds as long as no call of the tunnel makes the participant runtime
 * write. So the test makes every call there is, with payloads that name
 * folders and carry file contents, on a participant whose file system
 * records what the runtime does with it; afterwards the runtime has written
 * nothing and the Workspace holds what it held.
 *
 * The harness here is one that writes nothing and records what it is told. A
 * harness at work does write in its Workspace, which is what it is for: that
 * is the harness the participant chose to run, not the tunnel.
 *
 * `everyCall` has one entry per call of `TunnelRpcs`, and the compiler asks
 * for the entry of a new call. Whoever adds one writes here how the hub makes
 * it, and the test then says whether that call writes.
 */
import { expect } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { layer } from "@gambi/testing/effect";
import {
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Logger,
  Path,
  Scope,
  Stream,
} from "effect";
import { Socket } from "effect/socket";
import { HarnessClients } from "../hub/harness-clients.ts";
import { Hub } from "../hub/hub.ts";
import { type TunnelClient, Tunnels } from "../hub/tunnels.ts";
import { fixtureHarness } from "../testing/harness-fixtures.ts";
import { layerHub, managementClient } from "../testing/hub.ts";
import { harnessParticipant } from "./harness-participant.ts";
import { Workspace } from "./workspace.ts";

/** What a participant runtime may do with the Workspace: look at it. */
const READS: ReadonlySet<string> = new Set([
  "exists",
  "readDirectory",
  "readDirectoryEntries",
  "readFile",
  "readFileString",
  "stat",
  "watch",
]);

/**
 * The file system, recording the name of each operation that is asked of it:
 * `used` lists them, in order.
 */
const recordingFileSystem = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const used: string[] = [];
  const recorded = Object.fromEntries(
    Object.entries(fs).map(([name, operation]) => [
      name,
      typeof operation === "function"
        ? (...args: unknown[]) => {
            used.push(name);
            return operation(...args);
          }
        : operation,
    ])
  );
  return { fs: { ...fs, ...recorded } as FileSystem.FileSystem, used };
});

layer(Layer.merge(layerHub(), BunServices.layer), {
  excludeTestServices: true,
})("the tunnel and the participant's files", (it) => {
  it.effect(
    "no call of the tunnel makes the participant runtime write a file: the Workspace holds what it held",
    () =>
      Effect.gen(function* () {
        const hub = yield* Hub;
        const tunnels = yield* Tunnels;
        const clients = yield* HarnessClients;
        const realFs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const client = yield* managementClient;
        const { room } = yield* client.rooms.create({
          payload: { name: "Frevo" },
        });
        const folder = yield* realFs.makeTempDirectoryScoped({
          prefix: "gambi-read-only-",
        });
        const told = path.join(
          yield* realFs.makeTempDirectoryScoped({ prefix: "gambi-told-" }),
          "told.ndjson"
        );
        const { fs, used } = yield* recordingFileSystem;
        const mainOpened = yield* (yield* clients.attach(
          room.code,
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
              roomCode: room.code,
              participantId: "harness-1",
              profile: {
                nickname: "Ana",
                model: "fake",
                harness: { id: "fake" },
              },
            },
            harness: {
              command: fixtureHarness("recording", told),
              sessionId: "main",
            },
          }).pipe(
            Layer.provide(
              Workspace.layerLocalDirectory({
                roomCode: room.code,
                participantId: "harness-1",
                harness: "fake",
                model: "fake",
                path: folder,
              })
            ),
            Layer.provide(Layer.succeed(FileSystem.FileSystem, fs)),
            Layer.provide(Socket.layerWebSocketConstructorGlobal),
            Layer.provide(Logger.layer([]))
          ),
          scope
        );
        yield* Fiber.join(mainOpened);
        const metadata = yield* realFs.readFileString(
          path.join(folder, ".gambi.json")
        );
        // Preparing the Workspace wrote its metadata. From here on the
        // participant is online and only the hub speaks.
        used.length = 0;

        const tunnel = yield* tunnels.client(room.code, "harness-1");
        const file = { path: "planted.txt", encoding: "utf8", content: "x" };
        const everyCall: {
          readonly [Call in keyof TunnelClient]: Effect.Effect<
            unknown,
            unknown
          >;
        } = {
          Welcome: tunnel.Welcome({
            roomCode: room.code,
            participantId: "harness-1",
            hubVersion: "0.0.0",
            pingIntervalMillis: 5000,
          }),
          Echo: tunnel.Echo({ text: path.join(folder, "planted.txt") }),
          Ticks: Stream.runDrain(tunnel.Ticks({ count: 3 })),
          Infer: Effect.all([
            Stream.runDrain(
              tunnel.Infer({
                operation: "chatCompletions.create",
                body: JSON.stringify({ files: [file] }),
              })
            ).pipe(Effect.exit),
            Stream.runDrain(
              tunnel.Infer({
                operation: "responses.retrieve",
                responseId: "../planted.txt",
              })
            ).pipe(Effect.exit),
          ]),
          // It has no payload: nothing goes down with it. The hub has it open
          // since the tunnel opened, and the artifacts come up through it.
          HarnessEvents: Effect.void,
          HarnessSend: Effect.all([
            // What an artifact looks like, sent the wrong way.
            tunnel.HarnessSend({
              sessionId: "main",
              message: {
                type: "harness.artifact",
                sessionId: "main",
                version: 1,
                reason: "watch",
                files: [file],
              },
            }),
            // What ACP calls writing a file, which an agent asks of its
            // client and never the other way round.
            tunnel.HarnessSend({
              sessionId: "main",
              message: {
                jsonrpc: "2.0",
                id: 1,
                method: "fs/write_text_file",
                params: { sessionId: "main", ...file },
              },
            }),
            tunnel.HarnessSend({
              sessionId: "main",
              message: {
                jsonrpc: "2.0",
                id: 2,
                method: "session/prompt",
                params: {
                  sessionId: "main",
                  prompt: [{ type: "text", text: "oi" }],
                },
              },
            }),
          ]),
          HarnessOpenSession: Effect.all([
            // A folder of the Workspace that does not exist is not made.
            tunnel.HarnessOpenSession({
              sessionId: "squad-a",
              cwd: "not-there/yet",
            }),
            tunnel
              .HarnessOpenSession({
                sessionId: "escape",
                cwd: path.join(folder, "..", "planted"),
              })
              .pipe(Effect.exit),
          ]),
          HarnessCloseSession: tunnel.HarnessCloseSession({
            sessionId: "squad-a",
          }),
        };
        for (const call of Object.values(everyCall)) {
          yield* call;
        }
        // Closing takes the last artifact, which reads the whole Workspace.
        yield* Scope.close(scope, Exit.void);

        expect(used.filter((operation) => !READS.has(operation))).toEqual([]);
        expect(used).toContain("readDirectoryEntries");
        expect(
          yield* realFs.readDirectory(folder, { recursive: true })
        ).toEqual([".gambi.json"]);
        expect(
          yield* realFs.readFileString(path.join(folder, ".gambi.json"))
        ).toBe(metadata);
        expect(yield* realFs.exists(path.join(folder, "..", "planted"))).toBe(
          false
        );
        // What looked like a file went where every message goes: to the
        // harness, as a message.
        const heard = (yield* realFs.readFileString(told))
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as Record<string, unknown>);
        expect(heard.map((message) => message.method ?? message.type)).toEqual([
          "initialize",
          "session/new",
          "harness.artifact",
          "fs/write_text_file",
          "session/prompt",
          "session/new",
          "session/close",
        ]);
      }),
    20_000
  );
});
