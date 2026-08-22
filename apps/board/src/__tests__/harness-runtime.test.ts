import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HarnessParticipantSession } from "@gambi/core/harness-participant-session";
import type { GambiClient } from "gambi-sdk";

import { createBoardApp } from "../app";
import type { BoardHarnessRuntime } from "../harness-runtime";

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

test("routes orchestrator dispatches through the assigned board harness", async () => {
  const prompts: Array<{ sessionId: string; prompt: string }> = [];
  const harness: BoardHarnessRuntime = {
    close: () => Promise.resolve(),
    prompt: async () => ({ sessionId: "unused", revision: 0 }),
    promptSession: (input) => {
      prompts.push({ sessionId: input.sessionId, prompt: input.prompt });
      return Promise.resolve("Harness completed the dispatch");
    },
    reconcileHosted: () => Promise.resolve(),
    subscribeArtifacts: () => () => undefined,
  };
  const runtime = await createBoardApp({
    adminToken: "test-admin-token",
    databaseUrl: ":memory:",
    harness: {
      hostedHarnessId: "fake",
      hubUrl: "http://hub.test",
      roomCode: "ROOM74",
    },
    harnessRuntime: harness,
    onError: () => undefined,
  });

  try {
    await runtime.repository.joinPerson({
      personId: "person-orchestrator",
      name: "Bia",
    });
    await runtime.repository.joinSquad({
      personId: "person-orchestrator",
      squadId: "squad-1",
    });
    await runtime.repository.reconcileHarnessParticipants([
      {
        id: "board-hosted-orchestrator",
        nickname: "Hospedado orquestrador",
        model: "fake-event",
        harness: { id: "fake", hosted: true, model: "fake-event" },
        connection: { connected: true },
      },
    ]);
    await runtime.repository.claimHostedHarness({
      personId: "person-orchestrator",
      participantId: "board-hosted-orchestrator",
    });
    await runtime.repository.advancePhase();
    await runtime.repository.assignHarness({
      actorPersonId: "person-orchestrator",
      squadId: "squad-1",
      participantId: "board-hosted-orchestrator",
    });

    const orchestrator = runtime.orchestrator;
    expect(orchestrator).toBeDefined();
    const challenge = orchestrator?.createChallenge({
      squadId: "squad-1",
      roundId: "round-1",
      objective: "Build an accessible square",
      seededDrafts: [
        { content: "Add a ramp" },
        { content: "Keep a wide entrance" },
      ],
    });
    orchestrator?.recordDecision({
      challengeId: challenge?.id ?? "",
      build: "A shaded accessible square",
      cut: "Raised stage",
      reason: "Keep the public route open",
      consideredDraftIds: challenge?.seededDraftIds ?? [],
      steererName: "Bia",
    });

    const dispatch = await orchestrator?.dispatch({
      challengeId: challenge?.id ?? "",
      input: "starter workspace",
      expectedOutput: "working city tile",
    });

    expect(prompts).toHaveLength(1);
    expect(prompts[0]?.sessionId).toBe(dispatch?.sessionId);
    expect(JSON.parse(prompts[0]?.prompt ?? "{}")).toMatchObject({
      objective: "Build an accessible square",
      decision: { steererName: "Bia" },
    });
  } finally {
    await runtime.close();
  }
});
