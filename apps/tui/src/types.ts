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

// Design system colors
export const colors = {
  primary: "#00FFFF", // Cyan - headers, focus, interactive
  success: "#00FF00", // Green - online, success, joins
  warning: "#FFAA00", // Amber - busy, processing, requests
  error: "#FF5555", // Red - offline, errors
  muted: "#666666", // Gray - secondary text, disabled
  metrics: "#FF79C6", // Pink - tok/s, latency numbers
  text: "#FFFFFF", // White - primary text
  surface: "#333333", // Dark gray - backgrounds, selected items
  accent: "#AA55FF", // Purple - accent/highlight
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
