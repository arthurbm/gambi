/**
 * The artifacts of a harness participant, as they leave the participant: the
 * `fake` harness runs as a subprocess, and the waits run on the test clock.
 * The Workspace is one the test drives, so that it says exactly when the
 * folder changed.
 */
import { expect } from "bun:test";
import { BunServices } from "@effect/platform-bun";
import type { ArtifactFile, HarnessEvent } from "@gambi/protocol";
import { it } from "@gambi/testing/effect";
import {
  Context,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Logger,
  Queue,
  Scope,
  Stream,
} from "effect";
import { TestClock } from "effect/testing";
import { fakeHarnessCommand } from "./adapters.ts";
import { type ArtifactsOptions, workspaceArtifacts } from "./artifacts.ts";
import { Harness } from "./harness.ts";
import { Workspace } from "./workspace.ts";

const text = (path: string, content: string): ArtifactFile => ({
  path,
  encoding: "utf8",
  content,
});

/**
 * A harness participant's side of the artifacts: the `fake` harness, a
 * Workspace the test drives, and what goes up to the hub (`next`).
 */
const start = (
  options: ArtifactsOptions & {
    /**
     * Who reads what goes up, where the tunnel would: `hub` reads it all (the
     * default), `nobody` is a tunnel that is down, and `stalled` is a hub that
     * took the first event and never asked for more.
     */
    readonly reader?: "hub" | "nobody" | "stalled";
  } = {}
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const workspacePath = yield* fs.makeTempDirectoryScoped({
      prefix: "gambi-artifacts-",
    });
    let files: readonly ArtifactFile[] = [];
    const changes = yield* Queue.unbounded<Deferred.Deferred<void>>();
    const DrivenWorkspace = Layer.succeed(
      Workspace,
      Workspace.of({
        path: workspacePath,
        collect: Effect.sync(() => files),
        changes: Stream.fromQueue(changes).pipe(
          Stream.mapEffect((noticed) =>
            Effect.asVoid(Deferred.succeed(noticed, undefined))
          )
        ),
      })
    );
    // The harness runs until the test ends. The artifacts are released
    // before it, by `close`, as they are when a participant closes.
    const running = yield* Layer.build(
      Harness.layer({
        command: fakeHarnessCommand(),
        workspacePath,
        sessionId: "main",
      }).pipe(Layer.provide(Logger.layer([])))
    );
    const harness = Context.get(running, Harness);
    const scope = yield* Scope.fork(yield* Effect.scope);
    yield* Layer.buildWithScope(
      workspaceArtifacts(options).pipe(
        Layer.provide(Layer.succeedContext(running)),
        Layer.provide(DrivenWorkspace),
        Layer.provide(Logger.layer([]))
      ),
      scope
    );
    const produced = yield* Queue.unbounded<HarnessEvent>();
    // The reader stands where the tunnel would, and outlives the participant:
    // what goes up while it closes is read too.
    const read = Stream.runForEach(harness.events, (event) =>
      Queue.offer(produced, event)
    );
    const { reader = "hub" } = options;
    if (reader === "hub") {
      yield* Effect.forkScoped(read);
      // The session the runtime opened at start comes before any artifact.
      yield* Queue.take(produced);
    } else if (reader === "stalled") {
      const taken = yield* Deferred.make<void>();
      yield* Stream.runForEach(harness.events, () =>
        Deferred.succeed(taken, undefined).pipe(Effect.andThen(Effect.never))
      ).pipe(Effect.forkScoped);
      yield* Deferred.await(taken);
    }
    return {
      /**
       * The Workspace now holds these files. Returns when the change was
       * noticed, so the clock can be moved from that moment.
       */
      change: (now: readonly ArtifactFile[]) =>
        Effect.gen(function* () {
          files = now;
          const noticed = yield* Deferred.make<void>();
          yield* Queue.offer(changes, noticed);
          yield* Deferred.await(noticed);
        }),
      next: Queue.take(produced),
      /** Reads what is waiting to go up, as the next tunnel would. */
      read,
      /** How many events went up that the test has not read. */
      unread: Queue.size(produced),
      /** What closing a participant does first: its artifacts end. */
      close: Scope.close(scope, Exit.void),
    };
  }).pipe(Effect.provide(BunServices.layer));

it.effect(
  "an artifact is a whole snapshot of the Workspace, taken one second after its last change",
  () =>
    Effect.gen(function* () {
      const { change, next, unread } = yield* start();

      yield* change([text("index.html", "<h1>rascunho</h1>")]);
      yield* TestClock.adjust("900 millis");
      // A second change before the second is up: the wait starts over.
      yield* change([
        text("index.html", "<h1>frevo</h1>"),
        text("style.css", "h1 { color: red }"),
      ]);
      yield* TestClock.adjust("999 millis");
      expect(yield* unread).toBe(0);
      yield* TestClock.adjust("1 millis");

      expect(yield* next).toEqual({
        type: "harness.artifact",
        sessionId: "main",
        version: 1,
        reason: "watch",
        files: [
          text("index.html", "<h1>frevo</h1>"),
          text("style.css", "h1 { color: red }"),
        ],
      });
    })
);

it.effect(
  "each artifact has the next version and replaces the one before: a file that left the Workspace is not in it",
  () =>
    Effect.gen(function* () {
      const { change, next } = yield* start();

      yield* change([text("a.txt", "a"), text("b.txt", "b")]);
      yield* TestClock.adjust("1 second");
      yield* change([text("b.txt", "b, edited")]);
      yield* TestClock.adjust("1 second");
      yield* change([]);
      yield* TestClock.adjust("1 second");

      const artifacts = [yield* next, yield* next, yield* next];
      expect(
        artifacts.map((artifact) =>
          artifact.type === "harness.artifact"
            ? [artifact.version, artifact.reason, artifact.files]
            : artifact
        )
      ).toEqual([
        [1, "watch", [text("a.txt", "a"), text("b.txt", "b")]],
        [2, "watch", [text("b.txt", "b, edited")]],
        [3, "watch", []],
      ]);
    })
);

it.effect(
  "closing sends a last artifact, with what changed since the one before",
  () =>
    Effect.gen(function* () {
      const { change, close, next, unread } = yield* start();
      yield* change([text("a.txt", "a")]);
      yield* TestClock.adjust("1 second");
      expect(yield* next).toMatchObject({ version: 1, reason: "watch" });
      // Closed before this change had its second of stillness.
      yield* change([text("a.txt", "a"), text("b.txt", "b")]);

      yield* close;

      expect(yield* next).toEqual({
        type: "harness.artifact",
        sessionId: "main",
        version: 2,
        reason: "final",
        files: [text("a.txt", "a"), text("b.txt", "b")],
      });
      expect(yield* unread).toBe(0);
    })
);

it.effect(
  "closing while the tunnel is down waits for nobody, and the last artifact is there for whoever reads next",
  () =>
    Effect.gen(function* () {
      const { change, close, next, read } = yield* start({ reader: "nobody" });
      yield* change([text("a.txt", "a")]);

      // On the test clock nothing ever times out: a close that waited for a
      // reader would never return.
      yield* close;

      yield* Effect.forkScoped(read);
      expect(yield* next).toMatchObject({ type: "harness.session" });
      expect(yield* next).toMatchObject({
        type: "harness.artifact",
        version: 1,
        reason: "final",
        files: [text("a.txt", "a")],
      });
    })
);

it.effect(
  "closing waits two seconds for a hub that stopped reading, and then goes on",
  () =>
    Effect.gen(function* () {
      const { change, close } = yield* start({ reader: "stalled" });
      yield* change([text("a.txt", "a")]);

      const closing = yield* Effect.forkChild(close);
      yield* TestClock.adjust("1999 millis");
      expect(closing.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust("1 millis");

      yield* Fiber.join(closing);
    })
);
