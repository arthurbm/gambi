import type { RouterClient } from "@orpc/server";
import { z } from "zod";

import type { Context } from "../context";
import { assertAdmin, badRequest, publicProcedure } from "../index";

const personId = z.string().trim().min(8).max(128);
const name = z.string().trim().min(1, "Digite seu nome.").max(80);

function publish(context: Context, change: string, revision: number) {
  return context.events.publish({ type: "board.changed", change, revision });
}

export function createAppRouter() {
  return {
    board: {
      state: publicProcedure.handler(({ context }) =>
        context.repository.getState()
      ),
    },
    admin: {
      getConfig: publicProcedure.handler(({ context }) => {
        assertAdmin(context);
        return context.repository.getConfig();
      }),
      configure: publicProcedure
        .input(
          z.object({
            theme: z.string().trim().min(1).max(120),
            squadCount: z.number().int().min(1).max(12),
            hostedHarnessCount: z.number().int().min(0).max(12),
          })
        )
        .handler(async ({ context, input }) => {
          assertAdmin(context);
          try {
            await context.repository.assertHostedScaleDownAllowed(
              input.hostedHarnessCount
            );
            const result = await context.repository.configure(input);
            await context.harness?.reconcileHosted(input.hostedHarnessCount);
            await publish(context, "admin.configured", result.revision);
            return result;
          } catch (error) {
            return badRequest(error);
          }
        }),
    },
    people: {
      join: publicProcedure
        .input(z.object({ personId, name }))
        .handler(async ({ context, input }) => {
          try {
            const result = await context.repository.joinPerson(input);
            await publish(context, "person.joined", result.revision);
            return result;
          } catch (error) {
            return badRequest(error);
          }
        }),
    },
    squads: {
      list: publicProcedure.handler(({ context }) =>
        context.repository.listSquads()
      ),
      join: publicProcedure
        .input(
          z.object({ personId, squadId: z.string().trim().min(1).max(128) })
        )
        .handler(async ({ context, input }) => {
          try {
            const result = await context.repository.joinSquad(input);
            await publish(context, "squad.joined", result.revision);
            return result;
          } catch (error) {
            return badRequest(error);
          }
        }),
    },
    harnesses: {
      list: publicProcedure.handler(({ context }) =>
        context.repository.listHarnesses()
      ),
      claimHosted: publicProcedure
        .input(
          z.object({
            personId,
            participantId: z.string().trim().min(1).max(128),
          })
        )
        .handler(async ({ context, input }) => {
          try {
            const result = await context.repository.claimHostedHarness(input);
            await publish(context, "harness.claimed", result.revision);
            return result;
          } catch (error) {
            return badRequest(error);
          }
        }),
      squad: publicProcedure
        .input(z.object({ squadId: z.string().trim().min(1).max(128) }))
        .handler(({ context, input }) =>
          context.repository.getSquadHarness(input.squadId)
        ),
      assign: publicProcedure
        .input(
          z.object({
            actorPersonId: personId,
            squadId: z.string().trim().min(1).max(128),
            participantId: z.string().trim().min(1).max(128),
          })
        )
        .handler(async ({ context, input }) => {
          try {
            const result = await context.repository.assignHarness(input);
            await publish(context, "harness.assigned", result.revision);
            return result;
          } catch (error) {
            return badRequest(error);
          }
        }),
      electSteerer: publicProcedure
        .input(
          z.object({
            actorPersonId: personId,
            squadId: z.string().trim().min(1).max(128),
            personId,
          })
        )
        .handler(async ({ context, input }) => {
          try {
            const result = await context.repository.electSteerer(input);
            await publish(context, "steerer.elected", result.revision);
            return result;
          } catch (error) {
            return badRequest(error);
          }
        }),
      prompt: publicProcedure
        .input(
          z.object({
            actorPersonId: personId,
            squadId: z.string().trim().min(1).max(128),
            prompt: z.string().trim().min(1).max(20_000),
          })
        )
        .handler(async ({ context, input }) => {
          try {
            if (!context.harness) {
              throw new Error(
                "O runtime de harness está desativado. Configure GAMBI_ROOM_CODE no board."
              );
            }
            const result = await context.harness.prompt(input);
            await publish(context, "harness.prompted", result.revision);
            return result;
          } catch (error) {
            return badRequest(error);
          }
        }),
    },
    tiles: {
      versions: publicProcedure
        .input(
          z
            .object({ squadId: z.string().trim().min(1).max(128).optional() })
            .optional()
        )
        .handler(({ context, input }) =>
          context.repository.listTileVersions(input?.squadId)
        ),
      acceptLatest: publicProcedure
        .input(
          z.object({
            actorPersonId: personId,
            squadId: z.string().trim().min(1).max(128),
          })
        )
        .handler(async ({ context, input }) => {
          try {
            const result = await context.repository.acceptLatestTile(input);
            await publish(context, "tile.accepted", result.revision);
            return result;
          } catch (error) {
            return badRequest(error);
          }
        }),
      publish: publicProcedure
        .input(
          z.object({
            squadId: z.string().trim().min(1).max(128),
            boardVersion: z.number().int().positive(),
            actorName: z.string().trim().min(1).max(80),
          })
        )
        .handler(async ({ context, input }) => {
          assertAdmin(context);
          try {
            const result = await context.repository.publishTileOverride(input);
            await publish(context, "tile.published", result.revision);
            return result;
          } catch (error) {
            return badRequest(error);
          }
        }),
    },
    phase: {
      get: publicProcedure.handler(async ({ context }) => {
        const config = await context.repository.getConfig();
        return { currentPhase: config.currentPhase };
      }),
      advance: publicProcedure.handler(async ({ context }) => {
        assertAdmin(context);
        try {
          const result = await context.repository.advancePhase();
          await publish(context, "phase.advanced", result.revision);
          return result;
        } catch (error) {
          return badRequest(error);
        }
      }),
      skip: publicProcedure.handler(async ({ context }) => {
        assertAdmin(context);
        try {
          const result = await context.repository.skipPhase();
          await publish(context, "phase.skipped", result.revision);
          return result;
        } catch (error) {
          return badRequest(error);
        }
      }),
    },
  };
}

export type AppRouter = ReturnType<typeof createAppRouter>;
export type AppRouterClient = RouterClient<AppRouter>;
