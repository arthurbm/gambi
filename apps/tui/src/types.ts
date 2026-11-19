import type { ParticipantSummary } from "gambi-sdk";
import { z } from "zod";

// What a hub says about rooms and participants: the types of the management
// client, which follow the contract. Never redeclare them here.
export type {
  GenerationConfig,
  MachineSpecs,
  ParticipantCapabilities,
  ParticipantStatus,
  ParticipantSummary,
  RoomEvent,
  RoomSummary,
  RuntimeConfig,
} from "gambi-sdk";

// TUI-specific types

export const ActivityLogType = z.enum([
  "join",
  "online",
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
  participants: Map<string, ParticipantSummary>;
  logs: ActivityLogEntry[];
  /** Whether the room's event stream is open and its snapshot arrived. */
  connected: boolean;
  processingRequests: Set<string>; // participantIds currently processing
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
  surface: "#334155", // Slate - focused/selected backgrounds
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
