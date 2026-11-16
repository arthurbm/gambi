/**
 * The harness on the participant's machine, against real subprocesses: the
 * deterministic `fake` harness and the misbehaving ones of
 * `../testing/harness-fixtures.ts`. No model and no real harness is called.
 */
import { expect } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import { GAMBI_VERSION, type HarnessEvent } from "@gambi/protocol";
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
import {
  fixtureHarness,
  nothingHoldsOpen,
} from "../testing/harness-fixtures.ts";
import { fakeHarnessCommand } from "./adapters.ts";
import { Harness, type HarnessOptions } from "./harness.ts";

/** A harness in a new Workspace, stopped when the test ends or by `stop`. */
const start = (options: Partial<HarnessOptions> = {}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const workspacePath = yield* fs.makeTempDirectoryScoped({
      prefix: "gambi-harness-",
    });
    const scope = yield* Scope.fork(yield* Effect.scope);
    const context = yield* Layer.buildWithScope(
      Harness.layer({
        command: fakeHarnessCommand(),
        workspacePath,
        ...options,
      }).pipe(Layer.provide(Logger.layer([]))),
      scope
    );
    const harness = Context.get(context, Harness);
    const produced = yield* Queue.unbounded<HarnessEvent>();
    yield* Stream.runForEach(harness.events, (event) =>
      Queue.offer(produced, event)
    ).pipe(Effect.forkIn(scope));
    return {
      harness,
      next: Queue.take(produced),
      stop: Scope.close(scope, Exit.void),
      workspacePath,
    };
  });

const prompt = (id: number, sessionId: string, text: string) => ({
  jsonrpc: "2.0",
  id,
  method: "session/prompt",
  params: { sessionId, prompt: [{ type: "text", text }] },
});

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

// Real subprocesses and files, on the real clock.
layer(BunServices.layer, { excludeTestServices: true })(
  "the harness of a participant",
  (it) => {
    it.effect(
      "starts the harness, negotiates ACP v1 and opens a session in the Workspace",
      () =>
        Effect.gen(function* () {
          const { harness, next } = yield* start();

          expect(isAlive(harness.pid)).toBe(true);
          expect(yield* next).toEqual({
            type: "harness.session",
            sessionId: harness.sessionId,
            status: "opened",
          });
        })
    );

    it.effect(
      "relays an ACP message to the harness and what the harness answers, under the session id the client knows",
      () =>
        Effect.gen(function* () {
          const { harness, next, workspacePath } = yield* start();
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          yield* next;

          yield* harness.send(
            harness.sessionId,
            prompt(7, harness.sessionId, "oi")
          );

          expect(yield* next).toEqual({
            type: "harness.message",
            sessionId: harness.sessionId,
            message: {
              jsonrpc: "2.0",
              method: "session/update",
              params: {
                sessionId: harness.sessionId,
                update: {
                  sessionUpdate: "agent_message_chunk",
                  content: { type: "text", text: "Fake ACP response: oi" },
                },
              },
            },
          });
          expect(yield* next).toEqual({
            type: "harness.message",
            sessionId: harness.sessionId,
            message: {
              jsonrpc: "2.0",
              id: 7,
              result: { stopReason: "end_turn" },
            },
          });
          // The harness ran in the Workspace.
          expect(
            yield* fs.readFileString(
              path.join(workspacePath, "fake-output.txt")
            )
          ).toBe("Fake ACP response: oi\n");
        })
    );

    it.effect(
      "a client opens sessions of its own, and each one hears only its answers",
      () =>
        Effect.gen(function* () {
          const { harness, next } = yield* start();
          yield* next;

          yield* harness.openSession("squad-a");
          expect(yield* next).toEqual({
            type: "harness.session",
            sessionId: "squad-a",
            status: "opened",
          });
          // Opening it again changes nothing and says nothing.
          yield* harness.openSession("squad-a");

          yield* harness.send("squad-a", prompt(1, "squad-a", "a"));
          yield* harness.send(
            harness.sessionId,
            prompt(2, harness.sessionId, "b")
          );

          const heard = [yield* next, yield* next, yield* next, yield* next];
          expect(
            heard.map((event) => [
              event.sessionId,
              event.type === "harness.message"
                ? (event.message.id ?? "update")
                : "",
            ])
          ).toEqual([
            ["squad-a", "update"],
            ["squad-a", 1],
            [harness.sessionId, "update"],
            [harness.sessionId, 2],
          ]);

          yield* harness.closeSession("squad-a");
          expect(yield* next).toEqual({
            type: "harness.session",
            sessionId: "squad-a",
            status: "closed",
          });
          const error = yield* harness
            .send("squad-a", prompt(3, "squad-a", "c"))
            .pipe(Effect.flip);
          expect(error._tag).toBe("HarnessSessionNotOpen");
          expect(error.message).toBe("Harness session 'squad-a' is not open.");
          // Closing what is not open is not an error.
          yield* harness.closeSession("squad-a");
        })
    );

    it.effect(
      "what the participant itself has to say goes up in the same stream, in order with what the harness says",
      () =>
        Effect.gen(function* () {
          const { harness, next } = yield* start();
          yield* next;

          yield* harness.send(
            harness.sessionId,
            prompt(1, harness.sessionId, "a")
          );
          expect((yield* next).type).toBe("harness.message");
          expect((yield* next).type).toBe("harness.message");
          yield* harness.publish({
            type: "harness.session",
            sessionId: harness.sessionId,
            status: "error",
            message: "Workspace watcher: too many open files",
          });

          expect(yield* next).toEqual({
            type: "harness.session",
            sessionId: harness.sessionId,
            status: "error",
            message: "Workspace watcher: too many open files",
          });
        })
    );

    it.effect(
      "two clients that open the same session at the same time get one session in the harness",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const seen = yield* fs.makeTempFileScoped();
          const { harness } = yield* start({
            command: fixtureHarness("recording", seen),
          });

          yield* Effect.all(
            [harness.openSession("squad-a"), harness.openSession("squad-a")],
            { concurrency: "unbounded" }
          );
          yield* Effect.all(
            [harness.closeSession("squad-a"), harness.closeSession("squad-a")],
            { concurrency: "unbounded" }
          );

          const methods = (yield* fs.readFileString(seen))
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line).method);
          // The session the runtime opened at start, then one more, closed once.
          expect(methods).toEqual([
            "initialize",
            "session/new",
            "session/new",
            "session/close",
          ]);
        })
    );

    it.effect(
      "two sessions whose clients number their requests alike each get their own answer",
      () =>
        Effect.gen(function* () {
          const { harness, next } = yield* start();
          yield* next;
          yield* harness.openSession("squad-a");
          yield* harness.openSession("squad-b");
          yield* next;
          yield* next;

          // Each client counts its requests from 1, as a JSON-RPC client does.
          yield* harness.send("squad-a", prompt(1, "squad-a", "para a"));
          yield* harness.send("squad-b", prompt(1, "squad-b", "para b"));

          const heard = [yield* next, yield* next, yield* next, yield* next];
          expect(
            heard.map((event) =>
              event.type === "harness.message"
                ? [event.sessionId, event.message.id ?? "update"]
                : []
            )
          ).toEqual([
            ["squad-a", "update"],
            ["squad-a", 1],
            ["squad-b", "update"],
            ["squad-b", 1],
          ]);
        })
    );

    it.effect(
      "a session whose opening was given up on halfway is still opened once, and is there for whoever asks again",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const seen = yield* fs.makeTempFileScoped();
          const { harness, next } = yield* start({
            command: fixtureHarness("slow-open", seen),
          });
          yield* next;

          const opening = yield* Effect.forkChild(
            harness.openSession("squad-a")
          );
          // The harness has the request and has not answered it.
          expect(yield* next).toMatchObject({
            message: { method: "fixture/opening" },
          });
          // Whoever asked goes away: its tunnel dropped.
          yield* Fiber.interrupt(opening);
          yield* harness.send(harness.sessionId, {
            jsonrpc: "2.0",
            method: "fixture/release",
          });

          // The harness opened it, and the runtime knows.
          expect(yield* next).toEqual({
            type: "harness.session",
            sessionId: "squad-a",
            status: "opened",
          });
          yield* harness.openSession("squad-a");
          const opens = (yield* fs.readFileString(seen))
            .trim()
            .split("\n")
            .filter((line) => JSON.parse(line).method === "session/new");
          // The session of the start, and one for `squad-a`.
          expect(opens).toHaveLength(2);
        })
    );

    it.effect("a session cannot leave the Workspace", () =>
      Effect.gen(function* () {
        const { harness, next, workspacePath } = yield* start();
        const path = yield* Path.Path;
        yield* next;

        const outside = yield* harness
          .openSession("escape", path.join(workspacePath, "..", "elsewhere"))
          .pipe(Effect.flip);
        expect(outside._tag).toBe("HarnessSessionOutsideWorkspace");
        expect(outside.message).toBe(
          "Harness sessions must stay inside the participant workspace."
        );

        yield* harness.openSession("inside", path.join(workspacePath, "sub"));
        expect(yield* next).toEqual({
          type: "harness.session",
          sessionId: "inside",
          status: "opened",
        });
      })
    );

    it.effect("tells the harness the Gambi version it really is", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const seen = yield* fs.makeTempFileScoped();
        yield* start({ command: fixtureHarness("recording", seen) });

        const [initialize] = (yield* fs.readFileString(seen))
          .trim()
          .split("\n");
        expect(JSON.parse(initialize ?? "{}").params).toEqual({
          protocolVersion: 1,
          clientCapabilities: {},
          clientInfo: { name: "gambi", version: GAMBI_VERSION },
        });
      })
    );

    it.effect(
      "a command that does not exist fails to start with the harness and the command in the error",
      () =>
        Effect.gen(function* () {
          const error = yield* start({
            command: {
              harness: "opencode",
              command: "gambi-no-such-harness",
              args: ["acp"],
            },
          }).pipe(Effect.flip);

          expect(error._tag).toBe("HarnessStartFailed");
          expect(error.message).toBe(
            "Failed to start opencode: could not run 'gambi-no-such-harness'."
          );
        })
    );

    it.effect(
      "a harness that does not speak ACP v1 is refused and its process does not stay",
      () =>
        Effect.gen(function* () {
          const held = yield* nothingHoldsOpen;
          const error = yield* start({
            command: fixtureHarness("acp-v2", held.path),
          }).pipe(Effect.flip);

          expect(error._tag).toBe("HarnessFailed");
          expect(error.message).toBe("Harness did not negotiate ACP v1.");
          yield* held.released;
        })
    );

    it.effect(
      "a harness that never answers fails the start after the request timeout",
      () =>
        Effect.gen(function* () {
          const held = yield* nothingHoldsOpen;
          const error = yield* start({
            command: fixtureHarness("silent", held.path),
            requestTimeout: "200 millis",
          }).pipe(Effect.flip);

          expect(error.message).toBe("ACP initialize timed out.");
          yield* held.released;
        })
    );

    it.effect(
      "a harness that exits on its own fails what was waiting for it and says so to every open session",
      () =>
        Effect.gen(function* () {
          const { harness, next } = yield* start({
            command: fixtureHarness("crashes-on-prompt"),
          });
          yield* next;

          yield* harness.send(
            harness.sessionId,
            prompt(1, harness.sessionId, "x")
          );

          const exit = yield* harness.exited;
          expect(exit.exitCode).toBe(7);
          expect(exit.message).toBe(
            "Harness process exited with code 7. fixture: crashing on purpose"
          );
          expect(yield* next).toEqual({
            type: "harness.session",
            sessionId: harness.sessionId,
            status: "error",
            message:
              "Harness process exited with code 7. fixture: crashing on purpose",
          });
          const late = yield* harness.openSession("after").pipe(Effect.flip);
          expect(late._tag).toBe("HarnessFailed");
          expect(late.message).toBe(
            "Harness process exited with code 7. fixture: crashing on purpose"
          );
        })
    );

    it.effect("stopping kills the harness and everything it started", () =>
      Effect.gen(function* () {
        const held = yield* nothingHoldsOpen;
        const { harness, next, stop } = yield* start({
          command: fixtureHarness("with-child", held.path),
        });
        yield* next;
        const pid = harness.pid;

        yield* stop;

        expect(isAlive(pid)).toBe(false);
        // The harness and the process it started are both gone.
        yield* held.released;
      })
    );

    it.effect(
      "a harness that ignores SIGTERM, with a child that ignores it too, is killed after the stop timeout",
      () =>
        Effect.gen(function* () {
          const held = yield* nothingHoldsOpen;
          const { harness, next, stop } = yield* start({
            command: fixtureHarness("stubborn", held.path),
            stopTimeout: "300 millis",
          });
          yield* next;
          const pid = harness.pid;

          yield* stop;

          expect(isAlive(pid)).toBe(false);
          yield* held.released;
        })
    );
  }
);
