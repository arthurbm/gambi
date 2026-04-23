import type { ParticipantInfo, RoomState } from "../types";

/**
 * Creates a test RoomState with sensible defaults.
 * Override any field by passing partial overrides.
 */
export function createRoom(overrides: Partial<RoomState> = {}): RoomState {
  return {
    code: "ABC123",
    name: "Test Room",
    participants: new Map(),
    logs: [],
    connected: false,
    processingRequests: new Set(),
    ...overrides,
  };
}

/**
 * Creates a test ParticipantInfo with required fields.
 */
export function createParticipant(
  id: string,
  nickname: string,
  overrides: Partial<ParticipantInfo> = {}
): ParticipantInfo {
  const now = Date.now();
  return {
    id,
    nickname,
    model: "llama3",
    endpoint: "http://localhost:11434",
    status: "online",
    joinedAt: now,
    updatedAt: now,
    lastSeen: now,
    specs: {},
    config: { hasInstructions: false },
    capabilities: {
      openResponses: "unknown",
      chatCompletions: "unknown",
    },
    connection: {
      kind: "tunnel",
      connected: true,
      lastTunnelSeenAt: now,
    },
    ...overrides,
  };
}

/**
 * Creates a SSE buffer string from an array of events.
 * Useful for testing parseSSEBuffer.
 */
export function createSSEBuffer(
  events: Array<{ event: string; data: unknown }>
): string {
  return events
    .map((e) => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`)
    .join("");
}

/**
 * Creates a partial SSE buffer (incomplete - no trailing newlines).
 * Useful for testing streaming scenarios.
 */
export function createPartialSSEBuffer(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}`;
}

/**
 * Creates a room with participants already added.
 */
export function createRoomWithParticipants(
  participantCount: number,
  overrides: Partial<RoomState> = {}
): RoomState {
  const participants = new Map<string, ParticipantInfo>();
  for (let i = 0; i < participantCount; i++) {
    const id = `p${i + 1}`;
    participants.set(id, createParticipant(id, `Bot${i + 1}`));
  }
  return createRoom({ participants, ...overrides });
}
