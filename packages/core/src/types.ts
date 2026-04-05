import { z } from "zod";

// Re-export OpenAI types for convenience
export type {
  ChatCompletion,
  ChatCompletionChunk,
  ChatCompletionCreateParams,
  ChatCompletionMessage,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";

export type { Model, ModelDeleted } from "openai/resources/models";
export type {
  InputItemListParams,
  ResponseItemList,
} from "openai/resources/responses/input-items";
export type {
  Response,
  ResponseCreateParams,
  ResponseCreateParamsNonStreaming,
  ResponseCreateParamsStreaming,
  ResponseInputItem,
  ResponseRetrieveParams,
  ResponseRetrieveParamsNonStreaming,
  ResponseRetrieveParamsStreaming,
  ResponseStreamEvent,
  ResponseUsage,
} from "openai/resources/responses/responses";

// Health check interval in milliseconds
export const HEALTH_CHECK_INTERVAL = 10_000;
// Time after which a participant is considered offline (3 missed health checks)
export const PARTICIPANT_TIMEOUT = HEALTH_CHECK_INTERVAL * 3;

// Generation config (compatible with OpenAI-like APIs)
// These are the common parameters supported by most providers
// Provider-specific params can be passed via the API but aren't stored in participant config
export const GenerationConfig = z.object({
  // Standard OpenAI-compatible params
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  max_tokens: z.number().optional(),
  stop: z.array(z.string()).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  seed: z.number().optional(),
});

export type GenerationConfig = z.infer<typeof GenerationConfig>;
// Alias for backwards compatibility
export const OllamaConfig = GenerationConfig;
export type OllamaConfig = GenerationConfig;

export const RuntimeConfig = GenerationConfig.extend({
  instructions: z.string().trim().min(1).optional(),
});

export type RuntimeConfig = z.infer<typeof RuntimeConfig>;

export const RuntimeConfigPublic = GenerationConfig.extend({
  hasInstructions: z.boolean().default(false),
});

export type RuntimeConfigPublic = z.infer<typeof RuntimeConfigPublic>;

export const MachineSpecs = z.object({
  gpu: z.string().optional(),
  vram: z.number().optional(),
  ram: z.number().optional(),
  cpu: z.string().optional(),
});

export type MachineSpecs = z.infer<typeof MachineSpecs>;

export const ParticipantStatus = z.enum(["online", "busy", "offline"]);
export type ParticipantStatus = z.infer<typeof ParticipantStatus>;

export const ProtocolSupport = z.enum(["supported", "unsupported", "unknown"]);
export type ProtocolSupport = z.infer<typeof ProtocolSupport>;

export const ParticipantCapabilities = z.object({
  openResponses: ProtocolSupport.default("unknown"),
  chatCompletions: ProtocolSupport.default("unknown"),
});
export type ParticipantCapabilities = z.infer<typeof ParticipantCapabilities>;

export const ParticipantAuthHeaders = z.record(z.string().min(1), z.string());
export type ParticipantAuthHeaders = z.infer<typeof ParticipantAuthHeaders>;

export const ParticipantInfoInternal = z.object({
  id: z.string(),
  nickname: z.string(),
  model: z.string(),
  endpoint: z.string().url(), // Endpoint exposing OpenResponses and/or chat/completions
  config: RuntimeConfig,
  specs: MachineSpecs,
  capabilities: ParticipantCapabilities.default({
    openResponses: "unknown",
    chatCompletions: "unknown",
  }),
  status: ParticipantStatus,
  joinedAt: z.number(),
  lastSeen: z.number(), // Timestamp of last health check
  updatedAt: z.number(),
});

export type ParticipantInfoInternal = z.infer<typeof ParticipantInfoInternal>;

export const ParticipantInfo = z.object({
  id: z.string(),
  nickname: z.string(),
  model: z.string(),
  endpoint: z.string().url(),
  config: RuntimeConfigPublic,
  specs: MachineSpecs,
  capabilities: ParticipantCapabilities.default({
    openResponses: "unknown",
    chatCompletions: "unknown",
  }),
  status: ParticipantStatus,
  joinedAt: z.number(),
  lastSeen: z.number(),
  updatedAt: z.number(),
});

export type ParticipantInfo = z.infer<typeof ParticipantInfo>;

export const ParticipantRegistration = z.object({
  id: z.string(),
  nickname: z.string(),
  model: z.string(),
  endpoint: z.string().url(),
  password: z.string().optional(),
  specs: MachineSpecs.optional(),
  config: RuntimeConfig.optional(),
  capabilities: ParticipantCapabilities.optional(),
  authHeaders: ParticipantAuthHeaders.optional(),
});

export type ParticipantRegistration = z.infer<typeof ParticipantRegistration>;

// Internal room info schema (includes sensitive fields like passwordHash)
export const RoomInfoInternal = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  hostId: z.string(),
  createdAt: z.number(),
  defaults: RuntimeConfig.optional(),
  passwordHash: z.string().optional(), // Hashed password for room protection
});

// Public room info schema (excludes sensitive fields for API responses)
export const RoomInfoPublic = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  hostId: z.string(),
  createdAt: z.number(),
  defaults: RuntimeConfigPublic.optional(),
  passwordProtected: z.boolean().default(false),
});

// Type aliases
export type RoomInfo = z.infer<typeof RoomInfoInternal>; // Internal type
export type RoomInfoPublic = z.infer<typeof RoomInfoPublic>; // Public type

export const LlmMetrics = z.object({
  tokens: z.number(),
  latencyFirstTokenMs: z.number(),
  durationMs: z.number(),
  tokensPerSecond: z.number(),
});

export type LlmMetrics = z.infer<typeof LlmMetrics>;

// Network configuration for the Hub
export const NetworkConfig = z.object({
  hostname: z.string().default("127.0.0.1"),
  port: z.number().min(0).max(65_535).default(3000),
  mdns: z.boolean().default(false),
  cors: z.array(z.string()).default([]),
});

export type NetworkConfig = z.infer<typeof NetworkConfig>;

export const HubConfig = z.object({
  network: NetworkConfig.optional(),
});

export type HubConfig = z.infer<typeof HubConfig>;

export const ApiMeta = z.object({
  requestId: z.string(),
});

export type ApiMeta = z.infer<typeof ApiMeta>;

export const ApiErrorCode = z.enum([
  "ROOM_NOT_FOUND",
  "PARTICIPANT_NOT_FOUND",
  "INVALID_REQUEST",
  "INVALID_PASSWORD",
  "ENDPOINT_NOT_REACHABLE",
  "LOOPBACK_ENDPOINT_FOR_REMOTE_HUB",
  "PARTICIPANT_CONFLICT",
  "MODEL_NOT_FOUND",
  "INTERNAL_ERROR",
]);

export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiErrorShape = z.object({
  code: ApiErrorCode,
  message: z.string(),
  hint: z.string().optional(),
  details: z.unknown().optional(),
});

export type ApiErrorShape = z.infer<typeof ApiErrorShape>;

export const ApiErrorResponse = z.object({
  error: ApiErrorShape,
  meta: ApiMeta,
});

export type ApiErrorResponse = z.infer<typeof ApiErrorResponse>;

export function createApiSuccessSchema<T extends z.ZodType>(data: T) {
  return z.object({
    data,
    meta: ApiMeta,
  });
}

export const RoomSummary = RoomInfoPublic.extend({
  participantCount: z.number().int().nonnegative(),
});

export type RoomSummary = z.infer<typeof RoomSummary>;

export const ParticipantSummary = ParticipantInfo;

export type ParticipantSummary = z.infer<typeof ParticipantSummary>;

export const HeartbeatResult = z.object({
  success: z.literal(true),
  status: ParticipantStatus,
  lastSeen: z.number(),
});

export type HeartbeatResult = z.infer<typeof HeartbeatResult>;

export const RoomEventType = z.enum([
  "connected",
  "room.created",
  "participant.joined",
  "participant.updated",
  "participant.left",
  "participant.offline",
  "llm.request",
  "llm.error",
]);

export type RoomEventType = z.infer<typeof RoomEventType>;

export const RoomEvent = z.object({
  type: RoomEventType,
  timestamp: z.number(),
  roomCode: z.string().optional(),
  data: z.unknown(),
});

export type RoomEvent = z.infer<typeof RoomEvent>;
