import { expect } from "bun:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "@gambi/testing/effect";
import { Effect } from "effect";

/**
 * The CLI (`cli/main.ts`) survives `bun build --compile`: `effect`,
 * `effect/cli`, `@effect/platform-bun` and the hub all run from one binary,
 * and that binary can replace itself with `self update`.
 */

const ENTRYPOINT = join(import.meta.dir, "cli", "main.ts");
const COMPILE_TIMEOUT_MS = 120_000;

const run = (cmd: string[], env: Record<string, string> = {}) =>
  Effect.promise(async () => {
    const child = Bun.spawn(cmd, {
      env: { ...process.env, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
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
      Bun.spawn(
        [binary, "hub", "serve", "--host", "127.0.0.1", "--port", "0"],
        {
          stdout: "pipe",
          stderr: "ignore",
        }
      )
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

/** A process of the binary, with its stdout on a pipe. Killed when the scope closes. */
const spawned = (cmd: string[]) =>
  Effect.acquireRelease(
    Effect.sync(() => Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" })),
    (child) =>
      Effect.promise(async () => {
        child.kill("SIGKILL");
        await child.exited;
      })
  );

/** Reads `stream` line by line, without closing it between reads. */
const linesOf = (stream: ReadableStream<Uint8Array>) => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  const fill = async () => {
    const { done, value } = await reader.read();
    buffered += done ? "" : decoder.decode(value, { stream: true });
    return !done;
  };
  return {
    /** The next line. Waits for it. */
    next: Effect.promise(async () => {
      while (!buffered.includes("\n") && (await fill())) {
        // Keep reading until a whole line is buffered.
      }
      const [line = "", ...rest] = buffered.split("\n");
      buffered = rest.join("\n");
      return line;
    }),
    /** Everything from here to the end of the stream. */
    rest: Effect.promise(async () => {
      while (await fill()) {
        // Keep reading until the stream ends.
      }
      return buffered;
    }),
  };
};

/** A release on a loopback port that serves `body` as every binary. */
const releaseServing = (body: string) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch: () => new Response(body),
      })
    ),
    (server) => Effect.promise(() => server.stop(true))
  ).pipe(Effect.map((server) => `http://127.0.0.1:${server.port}`));

// Live: it compiles and spawns a real binary.
it.live(
  "the compiled CLI serves a hub, creates a room, reports errors and updates itself",
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
      expect(busy.stderr).toContain(
        `Port ${started.data.port} is already in use`
      );

      // A harness participant hosted by the same binary. Its fake harness
      // is the binary itself, and the hub and the participant agree on the
      // version the binary was built with.
      const workspace = join(directory, "workspace");
      const joining = yield* spawned([
        binary,
        "participant",
        "join",
        "--harness",
        "fake",
        "--workspace",
        workspace,
        "--room",
        JSON.parse(created.stdout).data.room.code,
        "--participant-id",
        "arthur-1",
        "--no-specs",
        "--hub",
        hubUrl,
      ]);
      const joiningEvents = linesOf(joining.stdout);
      const harnessStarted = JSON.parse(yield* joiningEvents.next);
      expect(harnessStarted).toMatchObject({
        type: "harness_started",
        data: { harness: "fake", workspace },
      });
      expect(JSON.parse(yield* joiningEvents.next).type).toBe("registered");
      expect(JSON.parse(yield* joiningEvents.next)).toMatchObject({
        type: "tunnel_connected",
        data: { hubVersion: "9.9.9" },
      });
      joining.kill("SIGTERM");
      expect(yield* Effect.promise(() => joining.exited)).toBe(0);
      expect(
        (yield* joiningEvents.rest)
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line).type)
      ).toEqual(["leaving", "artifact_sent", "left"]);
      expect(() => process.kill(harnessStarted.data.pid, 0)).toThrow();

      hub.kill("SIGTERM");
      expect(yield* Effect.promise(() => hub.exited)).toBe(0);

      // Nothing listens there any more: a named error, not "Error: undefined" (#55).
      const unreachable = yield* run([binary, "room", "list", "--hub", hubUrl]);
      expect(unreachable.exitCode).toBe(3);
      expect(unreachable.stdout).toBe("");
      expect(JSON.parse(unreachable.stderr).error.name).toBe("HubUnreachable");

      // Last, because it replaces the binary: named `gambi` and outside any
      // package, it is a standalone install, and updates itself in place
      // from the release it is pointed at.
      const releaseUrl = yield* releaseServing("the next gambi");
      const installedAt = yield* Effect.promise(() => realpath(binary));
      const updated = yield* run([binary, "self", "update"], {
        GAMBI_UPDATE_BASE_URL: releaseUrl,
      });
      expect(updated.stderr).toBe("");
      expect(updated.exitCode).toBe(0);
      expect(JSON.parse(updated.stdout).data).toMatchObject({
        plan: { kind: "standalone", binaryPath: installedAt },
        result: { kind: "updated" },
      });
      expect(yield* Effect.promise(() => readFile(binary, "utf8"))).toBe(
        "the next gambi"
      );
    }),
  COMPILE_TIMEOUT_MS
);
