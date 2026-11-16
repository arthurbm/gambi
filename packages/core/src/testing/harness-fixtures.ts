/**
 * Harnesses for tests, run as real subprocesses. None of them calls a model.
 * The well-behaved one is the `fake` harness (`fakeHarnessCommand` in
 * `../harness/adapters.ts`); the ones here misbehave on purpose.
 */
import { fileURLToPath } from "node:url";
import { Effect, FileSystem, Path, type Scope } from "effect";
import type { HarnessCommand } from "../harness/adapters.ts";

/**
 * How a fixture harness misbehaves:
 *
 * - `recording`: appends every line it receives to the file at `path`.
 * - `acp-v2`: answers `initialize` with ACP version 2.
 * - `silent`: reads and never answers.
 * - `crashes-on-prompt`: exits with code 7 on the first `session/prompt`.
 * - `with-child`: starts a process of its own that outlives a plain exit.
 * - `stubborn`: ignores SIGTERM and SIGINT, and starts a process that
 *   ignores them too.
 */
export type FixtureMode =
  | "recording"
  | "acp-v2"
  | "silent"
  | "crashes-on-prompt"
  | "with-child"
  | "stubborn";

/**
 * The command of a fixture harness. `path` is the file a `recording` one
 * writes to; for the others it is the `path` of `nothingHoldsOpen`.
 */
export const fixtureHarness = (
  mode: FixtureMode,
  path?: string
): HarnessCommand => ({
  harness: "fake",
  command: process.execPath,
  args: [
    fileURLToPath(new URL("./fixture-acp-agent.ts", import.meta.url)),
    mode,
    ...(path === undefined ? [] : [path]),
  ],
});

/**
 * A way to learn, without polling, that a harness and every process it
 * started are gone, zombies included. `path` is a FIFO the fixture harness
 * and its children hold open for writing; `released` completes when the last
 * of them let go of it, which a process only does by exiting.
 *
 * Give `path` to exactly one fixture that starts: `released` waits for the
 * first writer to arrive.
 */
export const nothingHoldsOpen: Effect.Effect<
  { readonly path: string; readonly released: Effect.Effect<void> },
  never,
  FileSystem.FileSystem | Path.Path | Scope.Scope
> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* Effect.orDie(
    fs.makeTempDirectoryScoped({ prefix: "gambi-held-" })
  );
  const fifo = path.join(directory, "held");
  Bun.spawnSync(["mkfifo", fifo]);
  // `cat` reads until every writer closed the FIFO, then exits.
  const reader = Bun.spawn(["cat", fifo], { stdout: "ignore" });
  yield* Effect.addFinalizer(() => Effect.sync(() => reader.kill()));
  return {
    path: fifo,
    released: Effect.asVoid(Effect.promise(() => reader.exited)),
  };
});
