import { expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub, managementClient } from "@gambi/core/testing/hub";
import { FAKE_MODEL, fakeProvider } from "@gambi/core/testing/provider";
import { it } from "@gambi/testing/effect";
import { Effect } from "effect";

const ENTRYPOINT = join(import.meta.dir, "main.ts");

/** `gambi <args>` as a real process, with stdout and stderr on pipes. */
const spawnGambi = (
  args: readonly string[],
  stdin: "ignore" | "pipe" = "ignore"
) =>
  Effect.acquireRelease(
    Effect.sync(() =>
      Bun.spawn([process.execPath, ENTRYPOINT, ...args], {
        stdin,
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

const temporaryDirectory = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "gambi-cli-main-"))),
  (directory) =>
    Effect.promise(() => rm(directory, { force: true, recursive: true }))
);

/** A room on the hub of the test, and how its participants look from outside. */
const newRoom = Effect.gen(function* () {
  const hub = yield* Hub;
  const client = yield* managementClient;
  const { room } = yield* client.rooms.create({ payload: { name: "Frevo" } });
  return {
    hubUrl: hub.url,
    roomCode: room.code,
    participants: client.participants.list({ params: { code: room.code } }),
  };
});

const typesOf = (lines: string): readonly string[] =>
  lines
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line).type);

/** Whether a process with that pid is still there. */
const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

it.live.each(["SIGINT", "SIGTERM"] as const)(
  "%s takes a participant that shares a model endpoint out of its room, and the process exits with 0",
  (signal) =>
    Effect.gen(function* () {
      const { hubUrl, participants, roomCode } = yield* newRoom;
      const provider = yield* fakeProvider();
      const child = yield* spawnGambi([
        "participant",
        "join",
        "--room",
        roomCode,
        "--participant-id",
        "arthur-1",
        "--model",
        FAKE_MODEL,
        "--endpoint",
        provider.url,
        "--no-specs",
        "--hub",
        hubUrl,
      ]);
      const stdout = reading(child.stdout);
      // biome-ignore lint/suspicious/noMisplacedAssertion: this is the body of a test of `it.live.each`.
      expect(typesOf(`${yield* stdout.line}\n${yield* stdout.line}`)).toEqual([
        "registered",
        "tunnel_connected",
      ]);

      // The npm wrapper relays the signal it receives.
      child.kill(signal);
      child.kill(signal);

      // biome-ignore lint/suspicious/noMisplacedAssertion: this is the body of a test of `it.live.each`.
      expect(yield* Effect.promise(() => child.exited)).toBe(0);
      // biome-ignore lint/suspicious/noMisplacedAssertion: this is the body of a test of `it.live.each`.
      expect(typesOf(yield* stdout.rest)).toEqual(["leaving", "left"]);
      // biome-ignore lint/suspicious/noMisplacedAssertion: this is the body of a test of `it.live.each`.
      expect(yield* participants).toEqual([]);
    }).pipe(Effect.provide(layerHub())),
  15_000
);

it.live.each(["SIGINT", "SIGTERM"] as const)(
  "%s stops a harness participant: its harness is gone, it left the room and the process exits with 0",
  (signal) =>
    Effect.gen(function* () {
      const { hubUrl, participants, roomCode } = yield* newRoom;
      const child = yield* spawnGambi([
        "participant",
        "join",
        "--harness",
        "fake",
        "--workspace",
        yield* temporaryDirectory,
        "--room",
        roomCode,
        "--participant-id",
        "arthur-1",
        "--no-specs",
        "--hub",
        hubUrl,
      ]);
      const stdout = reading(child.stdout);
      const started = JSON.parse(yield* stdout.line);
      const harnessPid: number = started.data.pid;
      // biome-ignore lint/suspicious/noMisplacedAssertion: this is the body of a test of `it.live.each`.
      expect(started.type).toBe("harness_started");
      // biome-ignore lint/suspicious/noMisplacedAssertion: this is the body of a test of `it.live.each`.
      expect(isRunning(harnessPid)).toBe(true);
      yield* stdout.line;
      yield* stdout.line;

      child.kill(signal);

      // biome-ignore lint/suspicious/noMisplacedAssertion: this is the body of a test of `it.live.each`.
      expect(yield* Effect.promise(() => child.exited)).toBe(0);
      // biome-ignore lint/suspicious/noMisplacedAssertion: this is the body of a test of `it.live.each`.
      expect(typesOf(yield* stdout.rest)).toEqual([
        "leaving",
        "artifact_sent",
        "left",
      ]);
      // biome-ignore lint/suspicious/noMisplacedAssertion: this is the body of a test of `it.live.each`.
      expect(isRunning(harnessPid)).toBe(false);
      // biome-ignore lint/suspicious/noMisplacedAssertion: this is the body of a test of `it.live.each`.
      expect(yield* participants).toEqual([]);
    }).pipe(Effect.provide(layerHub())),
  15_000
);

it.live(
  "Ctrl+C ends events watch with 0",
  () =>
    Effect.gen(function* () {
      const { hubUrl, roomCode } = yield* newRoom;
      const child = yield* spawnGambi([
        "events",
        "watch",
        "--room",
        roomCode,
        "--hub",
        hubUrl,
      ]);
      const stdout = reading(child.stdout);
      expect(JSON.parse(yield* stdout.line).type).toBe("room.snapshot");

      child.kill("SIGINT");

      expect(yield* Effect.promise(() => child.exited)).toBe(0);
      expect(yield* stdout.rest).toBe("");
    }).pipe(Effect.provide(layerHub())),
  15_000
);

it.live(
  "started as __fake-acp-agent, the process is the fake harness and speaks ACP on its stdio",
  () =>
    Effect.gen(function* () {
      const child = yield* spawnGambi(["__fake-acp-agent"], "pipe");
      const stdout = reading(child.stdout);

      child.stdin?.write(
        `${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: 1 } })}\n`
      );
      child.stdin?.flush();

      expect(JSON.parse(yield* stdout.line)).toMatchObject({
        id: 1,
        result: { protocolVersion: 1, agentInfo: { name: "gambi-fake-acp" } },
      });
      child.stdin?.end();
      expect(yield* Effect.promise(() => child.exited)).toBe(0);
    }),
  15_000
);
