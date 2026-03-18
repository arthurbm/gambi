// Re-export Participant namespace from core (DRY - zero duplication)
import { Participant } from "@gambi/core/participant";

/**
 * Participant management namespace
 *
 * Provides functions for creating and configuring participants.
 * Participants are entities that can join rooms and contribute LLM capabilities.
 */
export const participants = {
  /** Create a new participant */
  create: Participant.create,

  /** Merge configuration with defaults */
  mergeConfig: Participant.mergeConfig,
} as const;
