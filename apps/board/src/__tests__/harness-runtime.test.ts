import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HarnessParticipantSession } from "@gambi/core/harness-participant-session";
import type { GambiClient } from "gambi-sdk";

import { createBoardApp } from "../app";

interface FakeSession extends HarnessParticipantSession {
  disconnect: () => void;
}

function createFakeSession(participantId: string): FakeSession {
  let resolveClosed!: (value: { reason: "closed" | "tunnel_closed" }) => void;
  const closed = new Promise<{ reason: "closed" | "tunnel_closed" }>(
    (resolve) => {
      resolveClosed = resolve;
    }
  );
  return {
    participant: {} as FakeSession["participant"],
    processPid: 100,
    roomId: "room-id",
    sessionId: `session-${participantId}`,
    tunnel: {} as FakeSession["tunnel"],
    workspacePath: `/tmp/${participantId}`,
    harnessExited: new Promise(() => undefined),
    close: () => {
      const result = { reason: "closed" as const };
      resolveClosed(result);
      return Promise.resolve(result);
    },
    disconnect: () => resolveClosed({ reason: "tunnel_closed" }),
    waitUntilClosed: () => closed,
  };
}

function fakeClient(): GambiClient {
  return {
    participants: {
      list: async () => ({ data: [], meta: {} }),
    },
    events: {
      async *watchRoom({ signal }: { signal?: AbortSignal }) {
        await new Promise<void>((resolve) => {
          if (signal?.aborted) {
            resolve();
            return;
          }
          signal?.addEventListener("abort", () => resolve(), { once: true });
        });
      },
    },
  } as unknown as GambiClient;
}

test("spawns, recreates, restores, and cleans up hosted harness sessions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "gambi-board-harness-"));
  const databaseUrl = `file:${join(directory, "board.db")}`;
  const created: FakeSession[] = [];
  const createHostedSession = (options: { participantId: string }) => {
    const session = createFakeSession(options.participantId);
    created.push(session);
    return Promise.resolve(session);
  };

  try {
    const first = await createBoardApp({
      adminToken: "test-admin-token",
      databaseUrl,
      harness: {
        client: fakeClient(),
        createHostedSession,
        hostedHarnessId: "fake",
        hubUrl: "http://hub.test",
        roomCode: "ROOM74",
      },
      onError: () => undefined,
    });
    await first.repository.configure({
      theme: "Runtime",
      squadCount: 1,
      hostedHarnessCount: 2,
    });
    await first.harness?.reconcileHosted(2);
    expect(created.map((session) => session.sessionId)).toEqual([
      "session-board-hosted-01",
      "session-board-hosted-02",
    ]);

    created[0]?.disconnect();
    await Bun.sleep(1100);
    expect(created).toHaveLength(3);
    expect(created[2]?.sessionId).toBe("session-board-hosted-01");
    await first.close();
    expect(
      await Promise.all(created.map((session) => session.waitUntilClosed()))
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: "closed" }),
        expect.objectContaining({ reason: "tunnel_closed" }),
      ])
    );

    const restored: FakeSession[] = [];
    const second = await createBoardApp({
      adminToken: "test-admin-token",
      databaseUrl,
      harness: {
        client: fakeClient(),
        createHostedSession: (options) => {
          const session = createFakeSession(options.participantId);
          restored.push(session);
          return Promise.resolve(session);
        },
        hostedHarnessId: "fake",
        hubUrl: "http://hub.test",
        roomCode: "ROOM74",
      },
      onError: () => undefined,
    });
    expect(restored).toHaveLength(2);
    await second.close();
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});
