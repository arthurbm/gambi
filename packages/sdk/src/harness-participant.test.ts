import { expect } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub } from "@gambi/core/testing/hub";
import { linkToHub } from "@gambi/core/testing/hub-link";
import { layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { createClient } from "./client.ts";
import { ClientError } from "./client-error.ts";
import {
  type ArtifactLifecycleEvent,
  createHarnessParticipantSession,
  createLocalDirectoryWorkspace,
  createParticipantSession,
  type HarnessParticipantSessionOptions,
  type LogEntry,
  ParticipantError,
  type Workspace,
  type WorkspaceContext,
} from "./participant.ts";
import type { HarnessAttachEvent } from "./types.ts";

/** A room of the hub of the block, and the management client that made it. */
const frevo = Effect.gen(function* () {
  const hub = yield* Hub;
  const client = createClient({ hubUrl: hub.url });
  yield* Effect.addFinalizer(() => Effect.promise(() => client.close()));
  const { room } = yield* Effect.promise(() =>
    client.rooms.create({ name: "Frevo" })
  );
  return { client, hubUrl: hub.url, roomCode: room.code };
});

/** An empty folder, removed when the test ends. */
const emptyFolder = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), "gambi-sdk-workspace-"))),
  (folder) => Effect.promise(() => rm(folder, { force: true, recursive: true }))
);

/** A harness participant session, stopped when the test ends if it did not leave. */
const hosted = (options: HarnessParticipantSessionOptions) =>
  Effect.acquireRelease(
    Effect.promise(() => createHarnessParticipantSession(options)),
    (session) => Effect.promise(() => session.stop())
  );

/** Whether a process with this id is running. */
const isRunning = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * A client attached to a harness participant. `until` reads its events up to
 * the first one that satisfies `seen`, and answers that one.
 */
const attached = (
  client: ReturnType<typeof createClient>,
  roomCode: string,
  participantId: string
) => {
  const events = client.harness
    .attach(roomCode, participantId)
    [Symbol.asyncIterator]();
  return {
    until: <Event extends HarnessAttachEvent>(
      seen: (event: HarnessAttachEvent) => event is Event
    ) =>
      Effect.promise(async (): Promise<Event> => {
        for (;;) {
          const result = await events.next();
          if (result.done === true) {
            throw new Error("The attach ended.");
          }
          if (seen(result.value)) {
            return result.value;
          }
        }
      }),
  };
};

const ofType =
  <Type extends HarnessAttachEvent["type"]>(type: Type) =>
  (
    event: HarnessAttachEvent
  ): event is Extract<HarnessAttachEvent, { type: Type }> =>
    event.type === type;

/** The `ClientError` a call rejects with. Any other outcome fails the test. */
const rejection = (call: () => Promise<unknown>) =>
  Effect.promise(() =>
    call().then(
      (value): ClientError => {
        throw new Error(`Expected a rejection, got ${JSON.stringify(value)}`);
      },
      (error: unknown): ClientError => {
        if (error instanceof ClientError) {
          return error;
        }
        throw error;
      }
    )
  );

layer(layerHub(), { excludeTestServices: true })(
  "harness participant session",
  (it) => {
    it.effect(
      "joins a room with the fake harness running in its Workspace, and leaving stops it",
      () =>
        Effect.gen(function* () {
          const room = yield* frevo;
          const folder = yield* emptyFolder;

          const session = yield* hosted({
            hubUrl: room.hubUrl,
            roomCode: room.roomCode,
            participantId: "frevo-bot",
            nickname: "Frevo bot",
            harness: "fake",
            workspace: createLocalDirectoryWorkspace({ path: folder }),
          });
          const participants = yield* Effect.promise(() =>
            room.client.participants.list(room.roomCode)
          );
          const running = isRunning(session.harness.pid);
          yield* Effect.promise(() => session.leave());

          expect(session.participant).toMatchObject({
            id: "frevo-bot",
            nickname: "Frevo bot",
            model: "fake",
            harness: { id: "fake" },
          });
          expect(
            participants.map((participant) => [
              participant.id,
              participant.status,
              participant.harness?.id,
            ])
          ).toEqual([["frevo-bot", "online", "fake"]]);
          expect(session.harness.id).toBe("fake");
          expect(session.harness.workspacePath).toBe(folder);
          expect(session.harness.sessionId).toBeString();
          expect(session.harness.notes).toEqual([
            "Deterministic test agent; it does not call a model.",
          ]);
          expect(yield* Effect.promise(() => readdir(folder))).toEqual([
            ".gambi.json",
          ]);
          expect(running).toBe(true);
          expect(isRunning(session.harness.pid)).toBe(false);
          expect(
            yield* Effect.promise(() =>
              room.client.participants.list(room.roomCode)
            )
          ).toEqual([]);
        }),
      20_000
    );

    it.effect(
      "an attached client opens a harness session, talks ACP to the harness and gets the artifact of what it wrote",
      () =>
        Effect.gen(function* () {
          const room = yield* frevo;
          const folder = yield* emptyFolder;
          yield* hosted({
            hubUrl: room.hubUrl,
            roomCode: room.roomCode,
            participantId: "frevo-bot",
            nickname: "Frevo bot",
            harness: "fake",
            workspace: createLocalDirectoryWorkspace({ path: folder }),
            artifacts: { settleTimeMs: 20 },
          });
          const harness = attached(room.client, room.roomCode, "frevo-bot");
          const { harness: calls } = room.client;

          const first = yield* harness.until(
            (event): event is HarnessAttachEvent => true
          );
          const opened = yield* Effect.promise(() =>
            calls.openSession(room.roomCode, "frevo-bot", "roda-1", {
              cwd: undefined,
            })
          );
          const sent = yield* Effect.promise(() =>
            calls.send(room.roomCode, "frevo-bot", "roda-1", {
              jsonrpc: "2.0",
              id: 1,
              method: "session/prompt",
              params: {
                sessionId: "roda-1",
                prompt: [{ type: "text", text: "Oi" }],
                // A key left undefined is a key not given, here too.
                _meta: undefined,
              },
            })
          );
          const answer = yield* harness.until(
            (
              event
            ): event is Extract<
              HarnessAttachEvent,
              { type: "harness.message" }
            > => event.type === "harness.message" && event.message.id === 1
          );
          const artifact = yield* harness.until(ofType("harness.artifact"));
          const closed = yield* Effect.promise(() =>
            calls.closeSession(room.roomCode, "frevo-bot", "roda-1")
          );
          const status = yield* harness.until(
            (
              event
            ): event is Extract<
              HarnessAttachEvent,
              { type: "harness.session" }
            > => event.type === "harness.session" && event.status === "closed"
          );

          expect(first).toEqual({ type: "harness.connected" });
          expect(opened).toEqual({ sessionId: "roda-1" });
          expect(sent).toEqual({ sessionId: "roda-1" });
          expect(answer).toEqual({
            type: "harness.message",
            sessionId: "roda-1",
            message: {
              jsonrpc: "2.0",
              id: 1,
              result: { stopReason: "end_turn" },
            },
          });
          expect(artifact.reason).toBe("watch");
          expect(artifact.files).toEqual([
            {
              path: "fake-output.txt",
              encoding: "utf8",
              content: "Fake ACP response: Oi\n",
            },
          ]);
          expect(closed).toEqual({ sessionId: "roda-1" });
          expect(status.sessionId).toBe("roda-1");
        }),
      20_000
    );

    it.effect(
      "a Workspace of the host's own decides where the harness runs and what an artifact carries",
      () =>
        Effect.gen(function* () {
          const room = yield* frevo;
          const folder = yield* emptyFolder;
          const artifacts: ArtifactLifecycleEvent[] = [];
          const seen: {
            changed?: () => void;
            context?: WorkspaceContext;
            disposed: boolean;
            self?: unknown;
            watching: boolean;
          } = { disposed: false, watching: false };
          // A Workspace is an object of the host's, with whatever state it
          // keeps: here, a reference to itself.
          const workspace: Workspace & { self?: unknown } = {
            prepare(context) {
              // The host's own object, not a copy of it.
              seen.self = this;
              seen.context = context;
              return Promise.resolve({
                path: folder,
                collect: () =>
                  Promise.resolve([
                    { path: "NOTAS.md", encoding: "utf8", content: "# Frevo" },
                  ]),
                watch: (onChange) => {
                  seen.changed = onChange;
                  seen.watching = true;
                  return () => {
                    seen.watching = false;
                  };
                },
                dispose: () => {
                  seen.disposed = true;
                  return Promise.resolve();
                },
              });
            },
          };
          workspace.self = workspace;
          const session = yield* hosted({
            hubUrl: room.hubUrl,
            roomCode: room.roomCode,
            participantId: "frevo-bot",
            nickname: "Frevo bot",
            harness: "fake",
            model: "frevo-1",
            workspace,
            artifacts: { settleTimeMs: 20 },
            onArtifact: (event) => artifacts.push(event),
          });
          const harness = attached(room.client, room.roomCode, "frevo-bot");
          yield* harness.until(ofType("harness.connected"));

          seen.changed?.();
          const artifact = yield* harness.until(ofType("harness.artifact"));
          const watchingWhileHosted = seen.watching;
          yield* Effect.promise(() => session.leave());

          expect(seen.context).toEqual({
            harness: "fake",
            model: "frevo-1",
            participantId: "frevo-bot",
            roomCode: room.roomCode,
          });
          expect(seen.self).toBe(workspace);
          expect(session.harness.workspacePath).toBe(folder);
          expect(artifact).toMatchObject({
            sessionId: session.harness.sessionId,
            version: 1,
            reason: "watch",
            files: [{ path: "NOTAS.md", encoding: "utf8", content: "# Frevo" }],
          });
          expect(artifacts[0]).toMatchObject({
            type: "artifactSent",
            version: 1,
            reason: "watch",
            fileCount: 1,
          });
          expect(watchingWhileHosted).toBe(true);
          expect(seen).toMatchObject({ disposed: true, watching: false });
        }),
      20_000
    );

    it.effect(
      "leaving sends a last artifact of a Workspace seeded on top of the default one, then detaches the clients",
      () =>
        Effect.gen(function* () {
          const room = yield* frevo;
          const folder = yield* emptyFolder;
          const local = createLocalDirectoryWorkspace({ path: folder });
          const seeded: Workspace = {
            prepare: async (context) => {
              const prepared = await local.prepare(context);
              await Bun.write(join(prepared.path, "README.md"), "# Frevo\n");
              return prepared;
            },
          };
          const session = yield* hosted({
            hubUrl: room.hubUrl,
            roomCode: room.roomCode,
            participantId: "frevo-bot",
            nickname: "Frevo bot",
            harness: "fake",
            workspace: seeded,
            // No artifact but the last one.
            artifacts: { settleTimeMs: 3_600_000 },
          });
          const harness = attached(room.client, room.roomCode, "frevo-bot");
          yield* harness.until(ofType("harness.connected"));

          yield* Effect.promise(() => session.leave());
          const last = yield* harness.until(ofType("harness.artifact"));
          const detached = yield* harness.until(ofType("harness.detached"));

          expect(last).toMatchObject({
            reason: "final",
            files: [
              { path: "README.md", encoding: "utf8", content: "# Frevo\n" },
            ],
          });
          expect(detached.reason).toBe("left");
        }),
      20_000
    );

    it.effect(
      "a Workspace of the host's own is watched before the harness starts, so nothing the harness writes comes too early",
      () =>
        Effect.gen(function* () {
          const room = yield* frevo;
          const folder = yield* emptyFolder;
          const order: string[] = [];
          const workspace: Workspace = {
            prepare: () =>
              Promise.resolve({
                path: folder,
                collect: () => Promise.resolve([]),
                watch: () => {
                  order.push("watching");
                  return () => undefined;
                },
              }),
          };

          yield* hosted({
            hubUrl: room.hubUrl,
            roomCode: room.roomCode,
            participantId: "frevo-bot",
            nickname: "Frevo bot",
            harness: "fake",
            workspace,
            onLog: (entry) => {
              if (entry.message === "harness started") {
                order.push("harness started");
              }
            },
          });

          expect(order).toEqual(["watching", "harness started"]);
        }),
      20_000
    );

    it.effect(
      "a session that ended by itself has stopped its harness and let go of its Workspace",
      () =>
        Effect.gen(function* () {
          const room = yield* frevo;
          const folder = yield* emptyFolder;
          const link = yield* linkToHub;
          const local = createLocalDirectoryWorkspace({ path: folder });
          let disposed = false;
          const session = yield* hosted({
            hubUrl: link.url,
            roomCode: room.roomCode,
            participantId: "frevo-bot",
            nickname: "Frevo bot",
            harness: "fake",
            reconnect: false,
            workspace: {
              prepare: async (context) => {
                const prepared = await local.prepare(context);
                return {
                  ...prepared,
                  dispose: async () => {
                    disposed = true;
                    await prepared.dispose?.();
                  },
                };
              },
            },
          });

          yield* link.cut;
          const end = yield* Effect.promise(() => session.ended);

          expect(end).toEqual({ reason: "tunnelDropped" });
          expect(isRunning(session.harness.pid)).toBe(false);
          expect(disposed).toBe(true);
        }),
      20_000
    );

    it.effect(
      "leaving a session that another runtime replaced while it was closing leaves the other in the room",
      () =>
        Effect.gen(function* () {
          const room = yield* frevo;
          const folder = yield* emptyFolder;
          const collecting = Promise.withResolvers<void>();
          const collected = Promise.withResolvers<void>();
          const left = Promise.withResolvers<string>();
          const session = yield* hosted({
            hubUrl: room.hubUrl,
            roomCode: room.roomCode,
            participantId: "frevo-bot",
            nickname: "Frevo bot",
            harness: "fake",
            onLifecycle: (event) => {
              if (event.type === "left") {
                left.resolve(event.reason);
              }
            },
            // The last artifact is held: the session stays closing, with its
            // tunnel still open, for as long as the test wants.
            workspace: {
              prepare: () =>
                Promise.resolve({
                  path: folder,
                  collect: async () => {
                    collecting.resolve();
                    await collected.promise;
                    return [];
                  },
                  watch: () => () => undefined,
                }),
            },
          });

          const leaving = session.leave();
          yield* Effect.promise(() => collecting.promise);
          const other = yield* Effect.acquireRelease(
            Effect.promise(() =>
              createParticipantSession({
                hubUrl: room.hubUrl,
                roomCode: room.roomCode,
                participantId: "frevo-bot",
                nickname: "Another frevo bot",
                model: "llama3",
                endpoint: "http://127.0.0.1:1",
                capabilities: {
                  chatCompletions: "unknown",
                  openResponses: "unknown",
                },
              })
            ),
            (joined) => Effect.promise(() => joined.stop())
          );
          const reason = yield* Effect.promise(() => left.promise);
          collected.resolve();
          yield* Effect.promise(() => leaving);

          expect(reason).toBe("replaced");
          expect(yield* Effect.promise(() => session.ended)).toEqual({
            reason: "replaced",
          });
          expect(other.participant.nickname).toBe("Another frevo bot");
          const participants = yield* Effect.promise(() =>
            room.client.participants.list(room.roomCode)
          );
          expect(
            participants.map((participant) => [
              participant.nickname,
              participant.status,
            ])
          ).toEqual([["Another frevo bot", "online"]]);
        }),
      20_000
    );

    it.effect(
      "a join the hub refuses leaves no harness running",
      () =>
        Effect.gen(function* () {
          const room = yield* frevo;
          const folder = yield* emptyFolder;
          const lines: LogEntry[] = [];

          const error = yield* Effect.promise(() =>
            createHarnessParticipantSession({
              hubUrl: room.hubUrl,
              roomCode: "NOPE00",
              participantId: "frevo-bot",
              nickname: "Frevo bot",
              harness: "fake",
              workspace: createLocalDirectoryWorkspace({ path: folder }),
              onLog: (entry) => lines.push(entry),
            }).then(
              () => {
                throw new Error("Expected the join to be refused.");
              },
              (caught: unknown) => caught
            )
          );

          const pid = lines.find((line) => line.message === "harness started")
            ?.annotations.pid;
          expect(error).toBeInstanceOf(ParticipantError);
          expect((error as ParticipantError).code).toBe("ROOM_NOT_FOUND");
          expect(pid).toBeNumber();
          expect(isRunning(pid as number)).toBe(false);
        }),
      20_000
    );

    it.effect("a harness whose command cannot be run refuses the session", () =>
      Effect.gen(function* () {
        const room = yield* frevo;
        const folder = yield* emptyFolder;

        const error = yield* Effect.promise(() =>
          createHarnessParticipantSession({
            hubUrl: room.hubUrl,
            roomCode: room.roomCode,
            participantId: "frevo-bot",
            nickname: "Frevo bot",
            harness: "fake",
            fakeAgentCommand: { command: join(folder, "no-such-agent") },
            workspace: createLocalDirectoryWorkspace({ path: folder }),
          }).then(
            () => {
              throw new Error("Expected the session to be refused.");
            },
            (caught: unknown) => caught
          )
        );

        expect(error).toBeInstanceOf(ParticipantError);
        expect((error as ParticipantError).code).toBe("HARNESS_START_FAILED");
        expect(
          yield* Effect.promise(() =>
            room.client.participants.list(room.roomCode)
          )
        ).toEqual([]);
      })
    );

    it.effect(
      "a harness that exits on its own is told to the host, and the participant stays in the room",
      () =>
        Effect.gen(function* () {
          const room = yield* frevo;
          const folder = yield* emptyFolder;
          const session = yield* hosted({
            hubUrl: room.hubUrl,
            roomCode: room.roomCode,
            participantId: "frevo-bot",
            nickname: "Frevo bot",
            harness: "fake",
            workspace: createLocalDirectoryWorkspace({ path: folder }),
          });

          process.kill(session.harness.pid, "SIGKILL");
          const exit = yield* Effect.promise(() => session.harness.exited);

          expect(exit.message).toStartWith("Harness process exited");
          const participants = yield* Effect.promise(() =>
            room.client.participants.list(room.roomCode)
          );
          expect(
            participants.map((participant) => [
              participant.id,
              participant.status,
            ])
          ).toEqual([["frevo-bot", "online"]]);
        }),
      20_000
    );

    it.effect(
      "attaching to a participant that shares a model endpoint is refused",
      () =>
        Effect.gen(function* () {
          const room = yield* frevo;
          yield* Effect.promise(() =>
            room.client.participants.register(room.roomCode, "arthur-1", {
              nickname: "Arthur",
              model: "llama3",
            })
          );

          const onAttach = yield* rejection(() =>
            room.client.harness
              .attach(room.roomCode, "arthur-1")
              [Symbol.asyncIterator]()
              .next()
          );
          const onSend = yield* rejection(() =>
            room.client.harness.send(room.roomCode, "arthur-1", "roda-1", {
              jsonrpc: "2.0",
              method: "session/cancel",
            })
          );

          expect(onAttach.code).toBe("NOT_A_HARNESS_PARTICIPANT");
          expect(onAttach.status).toBe(409);
          expect(onSend.code).toBe("NOT_A_HARNESS_PARTICIPANT");
        })
    );

    it.effect(
      "a message for a harness session that is not open is refused by the participant",
      () =>
        Effect.gen(function* () {
          const room = yield* frevo;
          const folder = yield* emptyFolder;
          yield* hosted({
            hubUrl: room.hubUrl,
            roomCode: room.roomCode,
            participantId: "frevo-bot",
            nickname: "Frevo bot",
            harness: "fake",
            workspace: createLocalDirectoryWorkspace({ path: folder }),
          });

          const error = yield* rejection(() =>
            room.client.harness.send(
              room.roomCode,
              "frevo-bot",
              "nunca-abriu",
              {
                jsonrpc: "2.0",
                method: "session/cancel",
              }
            )
          );

          expect(error.code).toBe("HARNESS_SESSION_NOT_OPEN");
          expect(error.details).toEqual({ sessionId: "nunca-abriu" });
        }),
      20_000
    );
  }
);
