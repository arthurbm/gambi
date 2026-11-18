import { expect } from "bun:test";
import { chmod, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub, managementClient, watchRoom } from "@gambi/core/testing/hub";
import type { HarnessAttachEvent } from "@gambi/protocol";
import { layer } from "@gambi/testing/effect";
import { Effect, Queue, Stream } from "effect";
import {
  realSpawner,
  runCommand,
  type SpawnedCommand,
  type SubprocessScript,
  spawnerThat,
  startCommand,
} from "./testing.ts";

const temporaryDirectory = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "gambi-cli-harness-"))),
  (directory) =>
    Effect.promise(() => rm(directory, { force: true, recursive: true }))
);

const createRoom = (name: string) =>
  Effect.gen(function* () {
    const client = yield* managementClient;
    return (yield* client.rooms.create({ payload: { name } })).room;
  });

const participantsOf = (roomCode: string) =>
  Effect.gen(function* () {
    const client = yield* managementClient;
    return yield* client.participants.list({ params: { code: roomCode } });
  });

/** Whether a process with that pid is still there. */
const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * A folder to put on `PATH`, holding an executable file for each command in
 * `installed`. Nothing runs them: the test plays what they answer.
 */
const machineWith = (installed: readonly string[]) =>
  Effect.gen(function* () {
    const bin = yield* temporaryDirectory;
    yield* Effect.promise(async () => {
      for (const command of installed) {
        const file = join(bin, command);
        await writeFile(file, "");
        await chmod(file, 0o755);
      }
    });
    return bin;
  });

/** Attaches a management client to the harness participant `arthur-1`. */
const attach = (roomCode: string) =>
  Effect.gen(function* () {
    const client = yield* managementClient;
    const received = yield* Queue.unbounded<HarnessAttachEvent>();
    yield* client.harness
      .events({ params: { code: roomCode, id: "arthur-1" } })
      .pipe(
        Stream.unwrap,
        Stream.runForEach((event) => Queue.offer(received, event)),
        Effect.orDie,
        Effect.forkScoped
      );
    const first = yield* Queue.take(received);
    return { first, next: Queue.take(received) };
  });

const joinWithHarness = (
  harness: string,
  hubUrl: string,
  roomCode: string,
  ...more: readonly string[]
) => [
  "participant",
  "join",
  "--harness",
  harness,
  "--room",
  roomCode,
  "--participant-id",
  "arthur-1",
  "--no-specs",
  "--hub",
  hubUrl,
  ...more,
];

const errorOf = (stderr: string) =>
  JSON.parse(stderr.trim().split("\n").at(-1) ?? "{}").error;

layer(layerHub(), { excludeTestServices: true })(
  "participant join with a harness",
  (it) => {
    it.effect(
      "runs the fake harness in the Workspace it was given, joins, sends a last artifact and leaves nothing running",
      () =>
        Effect.gen(function* () {
          const hub = yield* Hub;
          const room = yield* createRoom("Maracatu");
          const workspace = yield* temporaryDirectory;
          yield* Effect.promise(() =>
            writeFile(join(workspace, "notas.md"), "# Loa\n")
          );

          const joining = yield* startCommand(
            joinWithHarness(
              "fake",
              hub.url,
              room.code,
              "--workspace",
              workspace
            ),
            { spawner: realSpawner }
          );

          const started = yield* joining.nextEvent;
          expect(started).toMatchObject({
            type: "harness_started",
            data: {
              roomCode: room.code,
              participantId: "arthur-1",
              harness: "fake",
              workspace,
            },
          });
          const pid = Number(started.data.pid);
          expect(isRunning(pid)).toBe(true);
          expect(yield* joining.nextEvent).toMatchObject({
            type: "registered",
            data: {
              participant: {
                id: "arthur-1",
                nickname: "fake@arthur",
                model: "fake",
                harness: { id: "fake" },
              },
            },
          });
          expect((yield* joining.nextEvent).type).toBe("tunnel_connected");
          // The Workspace got its metadata file and nothing else.
          expect(
            (yield* Effect.promise(() => readdir(workspace))).sort()
          ).toEqual([".gambi.json", "notas.md"]);

          const client = yield* attach(room.code);
          expect(client.first.type).toBe("harness.connected");
          const watch = yield* watchRoom(room.code);

          yield* joining.signal("SIGTERM");
          expect((yield* joining.nextEvent).type).toBe("leaving");
          expect(yield* joining.nextEvent).toMatchObject({
            type: "artifact_sent",
            data: {
              roomCode: room.code,
              participantId: "arthur-1",
              sessionId: started.data.sessionId,
              version: 1,
              reason: "final",
              fileCount: 1,
            },
          });
          expect(yield* joining.nextEvent).toMatchObject({
            type: "left",
            data: { reason: "stopped", removed: true },
          });
          expect((yield* joining.result).exitCode).toBe(0);

          // The attached client read the last artifact before the end.
          let event = yield* client.next;
          while (event.type !== "harness.artifact") {
            event = yield* client.next;
          }
          expect(event).toMatchObject({
            reason: "final",
            files: [{ path: "notas.md", encoding: "utf8", content: "# Loa\n" }],
          });
          expect(isRunning(pid)).toBe(false);
          expect(yield* participantsOf(room.code)).toEqual([]);
          // The tunnel closed first, with the artifact through it; then the
          // participant left the room.
          expect((yield* watch.next).type).toBe("participant.offline");
          expect(yield* watch.next).toMatchObject({
            type: "participant.removed",
            reason: "left",
          });
        }),
      15_000
    );

    it.effect(
      "--model names the model the harness runs on, and --nickname the participant",
      () =>
        Effect.gen(function* () {
          const hub = yield* Hub;
          const room = yield* createRoom("Com modelo");
          const workspace = yield* temporaryDirectory;

          const joining = yield* startCommand(
            joinWithHarness(
              "fake",
              hub.url,
              room.code,
              "--workspace",
              workspace,
              "--model",
              "sonnet",
              "--nickname",
              "Arthur"
            ),
            { spawner: realSpawner }
          );
          yield* joining.nextEvent;

          expect((yield* joining.nextEvent).data.participant).toMatchObject({
            nickname: "Arthur",
            model: "sonnet",
            harness: { id: "fake", model: "sonnet" },
          });
          yield* joining.signal("SIGINT");
          expect((yield* joining.result).exitCode).toBe(0);
        }),
      15_000
    );

    it.effect.each([
      {
        harness: "opencode",
        message:
          "OpenCode is not installed. Install it from https://opencode.ai/docs and retry.",
      },
      {
        harness: "claude-code",
        message:
          "The Claude Code ACP adapter is not installed. Run `npm install -g @agentclientprotocol/claude-agent-acp` and retry.",
      },
      {
        harness: "codex",
        message:
          "The Codex ACP adapter is not installed. Run `npm install -g @agentclientprotocol/codex-acp` and retry.",
      },
    ])(
      "$harness that is not installed says how to install it",
      ({ harness, message }) =>
        Effect.gen(function* () {
          const hub = yield* Hub;
          const room = yield* createRoom("Sem harness");

          const result = yield* runCommand(
            joinWithHarness(harness, hub.url, room.code),
            { env: { PATH: yield* machineWith([]) } }
          );

          // biome-ignore lint/suspicious/noMisplacedAssertion: this is the body of a test of `it.effect.each`.
          expect(result).toMatchObject({ exitCode: 3, stdout: "" });
          // biome-ignore lint/suspicious/noMisplacedAssertion: this is the body of a test of `it.effect.each`.
          expect(errorOf(result.stderr)).toMatchObject({
            name: "HarnessNotReady",
            message,
            details: { harness },
            exitCode: 3,
          });
          // biome-ignore lint/suspicious/noMisplacedAssertion: this is the body of a test of `it.effect.each`.
          expect(yield* participantsOf(room.code)).toEqual([]);
        })
    );

    it.effect.each([
      {
        harness: "opencode",
        installed: ["opencode"],
        status: { stdout: "No credentials\n" },
        message:
          "OpenCode has no detected credentials. Run `opencode auth login` (or configure a provider API key) and retry.",
      },
      {
        harness: "claude-code",
        installed: ["claude-agent-acp", "claude"],
        status: { stdout: JSON.stringify({ loggedIn: false }) },
        message:
          "Claude Code has no detected local login. Run `claude auth login` and retry.",
      },
      {
        harness: "codex",
        installed: ["codex-acp", "codex"],
        status: { exitCode: 1, stderr: "Not logged in\n" },
        message:
          "Codex has no detected local login. Run `codex login` and retry. (Not logged in)",
      },
    ])(
      "$harness that is not logged in says which login to run",
      ({ harness, installed, message, status }) =>
        Effect.gen(function* () {
          const hub = yield* Hub;
          const room = yield* createRoom("Sem login");

          const result = yield* runCommand(
            joinWithHarness(harness, hub.url, room.code),
            {
              env: { PATH: yield* machineWith(installed) },
              spawner: spawnerThat((): SubprocessScript => status),
            }
          );

          // biome-ignore lint/suspicious/noMisplacedAssertion: this is the body of a test of `it.effect.each`.
          expect(result).toMatchObject({ exitCode: 3, stdout: "" });
          // biome-ignore lint/suspicious/noMisplacedAssertion: this is the body of a test of `it.effect.each`.
          expect(errorOf(result.stderr)).toMatchObject({
            name: "HarnessNotReady",
            message,
            details: { harness, problem: "notAuthenticated" },
          });
          // biome-ignore lint/suspicious/noMisplacedAssertion: this is the body of a test of `it.effect.each`.
          expect(yield* participantsOf(room.code)).toEqual([]);
        })
    );

    it.effect.each([
      {
        harness: "opencode",
        installed: ["opencode"],
        status: { stdout: "●  Anthropic  oauth\n" },
        starts: ["opencode", "acp"],
      },
      {
        harness: "claude-code",
        installed: ["claude-agent-acp", "claude"],
        status: { stdout: JSON.stringify({ loggedIn: true }) },
        starts: ["claude-agent-acp"],
      },
      {
        harness: "codex",
        installed: ["codex-acp", "codex"],
        status: { stdout: "Logged in using ChatGPT\n" },
        starts: ["codex-acp"],
      },
    ])(
      "$harness that is installed and logged in is started with its ACP command, in the Workspace",
      ({ harness, installed, starts, status }) =>
        Effect.gen(function* () {
          const hub = yield* Hub;
          const room = yield* createRoom("Pronto");
          const bin = yield* machineWith(installed);
          const workspace = yield* temporaryDirectory;
          const [command = "", ...args] = starts;
          const spawned: SpawnedCommand[] = [];
          const options = {
            env: { PATH: bin },
            // The status command answers; the harness itself is a process
            // that exits at once, which no test here needs to speak ACP.
            spawner: spawnerThat((spawn): SubprocessScript => {
              spawned.push(spawn);
              return status;
            }),
          };

          const preview = yield* runCommand(
            joinWithHarness(
              harness,
              hub.url,
              room.code,
              "--workspace",
              workspace,
              "--dry-run"
            ),
            options
          );
          // biome-ignore lint/suspicious/noMisplacedAssertion: this is the body of a test of `it.effect.each`.
          expect(preview.exitCode).toBe(0);
          // biome-ignore lint/suspicious/noMisplacedAssertion: this is the body of a test of `it.effect.each`.
          expect(JSON.parse(preview.stdout).data).toMatchObject({
            roomCode: room.code,
            participantId: "arthur-1",
            workspace,
            harness: { id: harness, command: join(bin, command), args },
            profile: {
              nickname: `${harness}@arthur`,
              model: harness,
              harness: { id: harness },
            },
          });
          // biome-ignore lint/suspicious/noMisplacedAssertion: this is the body of a test of `it.effect.each`.
          expect(yield* Effect.promise(() => readdir(workspace))).toEqual([]);

          spawned.length = 0;
          const result = yield* runCommand(
            joinWithHarness(
              harness,
              hub.url,
              room.code,
              "--workspace",
              workspace
            ),
            options
          );
          // biome-ignore lint/suspicious/noMisplacedAssertion: this is the body of a test of `it.effect.each`.
          expect(spawned.at(-1)).toMatchObject({
            command: join(bin, command),
            args,
            options: { cwd: workspace },
          });
          // The scripted process spoke no ACP: the join fails with the
          // harness's failure, and nobody is left in the room.
          // biome-ignore lint/suspicious/noMisplacedAssertion: this is the body of a test of `it.effect.each`.
          expect(result.exitCode).toBe(3);
          // biome-ignore lint/suspicious/noMisplacedAssertion: this is the body of a test of `it.effect.each`.
          expect(errorOf(result.stderr).name).toBe("HarnessFailed");
          // biome-ignore lint/suspicious/noMisplacedAssertion: this is the body of a test of `it.effect.each`.
          expect(yield* participantsOf(room.code)).toEqual([]);
        })
    );

    it.effect(
      "a harness that ends by itself ends the stay as a failure, and the participant leaves the room",
      () =>
        Effect.gen(function* () {
          const hub = yield* Hub;
          const room = yield* createRoom("Harness que morre");
          const workspace = yield* temporaryDirectory;
          const joining = yield* startCommand(
            joinWithHarness(
              "fake",
              hub.url,
              room.code,
              "--workspace",
              workspace
            ),
            { spawner: realSpawner }
          );
          const pid = Number((yield* joining.nextEvent).data.pid);
          yield* joining.nextEvent;
          yield* joining.nextEvent;

          process.kill(pid, "SIGKILL");

          expect(yield* joining.nextEvent).toMatchObject({
            type: "harness_exited",
            data: {
              roomCode: room.code,
              participantId: "arthur-1",
              harness: "fake",
            },
          });
          // The harness is gone, and the Workspace still has its last state.
          expect((yield* joining.nextEvent).type).toBe("artifact_sent");
          expect(yield* joining.nextEvent).toMatchObject({
            type: "left",
            data: { reason: "harnessExited", removed: true },
          });
          const result = yield* joining.result;
          expect(result.exitCode).toBe(3);
          expect(errorOf(result.stderr)).toMatchObject({
            name: "HarnessFailed",
            details: { reason: "exited" },
            exitCode: 3,
          });
          expect(yield* participantsOf(room.code)).toEqual([]);
        }),
      15_000
    );

    it.effect(
      "without --workspace the harness runs in a folder of its own under ~/.gambi",
      () =>
        Effect.gen(function* () {
          const hub = yield* Hub;

          const result = yield* runCommand(
            joinWithHarness("fake", hub.url, "ABC123", "--dry-run")
          );

          expect(result.exitCode).toBe(0);
          expect(JSON.parse(result.stdout).data.workspace).toBe(
            join(homedir(), ".gambi", "workspaces", "ABC123", "arthur-1")
          );
        })
    );

    it.effect("a harness takes no provider flags", () =>
      Effect.gen(function* () {
        const hub = yield* Hub;

        const result = yield* runCommand(
          joinWithHarness(
            "fake",
            hub.url,
            "ABC123",
            "--endpoint",
            "http://localhost:11434",
            "--header",
            "Authorization=Bearer x"
          )
        );

        expect(result).toMatchObject({ exitCode: 2, stdout: "" });
        expect(errorOf(result.stderr)).toMatchObject({
          name: "FlagsDoNotCombine",
          message:
            "--endpoint, --header cannot be used with --harness: the credentials of a harness stay in the harness.",
        });
      })
    );

    it.effect("--workspace without --harness is invalid usage", () =>
      Effect.gen(function* () {
        const hub = yield* Hub;

        const result = yield* runCommand([
          "participant",
          "join",
          "--room",
          "ABC123",
          "--participant-id",
          "arthur-1",
          "--model",
          "llama3",
          "--workspace",
          "/tmp/qualquer",
          "--hub",
          hub.url,
        ]);

        expect(result).toMatchObject({ exitCode: 2, stdout: "" });
        expect(errorOf(result.stderr)).toMatchObject({
          name: "FlagsDoNotCombine",
          message:
            "--workspace cannot be used without --harness: a participant that shares a model endpoint has no Workspace.",
        });
      })
    );

    it.effect("pi is not a harness the CLI knows", () =>
      Effect.gen(function* () {
        const hub = yield* Hub;

        const result = yield* runCommand(
          joinWithHarness("pi", hub.url, "ABC123")
        );

        expect(result).toMatchObject({ exitCode: 2, stdout: "" });
        expect(errorOf(result.stderr)).toMatchObject({
          name: "InvalidValue",
          details: { option: "harness", value: "pi" },
        });
      })
    );
  }
);
