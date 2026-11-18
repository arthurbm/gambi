import { expect } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub } from "@gambi/core/testing/hub";
import { layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { createClient } from "./client.ts";
import { ClientError } from "./client-error.ts";
import {
  createHarnessParticipantSession,
  createLocalDirectoryWorkspace,
  type HarnessParticipantSessionOptions,
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
