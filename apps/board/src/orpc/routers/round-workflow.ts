import { z } from "zod";

import type { Context } from "../context";
import { assertAdmin, badRequest, publicProcedure } from "../index";

const personId = z.string().trim().min(8).max(128);
const entityId = z.string().trim().min(1).max(160);
const content = z.string().trim().min(1).max(20_000);

function publish(context: Context, change: string, revision: number) {
  return context.events.publish({ type: "board.changed", change, revision });
}

export function createRoundWorkflowRouter() {
  return {
    workflow: {
      get: publicProcedure
        .input(z.object({ roundId: entityId.optional() }))
        .handler(({ context, input }) =>
          context.workflow.getView(input.roundId)
        ),
    },
    orchestrator: {
      selectSteerer: publicProcedure
        .input(z.object({ actorPersonId: personId, personId }))
        .handler(async ({ context, input }) => {
          assertAdmin(context);
          try {
            const result =
              await context.workflow.selectOrchestratorSteerer(input);
            await publish(
              context,
              "orchestrator.steerer.selected",
              result.revision
            );
            return result;
          } catch (error) {
            return badRequest(error);
          }
        }),
      propose: publicProcedure
        .input(z.object({ actorPersonId: personId, objective: content }))
        .handler(async ({ context, input }) => {
          try {
            await context.orchestrator?.run(
              `Frame the current round around this human objective without dispatching work: ${input.objective}`
            );
            const result = await context.workflow.proposeChallenges(input);
            await publish(context, "challenges.proposed", result.revision);
            return result;
          } catch (error) {
            return badRequest(error);
          }
        }),
      editChallenge: publicProcedure
        .input(
          z.object({
            actorPersonId: personId,
            challengeId: entityId,
            objective: content,
          })
        )
        .handler(async ({ context, input }) => {
          try {
            const result = await context.workflow.updateChallenge(input);
            await publish(context, "challenge.edited", result.revision);
            return result;
          } catch (error) {
            return badRequest(error);
          }
        }),
      publish: publicProcedure
        .input(z.object({ actorPersonId: personId }))
        .handler(async ({ context, input }) => {
          try {
            const result = await context.workflow.publishChallenges(
              input.actorPersonId
            );
            await publish(context, "challenges.published", result.revision);
            return result;
          } catch (error) {
            return badRequest(error);
          }
        }),
      answerEscalation: publicProcedure
        .input(
          z.object({
            actorPersonId: personId,
            escalationId: entityId,
            response: content,
          })
        )
        .handler(async ({ context, input }) => {
          try {
            const result = await context.workflow.answerEscalation(input);
            await publish(context, "escalation.answered", result.revision);
            return result;
          } catch (error) {
            return badRequest(error);
          }
        }),
    },
    drafts: {
      create: publicProcedure
        .input(
          z.object({ actorPersonId: personId, challengeId: entityId, content })
        )
        .handler(async ({ context, input }) => {
          try {
            const result = await context.workflow.createDraft({
              ...input,
              origin: "human",
            });
            await publish(context, "draft.created", result.revision);
            return result;
          } catch (error) {
            return badRequest(error);
          }
        }),
      requestFromHarness: publicProcedure
        .input(
          z.object({
            actorPersonId: personId,
            challengeId: entityId,
            request: content,
          })
        )
        .handler(async ({ context, input }) => {
          try {
            if (!context.harness) {
              throw new Error("O runtime de harness está desativado.");
            }
            const view = await context.workflow.getView();
            const challenge = view.challenges.find(
              (item) => item.id === input.challengeId
            );
            if (!challenge) {
              throw new Error("Desafio não encontrado nesta rodada.");
            }
            const harness = await context.workflow.ownedHarness(
              input.actorPersonId
            );
            const sessionId = `draft-${view.roundId}-${input.actorPersonId}`;
            await context.harness.promptSession({
              participantId: harness.participantId,
              prompt: `Proponha um draft para este desafio: ${challenge.objective}\n\nPedido da pessoa: ${input.request}`,
              roundId: view.roundId,
              sessionId,
              squadId: challenge.squadId,
            });
            const result = await context.workflow.createDraft({
              actorPersonId: input.actorPersonId,
              challengeId: input.challengeId,
              content: input.request,
              origin: "harness",
            });
            await publish(context, "draft.created", result.revision);
            return result;
          } catch (error) {
            return badRequest(error);
          }
        }),
    },
    decisions: {
      record: publicProcedure
        .input(
          z.object({
            actorPersonId: personId,
            challengeId: entityId,
            build: content,
            cut: content,
            reason: content,
            consideredDraftIds: z.array(entityId).min(1),
          })
        )
        .handler(async ({ context, input }) => {
          try {
            const result = await context.workflow.recordDecision(input);
            await publish(context, "decision.recorded", result.revision);
            return result;
          } catch (error) {
            return badRequest(error);
          }
        }),
    },
    dispatches: {
      send: publicProcedure
        .input(
          z.object({
            actorPersonId: personId,
            challengeId: entityId,
            expectedOutput: content,
            constraints: z.array(z.string().trim().min(1).max(500)).max(12),
          })
        )
        .handler(async ({ context, input }) => {
          try {
            if (!context.harness) {
              throw new Error("O runtime de harness está desativado.");
            }
            const view = await context.workflow.getView();
            const challenge = view.challenges.find(
              (item) => item.id === input.challengeId
            );
            if (!challenge) {
              throw new Error("Desafio não encontrado nesta rodada.");
            }
            const binding = await context.repository.requirePromptBinding({
              actorPersonId: input.actorPersonId,
              squadId: challenge.squadId,
            });
            const session = await context.repository.ensureHarnessSession({
              squadId: challenge.squadId,
              roundId: challenge.roundId,
              participantId: binding.assignment.participantId,
            });
            const prepared = await context.workflow.prepareDispatch({
              ...input,
              participantId: binding.assignment.participantId,
              sessionId: session.sessionId,
            });
            try {
              await context.harness.promptSession({
                participantId: binding.assignment.participantId,
                prompt: JSON.stringify(prepared.payload),
                roundId: challenge.roundId,
                sessionId: session.sessionId,
                squadId: challenge.squadId,
              });
              await context.workflow.setDispatchStatus(prepared.id, "sent");
            } catch (error) {
              await context.workflow.setDispatchStatus(
                prepared.id,
                "delivery_unknown"
              );
              throw error;
            }
            await publish(context, "dispatch.sent", prepared.revision);
            return {
              id: prepared.id,
              sessionId: session.sessionId,
              revision: prepared.revision,
            };
          } catch (error) {
            return badRequest(error);
          }
        }),
    },
    reviews: {
      record: publicProcedure
        .input(
          z.object({
            actorPersonId: personId,
            dispatchId: entityId,
            outcome: z.enum(["accepted", "returned"]),
            reason: z.string().trim().max(4000).optional(),
          })
        )
        .handler(async ({ context, input }) => {
          try {
            const result = await context.workflow.recordReview(input);
            if (
              input.outcome === "returned" &&
              !result.escalationId &&
              !result.duplicate
            ) {
              if (!context.harness) {
                throw new Error(
                  "A revisão foi gravada, mas o runtime de harness está desativado."
                );
              }
              const session = await context.repository.getHarnessSessionById(
                result.sessionId
              );
              if (!session) {
                throw new Error(
                  "A revisão foi gravada, mas a sessão não foi encontrada."
                );
              }
              await context.harness.promptSession({
                participantId: session.participantId,
                prompt: `Devolvido por steerer: ${input.reason}`,
                roundId: session.roundId,
                sessionId: session.sessionId,
                squadId: session.squadId,
              });
            }
            await publish(
              context,
              input.outcome === "accepted"
                ? "review.accepted"
                : "review.returned",
              result.revision
            );
            return result;
          } catch (error) {
            return badRequest(error);
          }
        }),
    },
  };
}
