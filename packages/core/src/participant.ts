import { nanoid } from "nanoid";
import type {
  MachineSpecs,
  ParticipantCapabilities,
  ParticipantInfo,
  ParticipantInfoInternal,
  RuntimeConfig,
  RuntimeConfigPublic,
} from "./types.ts";

export interface CreateParticipantOptions {
  nickname: string;
  model: string;
  endpoint: string; // Endpoint exposing OpenResponses and/or chat/completions
  specs?: MachineSpecs;
  config?: RuntimeConfig;
  capabilities?: ParticipantCapabilities;
}

function create(options: CreateParticipantOptions): ParticipantInfoInternal {
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
  base: RuntimeConfig,
  overrides?: Partial<RuntimeConfig>
): RuntimeConfig {
  return {
    ...base,
    ...overrides,
  };
}

function toPublicConfig(config: RuntimeConfig): RuntimeConfigPublic {
  const { instructions, ...rest } = config;
  return {
    ...rest,
    hasInstructions:
      typeof instructions === "string" && instructions.trim().length > 0,
  };
}

function toPublicInfo(participant: ParticipantInfoInternal): ParticipantInfo {
  return {
    ...participant,
    config: toPublicConfig(participant.config),
  };
}

export const Participant = {
  create,
  mergeConfig,
  toPublicConfig,
  toPublicInfo,
} as const;
