import type { Context as HonoContext } from "hono";

import type { BoardRepository } from "../db/repository";
import type { WorkflowRepository } from "../db/workflow-repository";
import type { BoardEventBus } from "../sse";

interface HarnessActions {
  prompt: (input: {
    actorPersonId: string;
    prompt: string;
    squadId: string;
  }) => Promise<{ sessionId: string; revision: number }>;
  reconcileHosted: (desiredCount?: number) => Promise<void>;
  promptSession: (input: {
    participantId: string;
    prompt: string;
    roundId: string;
    sessionId: string;
    squadId: string;
  }) => Promise<void>;
}

interface OrchestratorActions {
  listModels: () => Promise<
    Array<{ id: string; nickname: string; model: string }>
  >;
  run: (prompt: string) => Promise<unknown>;
  swapModel: (participantId: string, handoff: string) => string;
}

export interface CreateContextOptions {
  context: HonoContext;
  repository: BoardRepository;
  workflow: WorkflowRepository;
  events: BoardEventBus;
  adminToken: string;
  harness?: HarnessActions;
  orchestrator?: OrchestratorActions;
}

export function createContext(options: CreateContextOptions) {
  return {
    repository: options.repository,
    workflow: options.workflow,
    events: options.events,
    adminToken: options.adminToken,
    harness: options.harness,
    orchestrator: options.orchestrator,
    request: options.context.req,
  };
}

export type Context = ReturnType<typeof createContext>;
