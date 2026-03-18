// Re-export Hub creation and types from core (DRY - zero duplication)
export {
  type ChatCompletionRequest,
  createHub,
  type GambiModel,
  type Hub,
  type HubOptions,
  type ModelsListResponse,
  type ResponsesCreateRequest,
} from "@gambi/core/hub";

/**
 * Hub management namespace
 *
 * Provides functions for creating and managing Gambi hubs.
 * A hub is the central server that manages rooms, participants, and proxies LLM requests.
 */
export const hub = {
  /** Create a new Gambi hub */
  create: createHub,
} as const;

// Direct import for backward compatibility and convenience
import { createHub } from "@gambi/core/hub";
