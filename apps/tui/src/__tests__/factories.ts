import type { ParticipantSummary, RoomState } from "../types";

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
 * Creates a test participant as a hub describes one.
 */
export function createParticipant(
  id: string,
  nickname: string,
  overrides: Partial<ParticipantSummary> = {}
): ParticipantSummary {
  const now = Date.now();
  return {
    id,
    nickname,
    model: "llama3",
    endpoint: "http://localhost:11434",
    status: "online",
    joinedAt: now,
    updatedAt: now,
    specs: {},
    config: { hasInstructions: false },
    capabilities: {
      openResponses: "unknown",
      chatCompletions: "unknown",
    },
    ...overrides,
  };
}

/**
 * Creates a room with participants already added.
 */
export function createRoomWithParticipants(
  participantCount: number,
  overrides: Partial<RoomState> = {}
): RoomState {
  const participants = new Map<string, ParticipantSummary>();
  for (let i = 0; i < participantCount; i++) {
    const id = `p${i + 1}`;
    participants.set(id, createParticipant(id, `Bot${i + 1}`));
  }
  return createRoom({ participants, ...overrides });
}
