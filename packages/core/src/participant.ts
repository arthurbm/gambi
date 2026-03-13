import { nanoid } from "nanoid";
import type {
  GenerationConfig,
  MachineSpecs,
  ParticipantCapabilities,
  ParticipantInfo,
} from "./types.ts";

export interface CreateParticipantOptions {
  nickname: string;
  model: string;
  endpoint: string; // Endpoint exposing OpenResponses and/or chat/completions
  specs?: MachineSpecs;
  config?: GenerationConfig;
  capabilities?: ParticipantCapabilities;
}

function create(options: CreateParticipantOptions): ParticipantInfo {
  const now = Date.now();
  return {
    id: nanoid(),
    nickname: options.nickname,
    model: options.model,
    endpoint: options.endpoint,
    specs: options.specs ?? {},
    config: options.config ?? {},
    capabilities: options.capabilities ?? {
      openResponses: "unknown",
      chatCompletions: "unknown",
    },
    status: "online",
    joinedAt: now,
    lastSeen: now,
  };
}

function mergeConfig(
  base: GenerationConfig,
  overrides?: Partial<GenerationConfig>
): GenerationConfig {
  return {
    ...base,
    ...overrides,
  };
}

export const Participant = {
  create,
  mergeConfig,
} as const;
