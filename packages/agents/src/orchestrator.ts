import {
  type LanguageModel,
  stepCountIs,
  ToolLoopAgent,
  type ToolSet,
  tool,
} from "ai";
import { z } from "zod";
import { AsyncEventStream } from "./async-event-stream.ts";
import type { HarnessTransport } from "./transport.ts";
import type {
  Challenge,
  CreateChallengeInput,
  Decision,
  Dispatch,
  DomainEvent,
  Draft,
  Escalation,
  RecordDecisionInput,
  RecordReviewInput,
  Review,
  Round,
  SendDispatchInput,
  Squad,
  WorldState,
} from "./types.ts";

const COORDINATION_INSTRUCTIONS = `You coordinate independent squads and their harnesses.
Inspect the world before acting. A dispatch is only valid after the squad has recorded a decision.
Use askHuman whenever judgment or steering is needed; it is the only steering channel.
Never invent a human decision. Finish once the requested coordination work is complete.`;

interface PendingHumanAnswer {
  escalation: Escalation;
  reject: (error: Error) => void;
  resolve: (answer: string) => void;
}

interface HumanQuestion {
  answer: Promise<string>;
  escalation: Escalation;
}

type DomainEventInput = DomainEvent extends infer Event
  ? Event extends DomainEvent
    ? Omit<Event, "sequence">
    : never
  : never;

export interface OrchestratorOptions {
  model: LanguageModel;
  squads: Squad[];
  rounds: Round[];
  transports: Record<string, HarnessTransport>;
  initialState?: WorldState;
  initialHandoff?: string;
  restoredSessions?: Record<string, string>;
  maxReturns?: number;
  generateId?: (kind: string) => string;
}

export interface AskHumanInput {
  squadId: string;
  roundId: string;
  question: string;
  reason: string;
  returnCount?: number;
}

export interface ReviewResult {
  escalation?: Escalation;
  humanResponse?: string;
  review: Review;
}

interface FinishInput {
  summary: string;
  challenges?: CreateChallengeInput[];
}

interface FinishOutput {
  summary: string;
  challenges: Challenge[];
}

type AgentTool<Input, Output> = ReturnType<typeof tool<Input, Output>>;

interface OrchestratorToolSet extends ToolSet {
  listSquads: AgentTool<Record<string, never>, Squad[]>;
  dispatch: AgentTool<SendDispatchInput, Dispatch>;
  readWorld: AgentTool<Record<string, never>, WorldState>;
  askHuman: AgentTool<AskHumanInput, string>;
  finish: AgentTool<FinishInput, FinishOutput>;
}

const seededDraftSchema = z.object({
  authorName: z.string().optional(),
  content: z.string().min(1),
  origin: z.enum(["human", "harness"]).optional(),
});

const challengeSchema = z.object({
  id: z.string().optional(),
  squadId: z.string(),
  roundId: z.string(),
  objective: z.string().min(1),
  seededDrafts: z.array(seededDraftSchema).min(2).max(3),
});

export class Orchestrator {
  readonly #challenges = new Map<string, Challenge>();
  readonly #decisions = new Map<string, Decision>();
  readonly #dispatches = new Map<string, Dispatch>();
  readonly #drafts = new Map<string, Draft>();
  readonly #escalations = new Map<string, Escalation>();
  readonly #eventStream = new AsyncEventStream<DomainEvent>();
  readonly #pendingHumanAnswers = new Map<string, PendingHumanAnswer>();
  readonly #reviews = new Map<string, Review>();
  readonly #rounds: Map<string, Round>;
  readonly #sessions = new Map<string, string>();
  readonly #squads: Map<string, Squad>;
  readonly #transports: Record<string, HarnessTransport>;
  readonly #generateId: (kind: string) => string;
  readonly maxReturns: number;
  readonly events: AsyncIterable<DomainEvent> = this.#eventStream;
  #agent: ToolLoopAgent<never, OrchestratorToolSet, never>;
  #handoff?: string;
  #model: LanguageModel;
  #sequence = 0;
  #closed = false;

  constructor(options: OrchestratorOptions) {
    if (
      !Number.isInteger(options.maxReturns ?? 2) ||
      (options.maxReturns ?? 2) < 1
    ) {
      throw new Error("maxReturns must be a positive integer.");
    }

    this.#squads = new Map(
      options.squads.map((squad) => [squad.id, structuredClone(squad)])
    );
    this.#rounds = new Map(
      options.rounds.map((round) => [round.id, structuredClone(round)])
    );
    this.#transports = options.transports;
    this.maxReturns = options.maxReturns ?? 2;
    let nextId = 0;
    this.#generateId =
      options.generateId ??
      ((kind) => {
        nextId += 1;
        return `${kind}-${nextId}`;
      });
    this.#model = options.model;
    this.#agent = this.createAgent(options.model);
    this.hydrate(options.initialState, options.restoredSessions);
    this.#handoff = options.initialHandoff;

    for (const squad of options.squads) {
      const transport = options.transports[squad.id];
      if (!transport) {
        throw new Error(`Missing harness transport for squad ${squad.id}.`);
      }
      this.forwardHarnessEvents(squad.id, transport).catch(() => undefined);
    }
  }

  get agent(): ToolLoopAgent<never, OrchestratorToolSet, never> {
    return this.#agent;
  }

  get world(): WorldState {
    return structuredClone({
      squads: [...this.#squads.values()],
      rounds: [...this.#rounds.values()],
      challenges: [...this.#challenges.values()],
      drafts: [...this.#drafts.values()],
      decisions: [...this.#decisions.values()],
      dispatches: [...this.#dispatches.values()],
      reviews: [...this.#reviews.values()],
      escalations: [...this.#escalations.values()],
    });
  }

  run(prompt: string) {
    const handoff = this.#handoff;
    this.#handoff = undefined;
    const contextualPrompt = handoff
      ? `Handoff from the previous model:\n${handoff}\n\nCurrent request:\n${prompt}`
      : prompt;
    return this.#agent.generate({ prompt: contextualPrompt });
  }

  createChallenge(input: CreateChallengeInput): Challenge {
    this.requireSquad(input.squadId);
    this.requireRound(input.roundId);
    if (input.seededDrafts.length < 2 || input.seededDrafts.length > 3) {
      throw new Error("A challenge must have 2 or 3 seeded drafts.");
    }

    const challengeId = input.id ?? this.#generateId("challenge");
    if (this.#challenges.has(challengeId)) {
      throw new Error(`Challenge ${challengeId} already exists.`);
    }

    const challenge: Challenge = {
      id: challengeId,
      squadId: input.squadId,
      roundId: input.roundId,
      objective: input.objective,
      seededDraftIds: [],
      status: "draft",
    };
    this.#challenges.set(challenge.id, challenge);
    this.emit({ type: "challenge.created", challenge });

    for (const seeded of input.seededDrafts) {
      const draft = this.addDraft({
        challengeId: challenge.id,
        authorName: seeded.authorName ?? "orchestrator",
        origin: seeded.origin ?? "harness",
        content: seeded.content,
      });
      challenge.seededDraftIds.push(draft.id);
    }

    return challenge;
  }

  updateChallenge(challengeId: string, objective: string): Challenge {
    const challenge = this.requireEditableChallenge(challengeId);
    challenge.objective = objective;
    return challenge;
  }

  addDraft(input: Omit<Draft, "id"> & { id?: string }): Draft {
    const challenge = this.requireEditableChallenge(input.challengeId);
    const draft: Draft = {
      id: input.id ?? this.#generateId("draft"),
      challengeId: challenge.id,
      authorName: input.authorName,
      origin: input.origin,
      content: input.content,
    };
    if (this.#drafts.has(draft.id)) {
      throw new Error(`Draft ${draft.id} already exists.`);
    }
    this.#drafts.set(draft.id, draft);
    this.emit({ type: "draft.added", draft });
    return draft;
  }

  updateDraft(draftId: string, content: string): Draft {
    const draft = this.#drafts.get(draftId);
    if (!draft) {
      throw new Error(`Unknown draft ${draftId}.`);
    }
    this.requireEditableChallenge(draft.challengeId);
    draft.content = content;
    return draft;
  }

  recordDecision(input: RecordDecisionInput): Decision {
    const challenge = this.requireEditableChallenge(input.challengeId);
    for (const draftId of input.consideredDraftIds) {
      const draft = this.#drafts.get(draftId);
      if (!draft || draft.challengeId !== challenge.id) {
        throw new Error(
          `Draft ${draftId} does not belong to challenge ${challenge.id}.`
        );
      }
    }

    const decision: Decision = {
      id: input.id ?? this.#generateId("decision"),
      challengeId: challenge.id,
      squadId: challenge.squadId,
      roundId: challenge.roundId,
      build: input.build,
      cut: input.cut,
      reason: input.reason,
      consideredDraftIds: [...input.consideredDraftIds],
      steererName: input.steererName,
    };
    this.#decisions.set(challenge.id, decision);
    this.emit({ type: "decision.recorded", decision });
    return decision;
  }

  async dispatch(input: SendDispatchInput): Promise<Dispatch> {
    const challenge = this.requireChallenge(input.challengeId);
    const decision = this.#decisions.get(challenge.id);
    if (!decision) {
      throw new Error(
        `Cannot dispatch challenge ${challenge.id} before its Decision is recorded.`
      );
    }

    const transport = this.requireTransport(challenge.squadId);
    let sessionId = this.#sessions.get(challenge.squadId);
    if (!sessionId) {
      const squad = this.requireSquad(challenge.squadId);
      const session = await transport.open({
        squadId: squad.id,
        participantId: squad.harnessParticipantId,
      });
      sessionId = session.sessionId;
      this.#sessions.set(squad.id, sessionId);
    }

    const dispatch: Dispatch = {
      id: input.id ?? this.#generateId("dispatch"),
      challengeId: challenge.id,
      squadId: challenge.squadId,
      roundId: challenge.roundId,
      sessionId,
      payload: {
        objective: challenge.objective,
        input: input.input,
        expectedOutput: input.expectedOutput,
        constraints: input.constraints ?? [],
        decision,
      },
    };
    try {
      await transport.prompt(sessionId, JSON.stringify(dispatch.payload));
    } catch (error) {
      this.#sessions.delete(challenge.squadId);
      throw error;
    }
    challenge.status = "dispatched";
    this.#dispatches.set(dispatch.id, dispatch);
    this.emit({ type: "dispatch.sent", dispatch });
    return dispatch;
  }

  async recordReview(input: RecordReviewInput): Promise<ReviewResult> {
    const dispatch = this.#dispatches.get(input.dispatchId);
    if (!dispatch) {
      throw new Error(`Unknown dispatch ${input.dispatchId}.`);
    }
    if (input.outcome === "returned" && !input.reason?.trim()) {
      throw new Error("A returned review requires a reason.");
    }

    const review: Review = {
      id: input.id ?? this.#generateId("review"),
      dispatchId: dispatch.id,
      squadId: dispatch.squadId,
      roundId: dispatch.roundId,
      outcome: input.outcome,
      reason: input.reason,
      reviewerName: input.reviewerName,
    };
    this.#reviews.set(review.id, review);
    this.emit({ type: "review.recorded", review });

    if (review.outcome === "accepted") {
      return { review };
    }

    const returnCount = this.returnCount(dispatch.squadId, dispatch.roundId);
    if (returnCount >= this.maxReturns) {
      const escalation = this.createEscalation({
        squadId: dispatch.squadId,
        roundId: dispatch.roundId,
        reason: review.reason ?? "Repeated return",
        returnCount,
        question: `Squad ${dispatch.squadId} has returned work ${returnCount} times. How should the orchestrator proceed?`,
      });
      return { review, escalation };
    }

    await this.requireTransport(dispatch.squadId).prompt(
      dispatch.sessionId,
      `Returned by ${review.reviewerName}: ${review.reason}`
    );
    return { review };
  }

  askHuman(input: AskHumanInput): Promise<string> {
    return this.createHumanQuestion(input).answer;
  }

  private createHumanQuestion(input: AskHumanInput): HumanQuestion {
    const escalation = this.createEscalation(input);
    const answer = new Promise<string>((resolve, reject) => {
      this.#pendingHumanAnswers.set(escalation.id, {
        escalation,
        resolve,
        reject,
      });
    });
    return { answer, escalation };
  }

  private createEscalation(input: AskHumanInput): Escalation {
    this.requireSquad(input.squadId);
    this.requireRound(input.roundId);
    const escalation: Escalation = {
      id: this.#generateId("escalation"),
      squadId: input.squadId,
      roundId: input.roundId,
      question: input.question,
      reason: input.reason,
      returnCount: input.returnCount ?? 0,
      status: "pending",
    };
    this.#escalations.set(escalation.id, escalation);
    this.emit({ type: "escalation.raised", escalation });
    return escalation;
  }

  answerHuman(escalationId: string, response: string): void {
    const escalation = this.#escalations.get(escalationId);
    if (!escalation || escalation.status !== "pending") {
      throw new Error(`No pending human question ${escalationId}.`);
    }
    const pending = this.#pendingHumanAnswers.get(escalationId);
    if (!response.trim()) {
      throw new Error("A human response cannot be empty.");
    }
    escalation.status = "answered";
    escalation.response = response;
    this.#pendingHumanAnswers.delete(escalationId);
    pending?.resolve(response);
    this.emit({ type: "escalation.answered", escalation });
  }

  private hydrate(
    initialState?: WorldState,
    restoredSessions: Record<string, string> = {}
  ) {
    if (!initialState) {
      for (const [squadId, sessionId] of Object.entries(restoredSessions)) {
        this.requireSquad(squadId);
        this.#sessions.set(squadId, sessionId);
      }
      return;
    }
    for (const challenge of initialState.challenges) {
      this.requireSquad(challenge.squadId);
      this.requireRound(challenge.roundId);
      this.#challenges.set(challenge.id, structuredClone(challenge));
    }
    for (const draft of initialState.drafts) {
      if (!this.#challenges.has(draft.challengeId)) {
        throw new Error(`Draft ${draft.id} references an unknown challenge.`);
      }
      this.#drafts.set(draft.id, structuredClone(draft));
    }
    for (const decision of initialState.decisions) {
      if (!this.#challenges.has(decision.challengeId)) {
        throw new Error(
          `Decision ${decision.id} references an unknown challenge.`
        );
      }
      this.#decisions.set(decision.challengeId, structuredClone(decision));
    }
    for (const dispatch of initialState.dispatches) {
      if (!this.#challenges.has(dispatch.challengeId)) {
        throw new Error(
          `Dispatch ${dispatch.id} references an unknown challenge.`
        );
      }
      this.#dispatches.set(dispatch.id, structuredClone(dispatch));
      this.#sessions.set(dispatch.squadId, dispatch.sessionId);
    }
    for (const review of initialState.reviews) {
      if (!this.#dispatches.has(review.dispatchId)) {
        throw new Error(`Review ${review.id} references an unknown dispatch.`);
      }
      this.#reviews.set(review.id, structuredClone(review));
    }
    for (const escalation of initialState.escalations) {
      this.requireSquad(escalation.squadId);
      this.requireRound(escalation.roundId);
      this.#escalations.set(escalation.id, structuredClone(escalation));
    }
    for (const [squadId, sessionId] of Object.entries(restoredSessions)) {
      this.requireSquad(squadId);
      this.#sessions.set(squadId, sessionId);
    }
  }

  swapModel(model: LanguageModel, durableHandoff?: string): string {
    const previousModel = describeModel(this.#model);
    const handoff = durableHandoff ?? this.createHandoff();
    this.#model = model;
    this.#agent = this.createAgent(model);
    this.#handoff = handoff;
    this.emit({
      type: "model.swapped",
      previousModel,
      nextModel: describeModel(model),
      handoff,
    });
    return handoff;
  }

  async close(): Promise<void> {
    this.#closed = true;
    await Promise.allSettled(
      [...this.#sessions].map(([squadId, sessionId]) =>
        this.requireTransport(squadId).close(sessionId)
      )
    );
    this.#sessions.clear();
    for (const pending of this.#pendingHumanAnswers.values()) {
      pending.reject(
        new Error("Orchestrator closed before the human answered.")
      );
    }
    this.#pendingHumanAnswers.clear();
    this.#eventStream.close();
  }

  private async forwardHarnessEvents(
    squadId: string,
    transport: HarnessTransport
  ): Promise<void> {
    try {
      for await (const event of transport.events) {
        if (this.#closed) {
          return;
        }
        if (event.type === "error" && event.recoverable) {
          this.#sessions.delete(squadId);
        }
        this.emit({ type: "harness.event", squadId, event });
      }
    } catch (error) {
      if (this.#closed) {
        return;
      }
      this.emit({
        type: "harness.event",
        squadId,
        event: {
          type: "error",
          sessionId: this.#sessions.get(squadId) ?? "unknown",
          message:
            error instanceof Error
              ? error.message
              : "Harness event stream failed.",
          recoverable: true,
        },
      });
    }
  }

  private createAgent(
    model: LanguageModel
  ): ToolLoopAgent<never, OrchestratorToolSet, never> {
    const tools: OrchestratorToolSet = {
      listSquads: tool({
        description: "List the squads available for coordination.",
        inputSchema: z.object({}),
        execute: () => [...this.#squads.values()],
      }),
      dispatch: tool({
        description: "Dispatch decided work to a squad's harness.",
        inputSchema: z.object({
          challengeId: z.string(),
          input: z.string(),
          expectedOutput: z.string(),
          constraints: z.array(z.string()).optional(),
        }),
        execute: (input) => this.dispatch(input),
      }),
      readWorld: tool({
        description: "Read the current social orchestration state.",
        inputSchema: z.object({}),
        execute: () => this.world,
      }),
      askHuman: tool({
        description:
          "Pause orchestration and ask a human for the only allowed steering input.",
        inputSchema: z.object({
          squadId: z.string(),
          roundId: z.string(),
          question: z.string(),
          reason: z.string(),
          returnCount: z.number().int().nonnegative().optional(),
        }),
        execute: (input) => this.askHuman(input),
      }),
      finish: tool({
        description:
          "Finish the current task, optionally recording 2-3 seeded proposals per squad.",
        inputSchema: z.object({
          summary: z.string(),
          challenges: z.array(challengeSchema).optional(),
        }),
        execute: ({ summary, challenges = [] }) => ({
          summary,
          challenges: challenges.map((challenge) =>
            this.createChallenge(challenge)
          ),
        }),
      }),
    };

    return new ToolLoopAgent({
      id: "gambi-orchestrator",
      model,
      instructions: COORDINATION_INSTRUCTIONS,
      tools,
      stopWhen: stepCountIs(20),
    });
  }

  private createHandoff(): string {
    const decisions = [...this.#decisions.values()].map((decision) => ({
      squadId: decision.squadId,
      roundId: decision.roundId,
      build: decision.build,
      cut: decision.cut,
      reason: decision.reason,
    }));
    const pending = [...this.#challenges.values()]
      .filter((challenge) => challenge.status !== "dispatched")
      .map((challenge) => ({
        challengeId: challenge.id,
        squadId: challenge.squadId,
        roundId: challenge.roundId,
        hasDecision: this.#decisions.has(challenge.id),
      }));
    return JSON.stringify({
      squads: [...this.#squads.values()],
      decisions,
      pending,
    });
  }

  private emit(event: DomainEventInput): void {
    this.#sequence += 1;
    this.#eventStream.emit(
      structuredClone({
        ...event,
        sequence: this.#sequence,
      } as DomainEvent)
    );
  }

  private requireChallenge(challengeId: string): Challenge {
    const challenge = this.#challenges.get(challengeId);
    if (!challenge) {
      throw new Error(`Unknown challenge ${challengeId}.`);
    }
    return challenge;
  }

  private requireEditableChallenge(challengeId: string): Challenge {
    const challenge = this.requireChallenge(challengeId);
    if (challenge.status !== "draft") {
      throw new Error(
        `Challenge ${challengeId} cannot be edited after dispatch.`
      );
    }
    return challenge;
  }

  private requireRound(roundId: string): Round {
    const round = this.#rounds.get(roundId);
    if (!round) {
      throw new Error(`Unknown round ${roundId}.`);
    }
    return round;
  }

  private requireSquad(squadId: string): Squad {
    const squad = this.#squads.get(squadId);
    if (!squad) {
      throw new Error(`Unknown squad ${squadId}.`);
    }
    return squad;
  }

  private requireTransport(squadId: string): HarnessTransport {
    const transport = this.#transports[squadId];
    if (!transport) {
      throw new Error(`Missing harness transport for squad ${squadId}.`);
    }
    return transport;
  }

  private returnCount(squadId: string, roundId: string): number {
    return [...this.#reviews.values()].filter(
      (review) =>
        review.squadId === squadId &&
        review.roundId === roundId &&
        review.outcome === "returned"
    ).length;
  }
}

function describeModel(model: LanguageModel): string {
  if (typeof model === "string") {
    return model;
  }
  return `${model.provider}/${model.modelId}`;
}
