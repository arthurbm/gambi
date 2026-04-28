import { ParticipantInfo as ParticipantInfoSchema } from "@gambi/core/types";
import { z } from "zod";

// Re-export types from core
export type {
  GenerationConfig,
  LlmMetrics,
  MachineSpecs,
  ParticipantInfo,
  ParticipantStatus,
  RoomInfoPublic as RoomInfo,
  RuntimeConfig,
} from "@gambi/core/types";

// TUI-specific types

export const ActivityLogType = z.enum([
  "join",
  "leave",
  "offline",
  "request",
  "complete",
  "error",
]);
export type ActivityLogType = z.infer<typeof ActivityLogType>;

export const LogMetrics = z.object({
  tokensPerSecond: z.number().optional(),
  latencyMs: z.number().optional(),
  totalTokens: z.number().optional(),
});
export type LogMetrics = z.infer<typeof LogMetrics>;

export const ActivityLogEntry = z.object({
  id: z.string(),
  timestamp: z.number(),
  roomCode: z.string(),
  type: ActivityLogType,
  participantId: z.string().optional(),
  participantName: z.string().optional(),
  message: z.string(),
  metrics: LogMetrics.optional(),
});
export type ActivityLogEntry = z.infer<typeof ActivityLogEntry>;

export interface RoomState {
  code: string;
  name: string;
  participants: Map<string, z.infer<typeof ParticipantInfoSchema>>;
  logs: ActivityLogEntry[];
  connected: boolean;
  processingRequests: Set<string>; // participantIds currently processing
}

// SSE Event schemas
export const SSEConnectedEvent = z.object({
  clientId: z.string(),
});

export const SSERoomCreatedEvent = z.object({
  code: z.string(),
  name: z.string(),
});

export const SSEParticipantJoinedEvent = ParticipantInfoSchema;

export const SSEParticipantUpdatedEvent = ParticipantInfoSchema;

export const SSEParticipantLeftEvent = z.object({
  participantId: z.string(),
});

export const SSEParticipantOfflineEvent = z.object({
  participantId: z.string(),
});

export const SSELlmRequestEvent = z.object({
  participantId: z.string(),
  model: z.string(),
});

export const SSELlmCompleteEvent = z.object({
  participantId: z.string(),
  metrics: LogMetrics.optional(),
});

export const SSELlmErrorEvent = z.object({
  participantId: z.string(),
  error: z.string(),
});

export interface SSEEvent {
  event: string;
  data: unknown;
}

// Design system colors tuned for both light and dark terminal backgrounds.
export const colors = {
  primary: "#2563EB", // Blue - headers, focus, interactive
  success: "#15803D", // Green - online, success, joins
  warning: "#B45309", // Amber - busy, processing, requests
  error: "#DC2626", // Red - offline, errors
  muted: "#737373", // Gray - secondary text, disabled
  metrics: "#BE185D", // Rose - tok/s, latency numbers
  text: "#D1D5DB", // Light neutral - primary text on dark terminals
  surface: "#D1D5DB", // Gray - focused/selected backgrounds
  accent: "#7C3AED", // Violet - accent/highlight
} as const;

// Status indicators
export const statusIndicators = {
  online: "●",
  busy: "◐",
  offline: "○",
  selected: "◉",
  request: "▶",
  complete: "✓",
  error: "✗",
  leave: "◄",
} as const;
