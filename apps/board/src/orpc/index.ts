import { ORPCError, os } from "@orpc/server";

import type { Context } from "./context";

export const publicProcedure = os.$context<Context>();

export function assertAdmin(context: Context) {
  const supplied = context.request.header("x-board-admin-token");
  if (!supplied || supplied !== context.adminToken) {
    throw new ORPCError("UNAUTHORIZED", {
      message: "O token de admin está ausente ou inválido.",
    });
  }
}

export function badRequest(error: unknown): never {
  throw new ORPCError("BAD_REQUEST", {
    message:
      error instanceof Error ? error.message : "A ação não pôde ser concluída.",
    cause: error,
  });
}
