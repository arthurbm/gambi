import { nanoid } from "nanoid";
import type {
  HarnessParticipant,
  MachineSpecs,
  ParticipantCapabilities,
  ParticipantInfo,
  ParticipantInfoInternal,
  RuntimeConfig,
  RuntimeConfigPublic,
} from "./types.ts";

interface CreateParticipantOptionsBase {
  nickname: string;
  model: string;
  specs?: MachineSpecs;
  config?: RuntimeConfig;
  capabilities?: ParticipantCapabilities;
}

export type CreateParticipantOptions = CreateParticipantOptionsBase &
  (
    | {
        endpoint: string; // Endpoint exposing OpenResponses and/or chat/completions
        harness?: never;
      }
    | {
        endpoint?: string;
        harness: HarnessParticipant;
      }
  );

function create(options: CreateParticipantOptions): ParticipantInfoInternal {
  const now = Date.now();
  return {
    id: nanoid(),
    nickname: options.nickname,
    model: options.model,
    endpoint: options.endpoint,
    harness: options.harness,
    specs: options.specs ?? {},
    config: options.config ?? {},
    capabilities:
      options.harness === undefined && options.capabilities
        ? options.capabilities
        : {
            openResponses: "unknown",
            chatCompletions: "unknown",
          },
    connection: {
      kind: "tunnel",
      connected: false,
      lastTunnelSeenAt: null,
    },
    status: "offline",
    joinedAt: now,
    lastSeen: now,
    updatedAt: now,
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
