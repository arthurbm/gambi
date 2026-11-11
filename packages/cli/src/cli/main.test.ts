import { expect } from "bun:test";
import { join } from "node:path";
import { it } from "@gambi/testing/effect";
import { Effect } from "effect";

const ENTRYPOINT = join(import.meta.dir, "main.ts");

/** `gambi <args>` as a real process, with stdout and stderr on pipes. */
const spawnGambi = (args: readonly string[]) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      Bun.spawn([process.execPath, ENTRYPOINT, ...args], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      })
    ),
    (child) =>
      Effect.promise(async () => {
        child.kill("SIGKILL");
        await child.exited;
      })
  );

/** Reads `stream` line by line, without closing it between reads. */
const reading = (stream: ReadableStream<Uint8Array>) => {
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
    line: Effect.promise(async () => {
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

/** A loopback URL nothing listens on. */
const closedPort = Effect.promise(async () => {
  const server = Bun.serve({
    fetch: () => new Response(),
    hostname: "127.0.0.1",
    port: 0,
  });
  const url = `http://127.0.0.1:${server.port}`;
  await server.stop(true);
  return url;
});

// Live: these run the entrypoint as a subprocess, to cover what the command
// tests cannot see: the real stdout and stderr, the real exit code, signals.

it.live(
  "the process writes an error on stderr only and exits with its code",
  () =>
    Effect.gen(function* () {
      const hubUrl = yield* closedPort;
      const child = yield* spawnGambi(["room", "list", "--hub", hubUrl]);

      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          reading(child.stdout).rest,
          reading(child.stderr).rest,
          Effect.promise(() => child.exited),
        ],
        { concurrency: "unbounded" }
      );

      expect(exitCode).toBe(3);
      expect(stdout).toBe("");
      expect(JSON.parse(stderr).error.name).toBe("HubUnreachable");
    })
);

it.live(
  "SIGTERM stops hub serve cleanly, and a repeated signal changes nothing",
  () =>
    Effect.gen(function* () {
      const child = yield* spawnGambi([
        "hub",
        "serve",
        "--host",
        "127.0.0.1",
        "--port",
        "0",
      ]);
      const stdout = reading(child.stdout);
      const started = JSON.parse(yield* stdout.line);
      expect(started.type).toBe("started");

      // The npm wrapper relays the signal it receives, so one Ctrl+C reaches
      // the binary twice.
      child.kill("SIGTERM");
      child.kill("SIGTERM");

      expect(yield* Effect.promise(() => child.exited)).toBe(0);
      const events = (yield* stdout.rest)
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line).type);
      expect(events).toEqual(["signal_received", "stopped"]);
    })
);
