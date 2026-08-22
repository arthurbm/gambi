import { and, asc, eq, sql } from "drizzle-orm";

import { roundNumberForPhase } from "../domain/phase";
import { roundSeed, SEEDED_ROUNDS } from "../domain/rounds";
import type { BoardDatabase } from "./client";
import {
  boardConfig,
  challenges,
  decisionDrafts,
  decisions,
  dispatches,
  drafts,
  escalations,
  events,
  harnessParticipants,
  memberships,
  orchestratorSteerers,
  people,
  reviews,
  rounds,
  squads,
  steerers,
} from "./schema";

const MAX_RETURNS = 2;

interface AgentDecision {
  id: string;
  challengeId: string;
  squadId: string;
  roundId: string;
  build: string;
  cut: string;
  reason: string;
  consideredDraftIds: string[];
  steererName: string;
}

interface DispatchPayload {
  objective: string;
  input: string;
  expectedOutput: string;
  constraints: string[];
  decision: AgentDecision;
}

interface Actor {
  id: string;
  name: string;
}

export interface WorkflowView {
  roundId: string;
  maxReturns: number;
  orchestratorSteerer: { personId: string; personName: string } | null;
  challenges: Array<{
    id: string;
    squadId: string;
    roundId: string;
    objective: string;
    status: string;
    drafts: Array<{
      id: string;
      authorPersonId: string | null;
      authorName: string;
      origin: string;
      content: string;
      seeded: boolean;
    }>;
    decision: {
      id: string;
      build: string;
      cut: string;
      reason: string;
      consideredDraftIds: string[];
      steererPersonId: string;
      steererName: string;
    } | null;
    dispatch: {
      id: string;
      participantId: string;
      sessionId: string;
      payload: DispatchPayload;
      status: string;
      reviews: Array<{
        id: string;
        outcome: string;
        reason: string | null;
        reviewerPersonId: string;
        reviewerName: string;
        createdAt: string;
      }>;
    } | null;
  }>;
  escalations: Array<{
    id: string;
    dispatchId: string;
    squadId: string;
    roundId: string;
    question: string;
    reason: string;
    returnCount: number;
    status: string;
    response: string | null;
    responderPersonId: string | null;
    responderName: string | null;
    createdAt: string;
    answeredAt: string | null;
  }>;
}

function parsePayload(value: string): DispatchPayload {
  return JSON.parse(value) as DispatchPayload;
}

function stableId(kind: string, ...parts: string[]) {
  return `${kind}-${parts.join("-")}`;
}

export class WorkflowRepository {
  private readonly db: BoardDatabase;

  constructor(db: BoardDatabase) {
    this.db = db;
  }

  async initialize() {
    await this.ensureSeeds();
  }

  private async ensureSeeds() {
    const squadRows = await this.db.select().from(squads);
    await this.db.transaction(async (tx) => {
      for (const round of SEEDED_ROUNDS) {
        for (const squad of squadRows) {
          const roundId = `round-${round.number}`;
          const challengeId = stableId("challenge", roundId, squad.id);
          await tx
            .insert(challenges)
            .values({
              id: challengeId,
              squadId: squad.id,
              roundId,
              objective: round.challenge,
            })
            .onConflictDoNothing();
          for (const [index, proposal] of round.proposals.entries()) {
            await tx
              .insert(drafts)
              .values({
                id: stableId("draft", roundId, squad.id, String(index + 1)),
                challengeId,
                authorName: "Orquestrador",
                origin: "harness",
                content: proposal,
                seeded: true,
              })
              .onConflictDoNothing();
          }
        }
      }
    });
  }

  async activeRoundId() {
    const [config] = await this.db
      .select()
      .from(boardConfig)
      .where(eq(boardConfig.id, 1));
    const number = config
      ? roundNumberForPhase(config.currentPhase as never)
      : null;
    return `round-${number ?? 1}`;
  }

  async getView(roundId?: string): Promise<WorkflowView> {
    await this.ensureSeeds();
    const selectedRoundId = roundId ?? (await this.activeRoundId());
    const [
      challengeRows,
      draftRows,
      decisionRows,
      decisionDraftRows,
      dispatchRows,
      reviewRows,
      escalationRows,
      steererRows,
      activeSquadRows,
    ] = await Promise.all([
      this.db
        .select()
        .from(challenges)
        .where(eq(challenges.roundId, selectedRoundId))
        .orderBy(asc(challenges.squadId)),
      this.db
        .select()
        .from(drafts)
        .innerJoin(challenges, eq(drafts.challengeId, challenges.id))
        .where(eq(challenges.roundId, selectedRoundId))
        .then((rows) => rows.map((row) => row.drafts)),
      this.db
        .select()
        .from(decisions)
        .where(eq(decisions.roundId, selectedRoundId)),
      this.db.select().from(decisionDrafts),
      this.db
        .select()
        .from(dispatches)
        .where(eq(dispatches.roundId, selectedRoundId)),
      this.db.select().from(reviews),
      this.db
        .select()
        .from(escalations)
        .where(eq(escalations.roundId, selectedRoundId))
        .orderBy(asc(escalations.createdAt)),
      this.db
        .select()
        .from(orchestratorSteerers)
        .where(eq(orchestratorSteerers.roundId, selectedRoundId)),
      this.db
        .select({ id: squads.id })
        .from(squads)
        .where(eq(squads.active, true)),
    ]);
    const activeSquadIds = new Set(activeSquadRows.map((squad) => squad.id));
    return {
      roundId: selectedRoundId,
      maxReturns: MAX_RETURNS,
      orchestratorSteerer: steererRows[0]
        ? {
            personId: steererRows[0].personId,
            personName: steererRows[0].personName,
          }
        : null,
      challenges: challengeRows
        .filter((challenge) => activeSquadIds.has(challenge.squadId))
        .map((challenge) => {
          const decision = decisionRows.find(
            (item) => item.challengeId === challenge.id
          );
          const dispatch = dispatchRows.find(
            (item) => item.challengeId === challenge.id
          );
          return {
            ...challenge,
            drafts: draftRows.filter(
              (draft) => draft.challengeId === challenge.id
            ),
            decision: decision
              ? {
                  id: decision.id,
                  build: decision.build,
                  cut: decision.cut,
                  reason: decision.reason,
                  consideredDraftIds: decisionDraftRows
                    .filter((item) => item.decisionId === decision.id)
                    .map((item) => item.draftId),
                  steererPersonId: decision.steererPersonId,
                  steererName: decision.steererName,
                }
              : null,
            dispatch: dispatch
              ? {
                  id: dispatch.id,
                  participantId: dispatch.participantId,
                  sessionId: dispatch.sessionId,
                  payload: parsePayload(dispatch.payload),
                  status: dispatch.status,
                  reviews: reviewRows.filter(
                    (review) => review.dispatchId === dispatch.id
                  ),
                }
              : null,
          };
        }),
      escalations: escalationRows,
    };
  }

  async selectOrchestratorSteerer(input: {
    actorPersonId: string;
    personId: string;
  }) {
    const actor = await this.requirePerson(input.actorPersonId);
    const target = await this.requirePerson(input.personId);
    const roundId = await this.activeRoundId();
    const revision = await this.db.transaction(async (tx) => {
      await tx
        .insert(orchestratorSteerers)
        .values({
          roundId,
          personId: target.id,
          personName: target.name,
          selectedByPersonId: actor.id,
        })
        .onConflictDoUpdate({
          target: orchestratorSteerers.roundId,
          set: {
            personId: target.id,
            personName: target.name,
            selectedByPersonId: actor.id,
            selectedAt: new Date().toISOString(),
          },
        });
      return this.appendEvent(
        tx,
        "orchestrator.steerer.selected",
        { roundId, personId: target.id, personName: target.name },
        actor
      );
    });
    return { roundId, personId: target.id, personName: target.name, revision };
  }

  async updateChallenge(input: {
    actorPersonId: string;
    challengeId: string;
    objective: string;
  }) {
    const { actor, challenge } = await this.requireOrchestratorChallenge(
      input.actorPersonId,
      input.challengeId
    );
    if (challenge.status !== "draft") {
      throw new Error("O desafio já foi enviado aos squads.");
    }
    const revision = await this.db.transaction(async (tx) => {
      await tx
        .update(challenges)
        .set({
          objective: input.objective.trim(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(challenges.id, challenge.id));
      return this.appendEvent(
        tx,
        "challenge.edited",
        { challengeId: challenge.id, objective: input.objective.trim() },
        actor
      );
    });
    return { challengeId: challenge.id, revision };
  }

  async proposeChallenges(input: { actorPersonId: string; objective: string }) {
    const actor = await this.requireOrchestratorSteerer(input.actorPersonId);
    const roundId = await this.activeRoundId();
    const seed = roundSeed(roundId);
    const revision = await this.db.transaction(async (tx) => {
      const roundChallenges = await tx
        .select()
        .from(challenges)
        .where(eq(challenges.roundId, roundId));
      for (const challenge of roundChallenges) {
        if (challenge.status !== "draft") {
          throw new Error("Os desafios desta rodada já foram enviados.");
        }
        const objective = `${input.objective.trim()}\n\n${seed?.challenge ?? challenge.objective}`;
        await tx
          .update(challenges)
          .set({ objective, updatedAt: new Date().toISOString() })
          .where(eq(challenges.id, challenge.id));
      }
      return this.appendEvent(
        tx,
        "challenges.proposed",
        { roundId, objective: input.objective.trim() },
        actor
      );
    });
    return { roundId, revision };
  }

  async publishChallenges(actorPersonId: string) {
    const actor = await this.requireOrchestratorSteerer(actorPersonId);
    const roundId = await this.activeRoundId();
    const revision = await this.db.transaction(async (tx) => {
      await tx
        .update(challenges)
        .set({ status: "published", updatedAt: new Date().toISOString() })
        .where(eq(challenges.roundId, roundId));
      return this.appendEvent(tx, "challenges.published", { roundId }, actor);
    });
    return { roundId, revision };
  }

  async createDraft(input: {
    actorPersonId: string;
    challengeId: string;
    content: string;
    origin: "human" | "harness";
  }) {
    const { actor } = await this.requireChallengeMember(
      input.actorPersonId,
      input.challengeId
    );
    const id = crypto.randomUUID();
    const revision = await this.db.transaction(async (tx) => {
      await tx.insert(drafts).values({
        id,
        challengeId: input.challengeId,
        authorPersonId: actor.id,
        authorName: actor.name,
        origin: input.origin,
        content: input.content.trim(),
        seeded: false,
      });
      return this.appendEvent(
        tx,
        "draft.created",
        { id, challengeId: input.challengeId, origin: input.origin },
        actor
      );
    });
    return { id, revision };
  }

  async recordDecision(input: {
    actorPersonId: string;
    challengeId: string;
    build: string;
    cut: string;
    reason: string;
    consideredDraftIds: string[];
  }) {
    const { actor, challenge } = await this.requireSquadSteerer(
      input.actorPersonId,
      input.challengeId
    );
    if (challenge.status !== "published") {
      throw new Error(
        "O orquestrador precisa enviar o desafio antes da decisão."
      );
    }
    const selectedDrafts = await this.db
      .select()
      .from(drafts)
      .where(eq(drafts.challengeId, challenge.id));
    if (
      input.consideredDraftIds.length === 0 ||
      input.consideredDraftIds.some(
        (id) => !selectedDrafts.some((draft) => draft.id === id)
      )
    ) {
      throw new Error(
        "Marque pelo menos um draft deste desafio como considerado."
      );
    }
    const id = stableId("decision", challenge.id);
    const revision = await this.db.transaction(async (tx) => {
      await tx
        .insert(decisions)
        .values({
          id,
          challengeId: challenge.id,
          squadId: challenge.squadId,
          roundId: challenge.roundId,
          build: input.build.trim(),
          cut: input.cut.trim(),
          reason: input.reason.trim(),
          steererPersonId: actor.id,
          steererName: actor.name,
        })
        .onConflictDoUpdate({
          target: decisions.challengeId,
          set: {
            build: input.build.trim(),
            cut: input.cut.trim(),
            reason: input.reason.trim(),
            steererPersonId: actor.id,
            steererName: actor.name,
            updatedAt: new Date().toISOString(),
          },
        });
      await tx.delete(decisionDrafts).where(eq(decisionDrafts.decisionId, id));
      await tx.insert(decisionDrafts).values(
        input.consideredDraftIds.map((draftId) => ({
          decisionId: id,
          draftId,
        }))
      );
      return this.appendEvent(
        tx,
        "decision.recorded",
        {
          id,
          challengeId: challenge.id,
          consideredDraftIds: input.consideredDraftIds,
        },
        actor
      );
    });
    return { id, revision };
  }

  async prepareDispatch(input: {
    actorPersonId: string;
    challengeId: string;
    participantId: string;
    sessionId: string;
    expectedOutput: string;
    constraints: string[];
  }) {
    const { actor, challenge } = await this.requireSquadSteerer(
      input.actorPersonId,
      input.challengeId
    );
    const [decision] = await this.db
      .select()
      .from(decisions)
      .where(eq(decisions.challengeId, challenge.id));
    if (!decision) {
      throw new Error(
        "Responda às quatro perguntas da decisão antes do dispatch."
      );
    }
    const [existingDispatch] = await this.db
      .select()
      .from(dispatches)
      .where(eq(dispatches.challengeId, challenge.id));
    if (existingDispatch) {
      throw new Error(
        "Este desafio já tem um dispatch. Use o chat ou devolva a revisão na mesma sessão."
      );
    }
    const consideredDraftIds = (
      await this.db
        .select()
        .from(decisionDrafts)
        .where(eq(decisionDrafts.decisionId, decision.id))
    ).map((item) => item.draftId);
    const agentDecision: AgentDecision = {
      id: decision.id,
      challengeId: challenge.id,
      squadId: challenge.squadId,
      roundId: challenge.roundId,
      build: decision.build,
      cut: decision.cut,
      reason: decision.reason,
      consideredDraftIds,
      steererName: decision.steererName,
    };
    const payload: DispatchPayload = {
      objective: challenge.objective,
      input: agentDecision.build,
      expectedOutput: input.expectedOutput.trim(),
      constraints: input.constraints,
      decision: agentDecision,
    };
    const id = stableId("dispatch", challenge.id);
    const revision = await this.db.transaction(async (tx) => {
      await tx
        .insert(dispatches)
        .values({
          id,
          challengeId: challenge.id,
          squadId: challenge.squadId,
          roundId: challenge.roundId,
          participantId: input.participantId,
          sessionId: input.sessionId,
          payload: JSON.stringify(payload),
          status: "pending",
        })
        .onConflictDoNothing();
      return this.appendEvent(
        tx,
        "dispatch.prepared",
        {
          id,
          challengeId: challenge.id,
          participantId: input.participantId,
          sessionId: input.sessionId,
          payload,
        },
        actor
      );
    });
    return { id, payload, revision };
  }

  async setDispatchStatus(
    dispatchId: string,
    status: "sent" | "delivery_unknown"
  ) {
    await this.db
      .update(dispatches)
      .set({ status, updatedAt: new Date().toISOString() })
      .where(eq(dispatches.id, dispatchId));
  }

  async recordReview(input: {
    actorPersonId: string;
    dispatchId: string;
    outcome: "accepted" | "returned";
    reason?: string;
  }) {
    const [dispatch] = await this.db
      .select()
      .from(dispatches)
      .where(eq(dispatches.id, input.dispatchId));
    if (!dispatch) {
      throw new Error("Dispatch não encontrado.");
    }
    const { actor } = await this.requireSquadSteerer(
      input.actorPersonId,
      dispatch.challengeId
    );
    if (input.outcome === "returned" && !input.reason?.trim()) {
      throw new Error("Explique o motivo da devolução.");
    }
    const normalizedReason = input.reason?.trim();
    const [existingReview] = await this.db
      .select()
      .from(reviews)
      .where(
        and(
          eq(reviews.dispatchId, dispatch.id),
          eq(reviews.outcome, input.outcome),
          normalizedReason
            ? eq(reviews.reason, normalizedReason)
            : sql`${reviews.reason} IS NULL`
        )
      );
    if (existingReview) {
      const [existingEscalation] = await this.db
        .select()
        .from(escalations)
        .where(eq(escalations.dispatchId, dispatch.id));
      return {
        reviewId: existingReview.id,
        revision: await this.currentRevision(),
        returnCount: existingEscalation?.returnCount ?? 0,
        escalationId: existingEscalation?.id,
        sessionId: dispatch.sessionId,
        squadId: dispatch.squadId,
        duplicate: true,
      };
    }
    const returnCount =
      input.outcome === "returned"
        ? Number(
            (
              await this.db
                .select({ count: sql<number>`count(*)` })
                .from(reviews)
                .where(
                  and(
                    eq(reviews.dispatchId, dispatch.id),
                    eq(reviews.outcome, "returned")
                  )
                )
            )[0]?.count ?? 0
          ) + 1
        : 0;
    const reviewId = crypto.randomUUID();
    const escalationId =
      returnCount >= MAX_RETURNS ? crypto.randomUUID() : undefined;
    const revision = await this.db.transaction(async (tx) => {
      await tx.insert(reviews).values({
        id: reviewId,
        dispatchId: dispatch.id,
        outcome: input.outcome,
        reason: normalizedReason,
        reviewerPersonId: actor.id,
        reviewerName: actor.name,
      });
      if (input.outcome === "accepted") {
        await tx
          .update(dispatches)
          .set({ status: "accepted", updatedAt: new Date().toISOString() })
          .where(eq(dispatches.id, dispatch.id));
      }
      if (escalationId) {
        await tx.insert(escalations).values({
          id: escalationId,
          dispatchId: dispatch.id,
          squadId: dispatch.squadId,
          roundId: dispatch.roundId,
          question: `O squad ${dispatch.squadId} devolveu o trabalho ${returnCount} vezes. Como o orquestrador deve seguir?`,
          reason: normalizedReason ?? "Devoluções repetidas",
          returnCount,
        });
      }
      return this.appendEvent(
        tx,
        input.outcome === "accepted" ? "review.accepted" : "review.returned",
        {
          reviewId,
          dispatchId: dispatch.id,
          reason: input.reason,
          returnCount,
          escalationId,
        },
        actor
      );
    });
    return {
      reviewId,
      revision,
      returnCount,
      escalationId,
      sessionId: dispatch.sessionId,
      squadId: dispatch.squadId,
      duplicate: false,
    };
  }

  async answerEscalation(input: {
    actorPersonId: string;
    escalationId: string;
    response: string;
  }) {
    const actor = await this.requireOrchestratorSteerer(input.actorPersonId);
    const [escalation] = await this.db
      .select()
      .from(escalations)
      .where(eq(escalations.id, input.escalationId));
    if (!escalation || escalation.status !== "pending") {
      throw new Error("Esta pendência já foi respondida ou não existe.");
    }
    const revision = await this.db.transaction(async (tx) => {
      await tx
        .update(escalations)
        .set({
          status: "answered",
          response: input.response.trim(),
          responderPersonId: actor.id,
          responderName: actor.name,
          answeredAt: new Date().toISOString(),
        })
        .where(eq(escalations.id, escalation.id));
      return this.appendEvent(
        tx,
        "escalation.answered",
        { escalationId: escalation.id, response: input.response.trim() },
        actor
      );
    });
    return { escalationId: escalation.id, revision };
  }

  async ownedHarness(personId: string) {
    const [harness] = await this.db
      .select()
      .from(harnessParticipants)
      .where(eq(harnessParticipants.ownerPersonId, personId));
    if (!harness) {
      throw new Error("Reivindique seu harness antes de pedir um draft.");
    }
    return harness;
  }

  async toWorldState() {
    const [squadRows, roundRows, view] = await Promise.all([
      this.db.select().from(squads).where(eq(squads.active, true)),
      this.db.select().from(rounds),
      this.getView(),
    ]);
    return {
      squads: squadRows.map((squad) => ({
        id: squad.id,
        name: squad.name,
        memberNames: [],
      })),
      rounds: roundRows.map((round) => ({
        id: `round-${round.number}`,
        name: round.title,
        objective: roundSeed(`round-${round.number}`)?.challenge ?? round.title,
      })),
      challenges: view.challenges.map((challenge) => ({
        id: challenge.id,
        squadId: challenge.squadId,
        roundId: challenge.roundId,
        objective: challenge.objective,
        seededDraftIds: challenge.drafts
          .filter((draft) => draft.seeded)
          .map((draft) => draft.id),
        status:
          challenge.status === "draft"
            ? ("draft" as const)
            : ("dispatched" as const),
      })),
      drafts: view.challenges.flatMap((challenge) =>
        challenge.drafts.map((draft) => ({
          id: draft.id,
          challengeId: challenge.id,
          authorName: draft.authorName,
          origin:
            draft.origin === "human"
              ? ("human" as const)
              : ("harness" as const),
          content: draft.content,
        }))
      ),
      decisions: view.challenges.flatMap((challenge) =>
        challenge.decision
          ? [
              {
                id: challenge.decision.id,
                challengeId: challenge.id,
                squadId: challenge.squadId,
                roundId: challenge.roundId,
                build: challenge.decision.build,
                cut: challenge.decision.cut,
                reason: challenge.decision.reason,
                consideredDraftIds: challenge.decision.consideredDraftIds,
                steererName: challenge.decision.steererName,
              },
            ]
          : []
      ),
      dispatches: view.challenges.flatMap((challenge) =>
        challenge.dispatch
          ? [
              {
                id: challenge.dispatch.id,
                challengeId: challenge.id,
                squadId: challenge.squadId,
                roundId: challenge.roundId,
                sessionId: challenge.dispatch.sessionId,
                payload: challenge.dispatch.payload,
              },
            ]
          : []
      ),
      reviews: view.challenges.flatMap(
        (challenge) =>
          challenge.dispatch?.reviews.map((review) => ({
            id: review.id,
            dispatchId: challenge.dispatch?.id ?? "",
            squadId: challenge.squadId,
            roundId: challenge.roundId,
            outcome:
              review.outcome === "accepted"
                ? ("accepted" as const)
                : ("returned" as const),
            reason: review.reason ?? undefined,
            reviewerName: review.reviewerName,
          })) ?? []
      ),
      escalations: view.escalations.map((escalation) => ({
        id: escalation.id,
        squadId: escalation.squadId,
        roundId: escalation.roundId,
        question: escalation.question,
        reason: escalation.reason,
        returnCount: escalation.returnCount,
        status:
          escalation.status === "answered"
            ? ("answered" as const)
            : ("pending" as const),
        response: escalation.response ?? undefined,
      })),
    };
  }

  private async requirePerson(personId: string): Promise<Actor> {
    const [person] = await this.db
      .select()
      .from(people)
      .where(eq(people.id, personId));
    if (!person) {
      throw new Error("Registre seu nome antes desta ação.");
    }
    return person;
  }

  private async currentRevision() {
    const [row] = await this.db
      .select({ revision: sql<number>`coalesce(max(${events.sequence}), 0)` })
      .from(events);
    return Number(row?.revision ?? 0);
  }

  private async requireChallengeMember(personId: string, challengeId: string) {
    const actor = await this.requirePerson(personId);
    const [challenge] = await this.db
      .select()
      .from(challenges)
      .where(eq(challenges.id, challengeId));
    if (!challenge) {
      throw new Error("Desafio não encontrado.");
    }
    const [membership] = await this.db
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.personId, personId),
          eq(memberships.squadId, challenge.squadId)
        )
      );
    if (!membership) {
      throw new Error("A pessoa precisa fazer parte deste squad.");
    }
    return { actor, challenge };
  }

  private async requireSquadSteerer(personId: string, challengeId: string) {
    const value = await this.requireChallengeMember(personId, challengeId);
    const [steerer] = await this.db
      .select()
      .from(steerers)
      .where(
        and(
          eq(steerers.squadId, value.challenge.squadId),
          eq(steerers.roundId, value.challenge.roundId)
        )
      );
    if (steerer?.personId !== personId) {
      throw new Error(
        steerer
          ? `Somente ${steerer.personName}, steerer deste squad, pode decidir.`
          : "Eleja o steerer deste squad primeiro."
      );
    }
    return value;
  }

  private async requireOrchestratorSteerer(personId: string) {
    const actor = await this.requirePerson(personId);
    const roundId = await this.activeRoundId();
    const [steerer] = await this.db
      .select()
      .from(orchestratorSteerers)
      .where(eq(orchestratorSteerers.roundId, roundId));
    if (steerer?.personId !== personId) {
      throw new Error(
        steerer
          ? `Somente ${steerer.personName}, steerer do orquestrador, pode fazer isso.`
          : "Selecione o steerer do orquestrador para esta rodada."
      );
    }
    return actor;
  }

  private async requireOrchestratorChallenge(
    personId: string,
    challengeId: string
  ) {
    const actor = await this.requireOrchestratorSteerer(personId);
    const [challenge] = await this.db
      .select()
      .from(challenges)
      .where(eq(challenges.id, challengeId));
    if (!challenge || challenge.roundId !== (await this.activeRoundId())) {
      throw new Error("Desafio não encontrado nesta rodada.");
    }
    return { actor, challenge };
  }

  private async appendEvent(
    tx: Parameters<Parameters<BoardDatabase["transaction"]>[0]>[0],
    type: string,
    payload: Record<string, unknown>,
    actor: Actor
  ) {
    const [event] = await tx
      .insert(events)
      .values({
        type,
        actorPersonId: actor.id,
        actorName: actor.name,
        payload: JSON.stringify(payload),
      })
      .returning({ sequence: events.sequence });
    if (!event) {
      throw new Error("Audit event was not written");
    }
    return event.sequence;
  }
}
