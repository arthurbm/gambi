import type { Context as HonoContext } from "hono";

import type { BoardRepository } from "../db/repository";
import type { BoardEventBus } from "../sse";

export interface CreateContextOptions {
  context: HonoContext;
  repository: BoardRepository;
  events: BoardEventBus;
  adminToken: string;
}

export function createContext(options: CreateContextOptions) {
  return {
    repository: options.repository,
    events: options.events,
    adminToken: options.adminToken,
    request: options.context.req,
  };
}

export type Context = ReturnType<typeof createContext>;
