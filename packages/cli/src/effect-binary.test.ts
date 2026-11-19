import { expect } from "bun:test";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FAKE_MODEL,
  fakeProvider,
  openAiAnswer,
  openStream,
  sseEvent,
} from "@gambi/core/testing/provider";
import { makeManagementClient } from "@gambi/protocol";
import { it } from "@gambi/testing/effect";
import { Effect, Queue, Stream } from "effect";
import { FetchHttpClient } from "effect/http";

/**
 * The CLI (`cli/main.ts`) survives `bun build --compile`: `effect`,
 * `effect/cli`, `@effect/platform-bun` and the hub all run from one binary,
 * and that binary can replace itself with `self update`.
 */

const ENTRYPOINT = join(import.meta.dir, "cli", "main.ts");
const COMPILE_TIMEOUT_MS = 120_000;

const run = (cmd: string[], env: Record<string, string> = {}) =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      Bun.spawn(cmd, {
        env: { ...process.env, ...env },
        stdout: "pipe",
        stderr: "pipe",
      })
    ),
    (child) =>
      Effect.promise(async () => {
        const [stdout, stderr, exitCode] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        return { exitCode, stderr, stdout };
      }),
    (child) =>
      Effect.promise(async () => {
        child.kill("SIGKILL");
        await child.exited;
      })
  );

const temporaryDirectory = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "gambi-effect-binary-"))),
  (directory) =>
    Effect.promise(() => rm(directory, { force: true, recursive: true }))
);

/** A process of the binary, with its stdout on a pipe. Killed when the scope closes. */
const spawned = (cmd: string[]) =>
  Effect.acquireRelease(
    Effect.sync(() => Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" })),
    (child) =>
      Effect.gen(function* () {
        child.kill("SIGTERM");
        yield* Effect.promise(() => child.exited).pipe(
          Effect.timeoutOrElse({
            duration: "5 seconds",
            orElse: () =>
              Effect.promise(async () => {
                child.kill("SIGKILL");
                return await child.exited;
              }),
          })
        );
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
        fetch: (request) =>
          new URL(request.url).pathname.startsWith("/gambi-")
            ? new Response(body)
            : new Response(null, { status: 404 }),
      })
    ),
    (server) => Effect.promise(() => server.stop(true))
  ).pipe(Effect.map((server) => `http://127.0.0.1:${server.port}`));

// Live: it compiles and spawns a real binary.
it.live(
  "the compiled CLI routes streams, cancels generation, hosts a fake harness and updates itself",
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

      const hub = yield* spawned([
        binary,
        "hub",
        "serve",
        "--host",
        "127.0.0.1",
        "--port",
        "0",
      ]);
      const started = JSON.parse(yield* linesOf(hub.stdout).next);
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

      const roomCode: string = JSON.parse(created.stdout).data.room.code;
      const client = yield* makeManagementClient(hubUrl);

      // A port that is already taken names the port and is invalid usage (#54).
      const busy = yield* run([
        binary,
        "hub",
        "serve",
        "--host",
        "127.0.0.1",
        "--port",
        String(started.data.port),
        "--mdns",
      ]);
      expect(busy.exitCode).toBe(2);
      expect(busy.stdout).toBe("");
      expect(JSON.parse(busy.stderr).error).toMatchObject({
        name: "PortInUse",
        message: expect.stringContaining(
          `Port ${started.data.port} is already in use`
        ),
      });
      expect(busy.stderr).not.toContain("mDNS announcement published");

      const generating = yield* openStream();
      let answer = openAiAnswer;
      const provider = yield* fakeProvider({ answer: (call) => answer(call) });
      const endpoint = yield* spawned([
        binary,
        "participant",
        "join",
        "--room",
        roomCode,
        "--participant-id",
        "endpoint-1",
        "--model",
        FAKE_MODEL,
        "--endpoint",
        provider.url,
        "--no-specs",
        "--hub",
        hubUrl,
      ]);
      const lifecycle = linesOf(endpoint.stdout);
      expect(JSON.parse(yield* lifecycle.next).type).toBe("registered");
      expect(JSON.parse(yield* lifecycle.next).type).toBe("tunnel_connected");

      const inferenceEvents = yield* client.events
        .watch({ params: { code: roomCode } })
        .pipe(
          Stream.unwrap,
          Stream.filter(
            (event) =>
              event.type === "room.snapshot" ||
              event.type === "participant.busy" ||
              event.type === "llm.error" ||
              event.type === "participant.online"
          ),
          Stream.toQueue({ capacity: 16 })
        );
      expect(yield* Queue.take(inferenceEvents)).toMatchObject({
        type: "room.snapshot",
        participants: [{ id: "endpoint-1", status: "online" }],
      });
      const chat = (signal?: AbortSignal) =>
        Effect.promise(() =>
          fetch(`${hubUrl}/rooms/${roomCode}/v1/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "endpoint-1",
              stream: true,
              messages: [{ role: "user", content: "Oi" }],
            }),
            signal,
          })
        );
      const complete = yield* chat();
      expect(complete.status).toBe(200);
      expect(complete.headers.get("content-type")).toBe("text/event-stream");
      const body = yield* Effect.promise(() => complete.text());
      expect(body).toContain('"content":"Recife!"');
      expect(body.endsWith("data: [DONE]\n\n")).toBe(true);
      expect((yield* Queue.take(inferenceEvents)).type).toBe(
        "participant.busy"
      );
      expect((yield* Queue.take(inferenceEvents)).type).toBe(
        "participant.online"
      );

      answer = () => generating.response;
      yield* generating.send(sseEvent({ delta: "Olá" }));
      const consumer = new AbortController();
      const partial = yield* chat(consumer.signal);
      expect(partial.status).toBe(200);
      if (!partial.body) {
        throw new Error("Missing streaming body");
      }
      expect(yield* linesOf(partial.body).next).toBe('data: {"delta":"Olá"}');
      expect((yield* Queue.take(inferenceEvents)).type).toBe(
        "participant.busy"
      );
      const call = (yield* provider.calls).at(-1);
      if (!call) {
        throw new Error("The provider did not receive the request");
      }
      consumer.abort();
      yield* call.aborted;
      expect(yield* Queue.take(inferenceEvents)).toMatchObject({
        type: "llm.error",
        participantId: "endpoint-1",
        stage: "stream",
        code: "request_cancelled",
      });
      expect(yield* Queue.take(inferenceEvents)).toMatchObject({
        type: "participant.online",
        participant: { id: "endpoint-1", status: "online" },
      });
      endpoint.kill("SIGTERM");
      expect(yield* Effect.promise(() => endpoint.exited)).toBe(0);

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
        roomCode,
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
      const params = { code: roomCode, id: "arthur-1" };
      const attached = yield* client.harness.events({ params }).pipe(
        Stream.unwrap,
        Stream.filter(
          (event) =>
            event.type === "harness.connected" ||
            event.type === "harness.message"
        ),
        Stream.toQueue({ capacity: 8 })
      );
      expect(yield* Queue.take(attached)).toEqual({
        type: "harness.connected",
      });
      const sessionId: string = harnessStarted.data.sessionId;
      yield* client.harness.send({
        params,
        payload: {
          sessionId,
          message: {
            jsonrpc: "2.0",
            id: 17,
            method: "session/prompt",
            params: {
              sessionId,
              prompt: [{ type: "text", text: "Oi, Gambi" }],
            },
          },
        },
      });
      expect(yield* Queue.take(attached)).toMatchObject({
        type: "harness.message",
        sessionId,
        message: {
          method: "session/update",
          params: {
            sessionId,
            update: {
              content: { type: "text", text: "Fake ACP response: Oi, Gambi" },
            },
          },
        },
      });
      expect(yield* Queue.take(attached)).toMatchObject({
        type: "harness.message",
        sessionId,
        message: { jsonrpc: "2.0", id: 17, result: { stopReason: "end_turn" } },
      });
      joining.kill("SIGTERM");
      expect(yield* Effect.promise(() => joining.exited)).toBe(0);
      const shutdown = (yield* joiningEvents.rest)
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
        // The prompt's file change can settle while the participant is leaving.
        .filter(
          (event) =>
            !(event.type === "artifact_sent" && event.data.reason === "watch")
        );
      expect(shutdown).toMatchObject([
        { type: "leaving" },
        { type: "artifact_sent", data: { reason: "final" } },
        { type: "left" },
      ]);
      expect(() => process.kill(harnessStarted.data.pid, 0)).toThrow();

      hub.kill("SIGTERM");
      expect(yield* Effect.promise(() => hub.exited)).toBe(0);

      // Nothing listens there any more: a named connectivity error.
      const unreachable = yield* run([binary, "room", "list", "--hub", hubUrl]);
      expect(unreachable.exitCode).toBe(3);
      expect(unreachable.stdout).toBe("");
      expect(JSON.parse(unreachable.stderr).error.name).toBe("HubUnreachable");

      // Last, because it replaces the binary: named `gambi` and outside any
      // package, it is a standalone install, and updates itself in place
      // from the release it is pointed at.
      const releaseUrl = yield* releaseServing("the next gambi");
      // Another HTTP server answers, but its response is outside the hub contract (#55).
      const wrongServer = yield* run([
        binary,
        "room",
        "list",
        "--hub",
        releaseUrl,
      ]);
      expect(wrongServer.exitCode).toBe(3);
      expect(wrongServer.stdout).toBe("");
      expect(JSON.parse(wrongServer.stderr).error).toMatchObject({
        name: "NotAHub",
        message: expect.stringContaining(
          "did not answer like a Gambi hub (HTTP 404)"
        ),
      });

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
    }).pipe(
      Effect.provide(FetchHttpClient.layer),
      Effect.timeout("90 seconds")
    ),
  COMPILE_TIMEOUT_MS
);
