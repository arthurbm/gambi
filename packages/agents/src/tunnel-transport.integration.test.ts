import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createHarnessParticipantSession,
  type HarnessParticipantSession,
} from "@gambi/core/harness-participant-session";
import { createHub, type Hub } from "@gambi/core/hub";
import { MockLanguageModelV3 } from "ai/test";
import { createClient } from "../../sdk/src/client.ts";
import { Orchestrator } from "./orchestrator.ts";
import { TunnelHarnessTransport } from "./tunnel-transport.ts";
import type { DomainEvent } from "./types.ts";

function randomPort(): number {
  return 30_000 + Math.floor(Math.random() * 20_000);
}

function createTestHub(): Hub {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      return createHub({ hostname: "127.0.0.1", port: randomPort() });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function modelResult() {
  return {
    content: [{ type: "text", text: "done" }],
    finishReason: { unified: "stop", raw: undefined },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  } as Awaited<ReturnType<MockLanguageModelV3["doGenerate"]>>;
}

async function nextMatchingEvent(
  iterator: AsyncIterator<DomainEvent>,
  predicate: (event: DomainEvent) => boolean
): Promise<DomainEvent> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error("Timed out waiting for domain event.")),
      4000
    );
  });
  while (true) {
    const result = await Promise.race([iterator.next(), timeout]);
    if (result.done) {
      throw new Error("Domain event stream closed early.");
    }
    if (predicate(result.value)) {
      return result.value;
    }
  }
}

describe("TunnelHarnessTransport integration", () => {
  const hubs: Hub[] = [];
  const harnessSessions: HarnessParticipantSession[] = [];
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    for (const session of harnessSessions.splice(0)) {
      await session.close();
    }
    for (const hub of hubs.splice(0)) {
      hub.close();
    }
    for (const directory of temporaryDirectories.splice(0)) {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("dispatches through a real hub, returns in-session, and recovers explicitly", async () => {
    const hub = createTestHub();
    hubs.push(hub);
    const client = createClient({ hubUrl: hub.url });
    const room = await client.rooms.create({ name: "Agents integration" });
    const roomCode = room.data.room.code;
    const gambiHome = await mkdtemp(
      join(tmpdir(), "gambi agents integration ")
    );
    temporaryDirectories.push(gambiHome);

    let participant = await createHarnessParticipantSession({
      hubUrl: hub.url,
      roomCode,
      participantId: "fake-alpha",
      nickname: "Fake Alpha",
      harnessId: "fake",
      model: "deterministic-fixture",
      gambiHome,
      artifactDebounceMs: 30,
    });
    harnessSessions.push(participant);

    let nextSession = 0;
    const transport = new TunnelHarnessTransport({
      client,
      roomCode,
      participantId: "fake-alpha",
      operationTimeoutMs: 1000,
      generateSessionId: () => {
        nextSession += 1;
        return `transport-session-${nextSession}`;
      },
    });
    const orchestrator = new Orchestrator({
      model: new MockLanguageModelV3({ doGenerate: modelResult() }),
      squads: [
        {
          id: "alpha",
          name: "Alpha",
          memberNames: ["Ana"],
          harnessParticipantId: "fake-alpha",
        },
      ],
      rounds: [
        { id: "round-1", name: "Foundation", objective: "Build together" },
      ],
      transports: { alpha: transport },
    });
    const events = orchestrator.events[Symbol.asyncIterator]();
    const challenge = orchestrator.createChallenge({
      squadId: "alpha",
      roundId: "round-1",
      objective: "Build an accessible station",
      seededDrafts: [
        { content: "A small platform" },
        { content: "A covered platform" },
      ],
    });
    orchestrator.recordDecision({
      challengeId: challenge.id,
      build: "The small covered platform",
      cut: "Retail space",
      reason: "Make the public route obvious",
      consideredDraftIds: challenge.seededDraftIds,
      steererName: "Ana",
    });

    const dispatch = await orchestrator.dispatch({
      challengeId: challenge.id,
      input: "starter workspace",
      expectedOutput: "working station",
    });
    expect(dispatch.sessionId).toBe("transport-session-1");
    await expect(
      nextMatchingEvent(
        events,
        (event) =>
          event.type === "harness.event" &&
          event.event.type === "text" &&
          event.event.text.includes("Build an accessible station")
      )
    ).resolves.toMatchObject({
      type: "harness.event",
      squadId: "alpha",
      event: { type: "text", sessionId: dispatch.sessionId },
    });
    const firstArtifact = await nextMatchingEvent(
      events,
      (event) =>
        event.type === "harness.event" && event.event.type === "artifact"
    );
    expect(firstArtifact).toMatchObject({
      type: "harness.event",
      event: {
        type: "artifact",
        version: 1,
        files: expect.arrayContaining([
          expect.objectContaining({ path: "fake-output.txt" }),
        ]),
      },
    });

    await orchestrator.recordReview({
      dispatchId: dispatch.id,
      outcome: "returned",
      reason: "Widen the public entrance",
      reviewerName: "Ana",
    });
    await expect(
      nextMatchingEvent(
        events,
        (event) =>
          event.type === "harness.event" &&
          event.event.type === "text" &&
          event.event.text.includes(
            "Returned by Ana: Widen the public entrance"
          )
      )
    ).resolves.toMatchObject({
      type: "harness.event",
      event: { type: "text", sessionId: dispatch.sessionId },
    });
    const returnedArtifact = await nextMatchingEvent(
      events,
      (event) =>
        event.type === "harness.event" &&
        event.event.type === "artifact" &&
        event.event.version > 1
    );
    expect(returnedArtifact).toMatchObject({
      type: "harness.event",
      event: { type: "artifact", version: 2 },
    });

    await participant.close();
    harnessSessions.splice(harnessSessions.indexOf(participant), 1);
    const disconnect = await nextMatchingEvent(
      events,
      (event) =>
        event.type === "harness.event" &&
        event.event.type === "error" &&
        event.event.recoverable === true
    );
    expect(disconnect).toMatchObject({
      type: "harness.event",
      event: { type: "error", recoverable: true },
    });

    participant = await createHarnessParticipantSession({
      hubUrl: hub.url,
      roomCode,
      participantId: "fake-alpha",
      nickname: "Fake Alpha reconnected",
      harnessId: "fake",
      model: "deterministic-fixture",
      gambiHome,
      artifactDebounceMs: 30,
    });
    harnessSessions.push(participant);
    const retried = await orchestrator.dispatch({
      challengeId: challenge.id,
      input: "starter workspace after reconnect",
      expectedOutput: "working station",
    });
    expect(retried.sessionId).toBe("transport-session-2");
    expect(retried.sessionId).not.toBe(dispatch.sessionId);

    await orchestrator.close();
  });
});
