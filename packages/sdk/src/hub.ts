// Re-export Hub creation and types from core (DRY - zero duplication)
export {
  type ChatCompletionRequest,
  createHub,
  type GambiarraModel,
  type Hub,
  type HubOptions,
  type ModelsListResponse,
  type ResponsesCreateRequest,
} from "@gambiarra/core/hub";

/**
 * Hub management namespace
 *
 * Provides functions for creating and managing Gambiarra hubs.
 * A hub is the central server that manages rooms, participants, and proxies LLM requests.
 */
export const hub = {
  /** Create a new Gambiarra hub */
  create: createHub,
} as const;

// Direct import for backward compatibility and convenience
import { createHub } from "@gambiarra/core/hub";
