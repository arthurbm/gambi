import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "@gambi/testing/effect";
import { Effect } from "effect";

const ENTRYPOINT = join(import.meta.dir, "effect-smoke", "main.ts");
const COMPILE_TIMEOUT_MS = 120_000;

const run = (cmd: string[]) =>
  Effect.promise(async () => {
    const child = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    return { exitCode, stderr, stdout };
  });

const temporaryDirectory = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "gambi-effect-binary-"))),
  (directory) =>
    Effect.promise(() => rm(directory, { force: true, recursive: true }))
);

// Live: it compiles and spawns a real binary.
it.live(
  "a compiled binary that imports effect builds and runs",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectory;
      const binary = join(directory, "effect-smoke");

      const build = yield* run([
        process.execPath,
        "build",
        ENTRYPOINT,
        "--compile",
        `--outfile=${binary}`,
      ]);
      expect(build).toMatchObject({ exitCode: 0 });

      const ok = yield* run([binary]);
      expect(ok.exitCode).toBe(0);
      expect(JSON.parse(ok.stdout)).toEqual({
        greeting: "hello from effect",
        runtime: "bun",
      });

      const failed = yield* run([binary, "--fail"]);
      expect(failed.exitCode).toBe(1);
    }),
  COMPILE_TIMEOUT_MS
);
