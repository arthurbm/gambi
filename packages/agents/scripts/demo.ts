#!/usr/bin/env bun
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
import { createGambi } from "../../sdk/src/provider.ts";
import { Orchestrator } from "../src/orchestrator.ts";
import { TunnelHarnessTransport } from "../src/tunnel-transport.ts";
import type { DomainEvent, Squad } from "../src/types.ts";

interface DemoOptions {
  hubUrl?: string;
  model?: string;
  roomCode?: string;
}

function parseOptions(args: string[]): DemoOptions {
  const options: DemoOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === "--hub-url" && value) {
      options.hubUrl = value;
      index += 1;
    } else if (flag === "--room" && value) {
      options.roomCode = value;
      index += 1;
    } else if (flag === "--model" && value) {
      options.model = value;
      index += 1;
    } else if (flag === "--help") {
      console.log(`Usage: bun run --cwd packages/agents demo [options]

Options:
  --hub-url <url>   Use an existing hub instead of starting one
  --room <code>     Use an existing room (requires its hub to be running)
  --model <name>    Use model:<name> from the room for the orchestrator

Without --model, the demo uses a deterministic MockLanguageModelV3 and makes
no model calls. It always starts two deterministic fake harness participants.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete option: ${flag ?? "<empty>"}`);
    }
  }
  return options;
}

function mockModel() {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: "text", text: "Deterministic demo complete" }],
      finishReason: { unified: "stop", raw: undefined },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 },
      },
      warnings: [],
    }),
  });
}

function waitForArtifact(
  events: AsyncIterable<DomainEvent>,
  squadId: string,
  minimumVersion: number
): Promise<DomainEvent> {
  return (async () => {
    for await (const event of events) {
      if (
        event.type === "harness.event" &&
        event.squadId === squadId &&
        event.event.type === "artifact" &&
        event.event.version >= minimumVersion
      ) {
        return event;
      }
    }
    throw new Error(
      "The domain event stream closed before an artifact arrived."
    );
  })();
}

const options = parseOptions(Bun.argv.slice(2));
let localHub: Hub | undefined;
const harnessSessions: HarnessParticipantSession[] = [];
let orchestrator: Orchestrator | undefined;
let gambiHome: string | undefined;
let cleaningUp = false;

async function cleanup(): Promise<void> {
  if (cleaningUp) {
    return;
  }
  cleaningUp = true;
  await orchestrator?.close();
  for (const session of harnessSessions) {
    await session.close();
  }
  localHub?.close();
  if (gambiHome) {
    await rm(gambiHome, { recursive: true, force: true });
  }
}

const onSignal = process.once.bind(process) as unknown as (
  signal: "SIGINT" | "SIGTERM",
  listener: () => Promise<void>
) => typeof process;
onSignal("SIGINT", () => {
  return cleanup().finally(() => process.exit(130));
});
onSignal("SIGTERM", () => {
  return cleanup().finally(() => process.exit(143));
});

try {
  if (!(options.hubUrl || options.roomCode)) {
    localHub = createHub({ hostname: "127.0.0.1", port: 0 });
  }
  const hubUrl = options.hubUrl ?? localHub?.url ?? "http://localhost:3000";
  const client = createClient({ hubUrl });
  const roomCode =
    options.roomCode ??
    (await client.rooms.create({ name: "Harness transport demo" })).data.room
      .code;
  gambiHome = await mkdtemp(join(tmpdir(), "gambi agents demo "));
  const suffix = Date.now().toString(36);
  const squads: Squad[] = [
    {
      id: "alpha",
      name: "Alpha",
      memberNames: ["Ana"],
      harnessParticipantId: `demo-alpha-${suffix}`,
    },
    {
      id: "beta",
      name: "Beta",
      memberNames: ["Beto"],
      harnessParticipantId: `demo-beta-${suffix}`,
    },
  ];

  for (const squad of squads) {
    harnessSessions.push(
      await createHarnessParticipantSession({
        hubUrl,
        roomCode,
        participantId: squad.harnessParticipantId ?? squad.id,
        nickname: `${squad.name} fake harness`,
        harnessId: "fake",
        model: "deterministic-fixture",
        gambiHome,
        artifactDebounceMs: 50,
      })
    );
  }

  const model = options.model
    ? createGambi({ hubUrl, roomCode }).model(options.model)
    : mockModel();
  const transports = Object.fromEntries(
    squads.map((squad) => [
      squad.id,
      new TunnelHarnessTransport({
        client,
        roomCode,
        participantId: squad.harnessParticipantId,
      }),
    ])
  );
  const activeOrchestrator = new Orchestrator({
    model,
    squads,
    rounds: [
      { id: "demo-round", name: "Demo", objective: "Build shared artifacts" },
    ],
    transports,
  });
  orchestrator = activeOrchestrator;

  const eventLog = (async () => {
    for await (const event of activeOrchestrator.events) {
      if (event.type === "harness.event") {
        console.log(
          JSON.stringify({
            sequence: event.sequence,
            squadId: event.squadId,
            harnessEvent: event.event.type,
            version:
              event.event.type === "artifact" ? event.event.version : undefined,
          })
        );
      }
    }
  })();

  const challenges = squads.map((squad) => {
    const challenge = activeOrchestrator.createChallenge({
      squadId: squad.id,
      roundId: "demo-round",
      objective: `Build the smallest useful artifact for ${squad.name}`,
      seededDrafts: [
        { content: "A minimal public entrance" },
        { content: "A visible shared landmark" },
      ],
    });
    activeOrchestrator.recordDecision({
      challengeId: challenge.id,
      build: "The accessible public entrance",
      cut: "Decorative extras",
      reason: "Keep the feedback loop short",
      consideredDraftIds: challenge.seededDraftIds,
      steererName: squad.memberNames[0] ?? "Demo steerer",
    });
    return challenge;
  });

  const firstArtifacts = squads.map((squad) =>
    waitForArtifact(activeOrchestrator.events, squad.id, 1)
  );
  const dispatches = await Promise.all(
    challenges.map((challenge) =>
      activeOrchestrator.dispatch({
        challengeId: challenge.id,
        input: "The starter workspace",
        expectedOutput: "A deterministic fake-output.txt artifact",
        constraints: ["Stay inside the workspace"],
      })
    )
  );
  await Promise.all(firstArtifacts);

  const accepted = dispatches[0];
  const returned = dispatches[1];
  if (!(accepted && returned)) {
    throw new Error("The demo did not create both dispatches.");
  }
  await activeOrchestrator.recordReview({
    dispatchId: accepted.id,
    outcome: "accepted",
    reviewerName: "Ana",
  });
  const returnedArtifact = waitForArtifact(
    activeOrchestrator.events,
    "beta",
    2
  );
  await activeOrchestrator.recordReview({
    dispatchId: returned.id,
    outcome: "returned",
    reason: "Make the entrance wider",
    reviewerName: "Beto",
  });
  await returnedArtifact;

  if (options.model) {
    await activeOrchestrator.run(
      "Read the completed demo world and finish with a concise summary."
    );
  }

  console.log(
    JSON.stringify({
      status: "complete",
      hubUrl,
      roomCode,
      orchestratorModel: options.model ?? "MockLanguageModelV3",
      acceptedDispatch: accepted.id,
      returnedDispatch: returned.id,
      returnedSessionId: returned.sessionId,
    })
  );
  await cleanup();
  await eventLog;
} catch (error) {
  await cleanup();
  throw error;
}
