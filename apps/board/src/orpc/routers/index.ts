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
            const result = await context.repository.configure(input);
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
