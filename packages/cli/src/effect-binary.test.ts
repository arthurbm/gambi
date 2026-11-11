import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "@gambi/testing/effect";
import { Effect } from "effect";

/**
 * The new CLI (`cli/main.ts`) survives `bun build --compile`: `effect`,
 * `effect/cli`, `@effect/platform-bun` and the hub all run from one binary.
 */

const ENTRYPOINT = join(import.meta.dir, "cli", "main.ts");
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

/** `hub serve` from the binary, on a free port. Killed when the scope closes. */
const servingHub = (binary: string) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      Bun.spawn([binary, "hub", "serve", "--host", "127.0.0.1", "--port", "0"], {
        stdout: "pipe",
        stderr: "ignore",
      })
    ),
    (child) =>
      Effect.promise(async () => {
        child.kill("SIGKILL");
        await child.exited;
      })
  );

const firstEvent = (stdout: ReadableStream<Uint8Array>) =>
  Effect.promise(async () => {
    const reader = stdout.getReader();
    const decoder = new TextDecoder();
    let text = "";
    while (!text.includes("\n")) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
    reader.releaseLock();
    return JSON.parse(text.split("\n")[0] ?? "");
  });

// Live: it compiles and spawns a real binary.
it.live(
  "the compiled CLI serves a hub, creates a room and reports errors",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectory;
      const binary = join(directory, "gambi");

      const build = yield* run([
        process.execPath,
        "build",
        ENTRYPOINT,
        "--compile",
        "--define",
        'process.env.GAMBI_CLI_VERSION="9.9.9"',
        `--outfile=${binary}`,
      ]);
      expect(build).toMatchObject({ exitCode: 0 });

      expect(yield* run([binary, "--version"])).toEqual({
        exitCode: 0,
        stderr: "",
        stdout: "gambi v9.9.9\n",
      });

      const hub = yield* servingHub(binary);
      const started = yield* firstEvent(hub.stdout);
      expect(started.type).toBe("started");
      const hubUrl: string = started.data.hubUrl;

      const created = yield* run([
        binary,
        "room",
        "create",
        "--name",
        "Compilada",
        "--hub",
        hubUrl,
      ]);
      expect(created.exitCode).toBe(0);
      expect(JSON.parse(created.stdout).data.room.name).toBe("Compilada");

      // A port that is already taken names the port and is invalid usage (#54).
      const busy = yield* run([
        binary,
        "hub",
        "serve",
        "--host",
        "127.0.0.1",
        "--port",
        String(started.data.port),
      ]);
      expect(busy.exitCode).toBe(2);
      expect(busy.stdout).toBe("");
      expect(busy.stderr).toContain(`Port ${started.data.port} is already in use`);

      hub.kill("SIGTERM");
      expect(yield* Effect.promise(() => hub.exited)).toBe(0);

      // Nothing listens there any more: a named error, not "Error: undefined" (#55).
      const unreachable = yield* run([binary, "room", "list", "--hub", hubUrl]);
      expect(unreachable.exitCode).toBe(3);
      expect(unreachable.stdout).toBe("");
      expect(JSON.parse(unreachable.stderr).error.name).toBe("HubUnreachable");
    }),
  COMPILE_TIMEOUT_MS
);
