import { expect } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub } from "@gambi/core/testing/hub";
import { layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { createClient } from "./client.ts";
import {
  createHarnessParticipantSession,
  createLocalDirectoryWorkspace,
  type HarnessParticipantSessionOptions,
} from "./participant.ts";

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
  (folder) =>
    Effect.promise(() => rm(folder, { force: true, recursive: true }))
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
  }
);
