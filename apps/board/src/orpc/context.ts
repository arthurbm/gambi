import type { Context as HonoContext } from "hono";

import type { BoardRepository } from "../db/repository";
import type { BoardEventBus } from "../sse";

interface HarnessActions {
  prompt: (input: {
    actorPersonId: string;
    prompt: string;
    squadId: string;
  }) => Promise<{ sessionId: string; revision: number }>;
  reconcileHosted: (desiredCount?: number) => Promise<void>;
}

export interface CreateContextOptions {
  context: HonoContext;
  repository: BoardRepository;
  events: BoardEventBus;
  adminToken: string;
  harness?: HarnessActions;
}

export function createContext(options: CreateContextOptions) {
  return {
    repository: options.repository,
    events: options.events,
    adminToken: options.adminToken,
    harness: options.harness,
    request: options.context.req,
  };
}

export type Context = ReturnType<typeof createContext>;
