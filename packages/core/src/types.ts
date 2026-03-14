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

export const ParticipantInfo = z.object({
  id: z.string(),
  nickname: z.string(),
  model: z.string(),
  endpoint: z.string().url(), // Endpoint exposing OpenResponses and/or chat/completions
  config: GenerationConfig,
  specs: MachineSpecs,
  capabilities: ParticipantCapabilities.default({
    openResponses: "unknown",
    chatCompletions: "unknown",
  }),
  status: ParticipantStatus,
  joinedAt: z.number(),
  lastSeen: z.number(), // Timestamp of last health check
});

export type ParticipantInfo = z.infer<typeof ParticipantInfo>;

export const ParticipantRegistration = z.object({
  id: z.string(),
  nickname: z.string(),
  model: z.string(),
  endpoint: z.string().url(),
  password: z.string().optional(),
  specs: MachineSpecs.optional(),
  config: GenerationConfig.optional(),
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
  passwordHash: z.string().optional(), // Hashed password for room protection
});

// Public room info schema (excludes sensitive fields for API responses)
export const RoomInfoPublic = RoomInfoInternal.omit({ passwordHash: true });

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
