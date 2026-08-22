import type { ChallengeProposal } from "@gambi/agents";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { roundNumberForPhase } from "../domain/phase";
import { roundSeed, SEEDED_ROUNDS } from "../domain/rounds";
import type { BoardDatabase } from "./client";
import {
  boardConfig,
  challengeDependencies,
  challenges,
  decisionDrafts,
  decisions,
  dispatches,
  drafts,
  escalations,
  events,
  harnessParticipants,
  memberships,
  orchestratorModelHandoffs,
  orchestratorSteerers,
  people,
  reviews,
  rounds,
  squads,
  steerers,
  tilePublications,
  tiles,
} from "./schema";

const MAX_RETURNS = 2;
const CRISIS_ROUND_ID = "round-5";
const CRISIS_DEPENDENCY_KIND = "neighbor_crisis";

const challengeProposalSetSchema = z
  .array(
    z.object({
      objective: z.string().trim().min(1),
      roundId: z.string().trim().min(1),
      seededDrafts: z
        .array(
          z.object({
            authorName: z.string().trim().min(1),
            content: z.string().trim().min(1),
            origin: z.enum(["human", "harness"]),
          })
        )
        .min(2)
        .max(3),
      squadId: z.string().trim().min(1),
    })
  )
  .min(1);

interface RecordedDecision {
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
  decision: RecordedDecision;
}

export interface OrchestratorModelView {
  participantId: string;
  modelLabel: string;
  previousModelLabel: string;
  handoff: string;
  actorPersonId: string;
  actorName: string;
  roundId: string;
  createdAt: string;
  consumedAt: string | null;
}

export interface FinaleView {
  squads: Array<{
    id: string;
    ordinal: number;
    name: string;
    liveTile: {
      id: string;
      boardVersion: number;
      manifest: Record<string, unknown> | null;
      readme: string | null;
      sourceHarnessId: string;
      sourceModel: string | null;
    } | null;
    decisions: Array<{
      id: string;
      roundId: string;
      roundNumber: number;
      build: string;
      cut: string;
      reason: string;
      steererName: string;
    }>;
    draftCounts: { human: number; harness: number };
    returnedReviews: number;
  }>;
  totals: {
    drafts: { human: number; harness: number };
    returnedReviews: number;
  };
  orchestratorModel: OrchestratorModelView | null;
}

interface Actor {
  id: string;
  name: string;
}

type BoardTransaction = Parameters<
  Parameters<BoardDatabase["transaction"]>[0]
>[0];

export interface WorkflowView {
  roundId: string;
  maxReturns: number;
  orchestratorSteerer: { personId: string; personName: string } | null;
  orchestratorModel: OrchestratorModelView | null;
  challenges: Array<{
    id: string;
    squadId: string;
    roundId: string;
    objective: string;
    status: string;
    dependsOnSquad: { id: string; name: string } | null;
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

function crisisObjective(base: string, neighborName: string) {
  return `${base}\n\nA crise deste lote depende do squad ${neighborName}. Combine a resposta com esse vizinho antes de fechar o trabalho.`;
}

function parseJsonObject(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
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
    const squadRows = await this.db
      .select()
      .from(squads)
      .orderBy(asc(squads.ordinal));
    await this.db.transaction(async (tx) => {
      await this.seedChallenges(tx, squadRows);
      await this.reconcileCrisisDependencies(tx, squadRows);
    });
  }

  private async seedChallenges(
    tx: BoardTransaction,
    squadRows: (typeof squads.$inferSelect)[]
  ) {
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
        const [existingSeed] = await tx
          .select({ id: drafts.id })
          .from(drafts)
          .where(
            and(eq(drafts.challengeId, challengeId), eq(drafts.seeded, true))
          )
          .limit(1);
        if (existingSeed) {
          continue;
        }
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
  }

  private async reconcileCrisisDependencies(
    tx: BoardTransaction,
    squadRows: (typeof squads.$inferSelect)[]
  ) {
    await tx.delete(challengeDependencies);
    const activeSquads = squadRows.filter((squad) => squad.active);
    const crisisSeed = roundSeed(CRISIS_ROUND_ID);
    for (const [index, squad] of activeSquads.entries()) {
      const challengeId = stableId("challenge", CRISIS_ROUND_ID, squad.id);
      const nextSquad =
        activeSquads.length > 1
          ? activeSquads[(index + 1) % activeSquads.length]
          : undefined;
      const [current] = await tx
        .select({ objective: challenges.objective })
        .from(challenges)
        .where(eq(challenges.id, challengeId));
      if (!nextSquad) {
        if (
          current?.objective.includes("A crise deste lote depende do squad")
        ) {
          await tx
            .update(challenges)
            .set({ objective: crisisSeed?.challenge ?? current.objective })
            .where(eq(challenges.id, challengeId));
        }
        continue;
      }
      await tx.insert(challengeDependencies).values({
        challengeId,
        dependsOnSquadId: nextSquad.id,
        kind: CRISIS_DEPENDENCY_KIND,
      });
      if (
        current?.objective === crisisSeed?.challenge ||
        current?.objective.startsWith(
          `${crisisSeed?.challenge}\n\nA crise deste lote depende do squad`
        )
      ) {
        await tx
          .update(challenges)
          .set({
            objective: crisisObjective(
              crisisSeed?.challenge ?? current?.objective ?? "",
              nextSquad.name
            ),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(challenges.id, challengeId));
      }
    }
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
      dependencyRows,
      orchestratorModel,
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
        .select({ id: squads.id, name: squads.name, ordinal: squads.ordinal })
        .from(squads)
        .where(eq(squads.active, true))
        .orderBy(asc(squads.ordinal)),
      this.db.select().from(challengeDependencies),
      this.getOrchestratorModel(),
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
      orchestratorModel,
      challenges: challengeRows
        .filter((challenge) => activeSquadIds.has(challenge.squadId))
        .sort(
          (left, right) =>
            (activeSquadRows.find((squad) => squad.id === left.squadId)
              ?.ordinal ?? 0) -
            (activeSquadRows.find((squad) => squad.id === right.squadId)
              ?.ordinal ?? 0)
        )
        .map((challenge) => {
          const decision = decisionRows.find(
            (item) => item.challengeId === challenge.id
          );
          const dispatch = dispatchRows.find(
            (item) => item.challengeId === challenge.id
          );
          const dependency = dependencyRows.find(
            (item) => item.challengeId === challenge.id
          );
          const neighbor = activeSquadRows.find(
            (squad) => squad.id === dependency?.dependsOnSquadId
          );
          return {
            ...challenge,
            dependsOnSquad: neighbor
              ? { id: neighbor.id, name: neighbor.name }
              : null,
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

  async proposeChallenges(input: {
    actorPersonId: string;
    objective: string;
    proposals?: ChallengeProposal[];
    modelError?: string;
  }) {
    const actor = await this.requireOrchestratorSteerer(input.actorPersonId);
    const roundId = await this.activeRoundId();
    const seed = roundSeed(roundId);
    const activeSquads = await this.db
      .select({ id: squads.id })
      .from(squads)
      .where(eq(squads.active, true));
    const parsed = challengeProposalSetSchema.safeParse(input.proposals);
    const modelProposals = parsed.success
      ? parsed.data.filter((proposal) => proposal.roundId === roundId)
      : [];
    const modelSquadIds = new Set(
      modelProposals.map((proposal) => proposal.squadId)
    );
    const useModel =
      modelProposals.length === activeSquads.length &&
      modelSquadIds.size === activeSquads.length &&
      activeSquads.every((squad) => modelSquadIds.has(squad.id));
    const proposalBySquad = new Map(
      modelProposals.map((proposal) => [proposal.squadId, proposal])
    );
    const source = useModel ? ("model" as const) : ("fallback" as const);
    const warning = useModel
      ? undefined
      : (input.modelError ??
        (input.proposals
          ? "A resposta do modelo não trouxe exatamente um Challenge válido por squad; as sementes determinísticas foram mantidas."
          : "O modelo do orquestrador não está ativo; as sementes determinísticas foram mantidas."));
    const revision = await this.db.transaction(async (tx) => {
      const roundChallenges = await tx
        .select()
        .from(challenges)
        .where(eq(challenges.roundId, roundId));
      for (const challenge of roundChallenges) {
        if (challenge.status !== "draft") {
          throw new Error("Os desafios desta rodada já foram enviados.");
        }
        const [dependency] = await tx
          .select()
          .from(challengeDependencies)
          .where(eq(challengeDependencies.challengeId, challenge.id));
        const [neighbor] = dependency
          ? await tx
              .select({ name: squads.name })
              .from(squads)
              .where(eq(squads.id, dependency.dependsOnSquadId))
          : [];
        const fallbackObjective = `${input.objective.trim()}\n\n${seed?.challenge ?? challenge.objective}`;
        const proposal = useModel
          ? proposalBySquad.get(challenge.squadId)
          : undefined;
        const proposedObjective = proposal?.objective ?? fallbackObjective;
        const objective = neighbor
          ? crisisObjective(proposedObjective, neighbor.name)
          : proposedObjective;
        await tx
          .update(challenges)
          .set({ objective, updatedAt: new Date().toISOString() })
          .where(eq(challenges.id, challenge.id));
        if (proposal) {
          await tx
            .delete(drafts)
            .where(
              and(eq(drafts.challengeId, challenge.id), eq(drafts.seeded, true))
            );
          await tx.insert(drafts).values(
            proposal.seededDrafts.map((draft, index) => ({
              id: stableId(
                "draft",
                challenge.roundId,
                challenge.squadId,
                String(index + 1)
              ),
              challengeId: challenge.id,
              authorName: draft.authorName,
              origin: draft.origin,
              content: draft.content,
              seeded: true,
            }))
          );
        }
      }
      return this.appendEvent(
        tx,
        "challenges.proposed",
        { roundId, objective: input.objective.trim(), source, warning },
        actor
      );
    });
    return { roundId, revision, source, warning };
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
    const recordedDecision: RecordedDecision = {
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
    const [dependency] = await this.db
      .select()
      .from(challengeDependencies)
      .where(eq(challengeDependencies.challengeId, challenge.id));
    const [neighbor] = dependency
      ? await this.db
          .select({ name: squads.name })
          .from(squads)
          .where(eq(squads.id, dependency.dependsOnSquadId))
      : [];
    const dependencyConstraint = neighbor
      ? `Dependência de crise: coordene a solução com o squad ${neighbor.name}.`
      : undefined;
    const payload: DispatchPayload = {
      objective: challenge.objective,
      input: recordedDecision.build,
      expectedOutput: input.expectedOutput.trim(),
      constraints: dependencyConstraint
        ? [dependencyConstraint, ...input.constraints]
        : input.constraints,
      decision: recordedDecision,
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

  async assertCanSwapModel(input: {
    actorPersonId: string;
    participantId: string;
  }) {
    const actor = await this.requireOrchestratorSteerer(input.actorPersonId);
    const roundId = await this.activeRoundId();
    if (roundId !== "round-6") {
      throw new Error("A troca de modelo só fica disponível na rodada 6.");
    }
    const current = await this.getOrchestratorModel();
    if (current?.participantId === input.participantId) {
      throw new Error("Este modelo já conduz o orquestrador.");
    }
    return { actor, current, roundId };
  }

  async recordModelSwap(input: {
    actorPersonId: string;
    participantId: string;
    modelLabel: string;
    previousModelLabel: string;
    handoff: string;
  }) {
    const { actor, roundId } = await this.assertCanSwapModel(input);
    const id = crypto.randomUUID();
    const revision = await this.db.transaction(async (tx) => {
      await tx.insert(orchestratorModelHandoffs).values({
        id,
        participantId: input.participantId,
        modelLabel: input.modelLabel,
        previousModelLabel: input.previousModelLabel,
        handoff: input.handoff,
        actorPersonId: actor.id,
        actorName: actor.name,
        roundId,
      });
      return this.appendEvent(
        tx,
        "orchestrator.model.swapped",
        {
          id,
          roundId,
          participantId: input.participantId,
          modelLabel: input.modelLabel,
          previousModelLabel: input.previousModelLabel,
        },
        actor
      );
    });
    return { id, roundId, revision };
  }

  async getOrchestratorModel(): Promise<OrchestratorModelView | null> {
    const [row] = await this.db
      .select()
      .from(orchestratorModelHandoffs)
      .orderBy(desc(orchestratorModelHandoffs.sequence))
      .limit(1);
    return row
      ? {
          participantId: row.participantId,
          modelLabel: row.modelLabel,
          previousModelLabel: row.previousModelLabel,
          handoff: row.handoff,
          actorPersonId: row.actorPersonId,
          actorName: row.actorName,
          roundId: row.roundId,
          createdAt: row.createdAt,
          consumedAt: row.consumedAt,
        }
      : null;
  }

  async createModelHandoff() {
    const [squadRows, decisionRows, challengeRows] = await Promise.all([
      this.db
        .select({ id: squads.id, name: squads.name })
        .from(squads)
        .where(eq(squads.active, true))
        .orderBy(asc(squads.ordinal)),
      this.db.select().from(decisions).orderBy(asc(decisions.roundId)),
      this.db
        .select()
        .from(challenges)
        .where(eq(challenges.roundId, "round-6")),
    ]);
    const activeSquadIds = new Set(squadRows.map((squad) => squad.id));
    return JSON.stringify({
      squads: squadRows,
      decisions: decisionRows.map((decision) => ({
        squadId: decision.squadId,
        roundId: decision.roundId,
        build: decision.build,
        cut: decision.cut,
        reason: decision.reason,
      })),
      pending: challengeRows
        .filter(
          (challenge) =>
            activeSquadIds.has(challenge.squadId) &&
            challenge.status !== "dispatched"
        )
        .map((challenge) => ({
          challengeId: challenge.id,
          squadId: challenge.squadId,
          roundId: challenge.roundId,
          hasDecision: decisionRows.some(
            (decision) => decision.challengeId === challenge.id
          ),
        })),
    });
  }

  async consumeModelHandoff() {
    const [current] = await this.db
      .select({ sequence: orchestratorModelHandoffs.sequence })
      .from(orchestratorModelHandoffs)
      .where(sql`${orchestratorModelHandoffs.consumedAt} IS NULL`)
      .orderBy(desc(orchestratorModelHandoffs.sequence))
      .limit(1);
    if (!current) {
      return;
    }
    await this.db
      .update(orchestratorModelHandoffs)
      .set({ consumedAt: new Date().toISOString() })
      .where(eq(orchestratorModelHandoffs.sequence, current.sequence));
  }

  async getFinale(): Promise<FinaleView> {
    const [
      squadRows,
      decisionRows,
      draftRows,
      returnedRows,
      liveTileRows,
      model,
    ] = await Promise.all([
      this.db
        .select()
        .from(squads)
        .where(eq(squads.active, true))
        .orderBy(asc(squads.ordinal)),
      this.db.select().from(decisions).orderBy(asc(decisions.roundId)),
      this.db
        .select({ squadId: challenges.squadId, origin: drafts.origin })
        .from(drafts)
        .innerJoin(challenges, eq(challenges.id, drafts.challengeId))
        .where(eq(drafts.seeded, false)),
      this.db
        .select({ squadId: dispatches.squadId })
        .from(reviews)
        .innerJoin(dispatches, eq(dispatches.id, reviews.dispatchId))
        .where(eq(reviews.outcome, "returned")),
      this.db
        .select({ tile: tiles, publication: tilePublications })
        .from(tilePublications)
        .innerJoin(tiles, eq(tiles.id, tilePublications.tileId)),
      this.getOrchestratorModel(),
    ]);
    const finaleSquads = squadRows.map((squad) => {
      const live = liveTileRows.find((row) => row.tile.squadId === squad.id);
      const squadDrafts = draftRows.filter(
        (draft) => draft.squadId === squad.id
      );
      return {
        id: squad.id,
        ordinal: squad.ordinal,
        name: squad.name,
        liveTile: live
          ? {
              id: live.tile.id,
              boardVersion: live.tile.boardVersion,
              manifest: parseJsonObject(live.tile.manifestJson),
              readme: live.tile.readme,
              sourceHarnessId: live.tile.sourceHarnessId,
              sourceModel: live.tile.sourceModel,
            }
          : null,
        decisions: decisionRows
          .filter((decision) => decision.squadId === squad.id)
          .map((decision) => ({
            id: decision.id,
            roundId: decision.roundId,
            roundNumber: Number(decision.roundId.replace("round-", "")),
            build: decision.build,
            cut: decision.cut,
            reason: decision.reason,
            steererName: decision.steererName,
          }))
          .sort((left, right) => left.roundNumber - right.roundNumber),
        draftCounts: {
          human: squadDrafts.filter((draft) => draft.origin === "human").length,
          harness: squadDrafts.filter((draft) => draft.origin === "harness")
            .length,
        },
        returnedReviews: returnedRows.filter((row) => row.squadId === squad.id)
          .length,
      };
    });
    return {
      squads: finaleSquads,
      totals: {
        drafts: finaleSquads.reduce(
          (total, squad) => ({
            human: total.human + squad.draftCounts.human,
            harness: total.harness + squad.draftCounts.harness,
          }),
          { human: 0, harness: 0 }
        ),
        returnedReviews: finaleSquads.reduce(
          (total, squad) => total + squad.returnedReviews,
          0
        ),
      },
      orchestratorModel: model,
    };
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
