import { describe, expect, test } from "bun:test";
import { MockLanguageModelV3 } from "ai/test";
import { MemoryHarnessTransport } from "./memory-transport.ts";
import { Orchestrator } from "./orchestrator.ts";
import type { DomainEvent, Round, Squad } from "./types.ts";

const squads: Squad[] = [
  {
    id: "alpha",
    name: "Alpha",
    harnessParticipantId: "participant-alpha",
    memberNames: ["Ana", "Beto"],
  },
  {
    id: "beta",
    name: "Beta",
    harnessParticipantId: "participant-beta",
    memberNames: ["Caio"],
  },
];

const rounds: Round[] = [
  { id: "round-1", name: "Foundation", objective: "Create a foundation" },
];

function textResult(text = "done") {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: undefined },
    usage: {
      inputTokens: {
        total: 1,
        noCache: 1,
        cacheRead: 0,
        cacheWrite: 0,
      },
      outputTokens: { total: 1, text: 1, reasoning: 0 },
    },
    warnings: [],
  } as any;
}

function toolResult(toolName: string, input: unknown) {
  return {
    content: [
      {
        type: "tool-call",
        toolCallId: `call-${toolName}`,
        toolName,
        input: JSON.stringify(input),
      },
    ],
    finishReason: { unified: "tool-calls", raw: undefined },
    usage: {
      inputTokens: {
        total: 1,
        noCache: 1,
        cacheRead: 0,
        cacheWrite: 0,
      },
      outputTokens: { total: 1, text: 0, reasoning: 0 },
    },
    warnings: [],
  } as any;
}

function createFixture(options?: {
  maxReturns?: number;
  model?: MockLanguageModelV3;
}) {
  const alphaTransport = new MemoryHarnessTransport();
  const betaTransport = new MemoryHarnessTransport();
  let id = 0;
  const model =
    options?.model ??
    new MockLanguageModelV3({
      doGenerate: textResult(),
    });
  const orchestrator = new Orchestrator({
    model,
    squads,
    rounds,
    transports: { alpha: alphaTransport, beta: betaTransport },
    maxReturns: options?.maxReturns,
    generateId: (kind) => {
      id += 1;
      return `${kind}-${id}`;
    },
  });
  return { alphaTransport, betaTransport, model, orchestrator };
}

function createChallenge(orchestrator: Orchestrator, squadId = "alpha") {
  return orchestrator.createChallenge({
    squadId,
    roundId: "round-1",
    objective: "Build a shared artifact",
    seededDrafts: [{ content: "Proposal A" }, { content: "Proposal B" }],
  });
}

function recordDecision(orchestrator: Orchestrator, challengeId: string) {
  const challenge = orchestrator.world.challenges.find(
    (candidate) => candidate.id === challengeId
  );
  if (!challenge) {
    throw new Error("Missing test challenge");
  }
  return orchestrator.recordDecision({
    challengeId,
    build: "The smallest useful version",
    cut: "Decorative extras",
    reason: "Keep the feedback loop short",
    consideredDraftIds: [...challenge.seededDraftIds],
    steererName: "Ana",
  });
}

function collectEvents(events: AsyncIterable<DomainEvent>, count: number) {
  return (async () => {
    const collected: DomainEvent[] = [];
    for await (const event of events) {
      collected.push(event);
      if (collected.length === count) {
        break;
      }
    }
    return collected;
  })();
}

describe("Orchestrator", () => {
  test("rejects dispatch until the squad records a Decision", async () => {
    const { orchestrator } = createFixture();
    const challenge = createChallenge(orchestrator);

    await expect(
      orchestrator.dispatch({
        challengeId: challenge.id,
        input: "starter files",
        expectedOutput: "working artifact",
      })
    ).rejects.toThrow("before its Decision is recorded");
  });

  test("keeps seeded drafts editable before dispatch", async () => {
    const { orchestrator } = createFixture();
    const eventsPromise = collectEvents(orchestrator.events, 3);
    const challenge = createChallenge(orchestrator);

    expect(challenge.seededDraftIds).toHaveLength(2);
    orchestrator.updateChallenge(challenge.id, "Edited objective");
    orchestrator.updateDraft(
      challenge.seededDraftIds[0] ?? "",
      "Edited proposal"
    );
    const events = await eventsPromise;

    expect(events.map((event) => event.type)).toEqual([
      "challenge.created",
      "draft.added",
      "draft.added",
    ]);
    expect(orchestrator.world.challenges[0]?.objective).toBe(
      "Edited objective"
    );
    expect(orchestrator.world.drafts[0]?.content).toBe("Edited proposal");
  });

  test("sends a returned reason to the same harness session", async () => {
    const { alphaTransport, orchestrator } = createFixture();
    expect(orchestrator.maxReturns).toBe(2);
    const challenge = createChallenge(orchestrator);
    recordDecision(orchestrator, challenge.id);
    const dispatch = await orchestrator.dispatch({
      challengeId: challenge.id,
      input: "starter files",
      expectedOutput: "working artifact",
      constraints: ["Stay within the workspace"],
    });

    await orchestrator.recordReview({
      dispatchId: dispatch.id,
      outcome: "returned",
      reason: "Keep the public entrance accessible",
      reviewerName: "Ana",
    });

    expect(alphaTransport.openCalls).toHaveLength(1);
    expect(alphaTransport.prompts).toHaveLength(2);
    expect(alphaTransport.prompts[0]?.sessionId).toBe(dispatch.sessionId);
    expect(alphaTransport.prompts[1]).toEqual({
      sessionId: dispatch.sessionId,
      prompt: "Returned by Ana: Keep the public entrance accessible",
    });
  });

  test("suspends at maxReturns through askHuman and re-enters the loop with its answer", async () => {
    const model = new MockLanguageModelV3({ doGenerate: textResult() });
    const { alphaTransport, orchestrator } = createFixture({
      maxReturns: 2,
      model,
    });
    const challenge = createChallenge(orchestrator);
    recordDecision(orchestrator, challenge.id);
    const dispatch = await orchestrator.dispatch({
      challengeId: challenge.id,
      input: "starter files",
      expectedOutput: "working artifact",
    });
    await orchestrator.recordReview({
      dispatchId: dispatch.id,
      outcome: "returned",
      reason: "First revision",
      reviewerName: "Ana",
    });

    let settled = false;
    const secondReviewPromise = orchestrator
      .recordReview({
        dispatchId: dispatch.id,
        outcome: "returned",
        reason: "Second revision",
        reviewerName: "Ana",
      })
      .then((result) => {
        settled = true;
        return result;
      });
    while (orchestrator.world.escalations.length === 0) {
      await Promise.resolve();
    }
    expect(alphaTransport.prompts).toHaveLength(2);
    const escalation = orchestrator.world.escalations[0];
    expect(escalation).toMatchObject({
      squadId: "alpha",
      roundId: "round-1",
      returnCount: 2,
      status: "pending",
    });

    expect(settled).toBe(false);
    orchestrator.answerHuman(
      escalation?.id ?? "",
      "Accept the constrained scope"
    );
    const secondReview = await secondReviewPromise;
    expect(secondReview.escalation).toMatchObject({
      id: escalation?.id,
      status: "answered",
      response: "Accept the constrained scope",
    });
    expect(secondReview.humanResponse).toBe("Accept the constrained scope");
    await orchestrator.run("Continue after the repeated return");
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain(
      "Accept the constrained scope"
    );
    expect(alphaTransport.prompts).toHaveLength(2);
  });

  test("askHuman suspends the ToolLoopAgent and adds the answer to context", async () => {
    const responses = [
      toolResult("askHuman", {
        squadId: "alpha",
        roundId: "round-1",
        question: "Which constraint wins?",
        reason: "The constraints conflict",
      }),
      textResult("Human steering applied"),
    ];
    const model = new MockLanguageModelV3({
      doGenerate: async () => responses.shift() ?? textResult(),
    });
    const { orchestrator } = createFixture({ model });

    let settled = false;
    const run = orchestrator
      .run("Coordinate the next action")
      .then((result) => {
        settled = true;
        return result;
      });
    while (orchestrator.world.escalations.length === 0) {
      await Promise.resolve();
    }

    expect(settled).toBe(false);
    const escalation = orchestrator.world.escalations[0];
    orchestrator.answerHuman(escalation?.id ?? "", "Accessibility wins");
    await run;

    expect(model.doGenerateCalls).toHaveLength(2);
    expect(JSON.stringify(model.doGenerateCalls[1]?.prompt)).toContain(
      "Accessibility wins"
    );
  });

  test("finish records 2-3 proposals per squad from a MockLanguageModelV3", async () => {
    const responses = [
      toolResult("finish", {
        summary: "Challenges proposed",
        challenges: squads.map((squad) => ({
          squadId: squad.id,
          roundId: "round-1",
          objective: `Objective for ${squad.name}`,
          seededDrafts: [
            { content: `First proposal for ${squad.name}` },
            { content: `Second proposal for ${squad.name}` },
            { content: `Third proposal for ${squad.name}` },
          ],
        })),
      }),
      textResult("Challenges ready for human editing"),
    ];
    const model = new MockLanguageModelV3({
      doGenerate: async () => responses.shift() ?? textResult(),
    });
    const { orchestrator } = createFixture({ model });

    await orchestrator.run("Propose challenges for every squad");

    expect(orchestrator.world.challenges).toHaveLength(2);
    expect(orchestrator.world.drafts).toHaveLength(6);
    expect(
      orchestrator.world.challenges.every((item) => item.status === "draft")
    ).toBe(true);
  });

  test("returns distinct typed model proposals for persistence", async () => {
    const responses = [
      toolResult("finish", {
        summary: "Distinct proposals",
        challenges: squads.map((squad, index) => ({
          squadId: squad.id,
          roundId: "round-1",
          objective: `Model objective ${index + 1} for ${squad.name}`,
          seededDrafts: [
            { content: `Model seed ${index + 1}.A` },
            { content: `Model seed ${index + 1}.B` },
          ],
        })),
      }),
      textResult("Ready"),
    ];
    const model = new MockLanguageModelV3({
      doGenerate: async () => responses.shift() ?? textResult(),
    });
    const { orchestrator } = createFixture({ model });

    const proposals = await orchestrator.proposeChallenges(
      "Make each squad different",
      "round-1"
    );

    expect(proposals.map((proposal) => proposal.objective)).toEqual([
      "Model objective 1 for Alpha",
      "Model objective 2 for Beta",
    ]);
    expect(proposals[1]?.seededDrafts.map((draft) => draft.content)).toEqual([
      "Model seed 2.A",
      "Model seed 2.B",
    ]);
  });

  test("swapModel hands off current state without replaying prior prompts", async () => {
    const oldModel = new MockLanguageModelV3({
      modelId: "old-model",
      doGenerate: textResult(),
    });
    const nextModel = new MockLanguageModelV3({
      modelId: "next-model",
      doGenerate: textResult(),
    });
    const { orchestrator } = createFixture({ model: oldModel });
    const challenge = createChallenge(orchestrator);
    recordDecision(orchestrator, challenge.id);
    await orchestrator.run("OLD_UNIQUE_PROMPT");

    const handoff = orchestrator.swapModel(nextModel);
    await orchestrator.run("NEW_UNIQUE_PROMPT");

    expect(handoff).toContain("The smallest useful version");
    const nextPrompt = JSON.stringify(nextModel.doGenerateCalls[0]?.prompt);
    expect(nextPrompt).toContain("Handoff from the previous model");
    expect(nextPrompt).toContain("NEW_UNIQUE_PROMPT");
    expect(nextPrompt).not.toContain("OLD_UNIQUE_PROMPT");
    expect(nextModel.doGenerateCalls).toHaveLength(1);
  });

  test("emits domain events in causal order", async () => {
    const { orchestrator } = createFixture({ maxReturns: 1 });
    const eventsPromise = collectEvents(orchestrator.events, 9);
    const challenge = createChallenge(orchestrator);
    recordDecision(orchestrator, challenge.id);
    const dispatch = await orchestrator.dispatch({
      challengeId: challenge.id,
      input: "starter",
      expectedOutput: "artifact",
    });
    const reviewPromise = orchestrator.recordReview({
      dispatchId: dispatch.id,
      outcome: "returned",
      reason: "Needs human judgment",
      reviewerName: "Ana",
    });
    while (orchestrator.world.escalations.length === 0) {
      await Promise.resolve();
    }
    const escalation = orchestrator.world.escalations[0];
    orchestrator.answerHuman(escalation?.id ?? "", "Proceed with less scope");
    await reviewPromise;
    orchestrator.swapModel(
      new MockLanguageModelV3({
        modelId: "replacement",
        doGenerate: textResult(),
      })
    );
    const events = await eventsPromise;

    expect(events.map((event) => event.type)).toEqual([
      "challenge.created",
      "draft.added",
      "draft.added",
      "decision.recorded",
      "dispatch.sent",
      "review.recorded",
      "escalation.raised",
      "escalation.answered",
      "model.swapped",
    ]);
    expect(events.map((event) => event.sequence)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  test("hydrates world state and reuses restored sessions without replay", async () => {
    const first = createFixture();
    const challenge = createChallenge(first.orchestrator);
    recordDecision(first.orchestrator, challenge.id);
    const dispatch = await first.orchestrator.dispatch({
      challengeId: challenge.id,
      input: "starter",
      expectedOutput: "artifact",
    });
    const restoredTransport = new MemoryHarnessTransport();
    await restoredTransport.open({ squadId: "alpha" });
    const restored = new Orchestrator({
      model: new MockLanguageModelV3({ doGenerate: textResult() }),
      squads,
      rounds,
      transports: {
        alpha: restoredTransport,
        beta: new MemoryHarnessTransport(),
      },
      initialState: first.orchestrator.world,
      restoredSessions: { alpha: dispatch.sessionId },
    });

    expect(restored.world.dispatches).toEqual([dispatch]);
    expect(restoredTransport.prompts).toHaveLength(0);
    await restored.recordReview({
      dispatchId: dispatch.id,
      outcome: "returned",
      reason: "Adjust the entrance",
      reviewerName: "Ana",
    });
    expect(restoredTransport.prompts[0]?.sessionId).toBe(dispatch.sessionId);
  });

  test("delivers a persisted handoff on the first run after restart", async () => {
    const model = new MockLanguageModelV3({
      modelId: "restored-model",
      doGenerate: textResult(),
    });
    const { orchestrator } = createFixture({ model });
    const restarted = new Orchestrator({
      model,
      squads,
      rounds,
      transports: {
        alpha: new MemoryHarnessTransport(),
        beta: new MemoryHarnessTransport(),
      },
      initialState: orchestrator.world,
      initialHandoff: '{"squads":[{"id":"alpha"}],"pending":[]}',
    });

    await restarted.run("Continue the festival");

    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain("Handoff from the previous model");
    expect(prompt).toContain("Continue the festival");
    await restarted.run("Second request");
    expect(JSON.stringify(model.doGenerateCalls[1]?.prompt)).not.toContain(
      "Handoff from the previous model"
    );
  });
});
