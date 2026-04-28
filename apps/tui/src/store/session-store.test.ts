import { afterEach, describe, expect, test } from "bun:test";
import type { ParticipantSession } from "@gambi/core/participant-session";
import { useSessionStore } from "./session-store";

const mockSession = {
  close: async () => ({ reason: "closed" as const }),
  participant: {
    id: "p1",
    nickname: "Bot1",
    model: "llama3",
    endpoint: "http://localhost:11434",
    status: "online",
    joinedAt: Date.now(),
    lastSeen: Date.now(),
    updatedAt: Date.now(),
    specs: {},
    config: { hasInstructions: false },
    capabilities: { openResponses: "unknown", chatCompletions: "unknown" },
    connection: {
      kind: "tunnel",
      connected: true,
      lastTunnelSeenAt: Date.now(),
    },
  },
  roomId: "room-1",
  tunnel: { url: "ws://localhost:3000/tunnel", token: "token" },
  waitUntilClosed: async () => ({ reason: "closed" as const }),
} satisfies ParticipantSession;

afterEach(() => {
  // Reset store state between tests
  useSessionStore.getState().reset();
});

describe("session-store", () => {
  test("initial state is idle", () => {
    const state = useSessionStore.getState();

    expect(state.status).toBe("idle");
    expect(state.participantId).toBeNull();
    expect(state.roomCode).toBeNull();
    expect(state.error).toBeNull();
  });

  test("setJoining transitions correctly", () => {
    const { setJoining } = useSessionStore.getState();

    setJoining("ABC123");

    const state = useSessionStore.getState();
    expect(state.status).toBe("joining");
    expect(state.roomCode).toBe("ABC123");
    expect(state.error).toBeNull();
  });

  test("setJoined transitions correctly", () => {
    const { setJoined } = useSessionStore.getState();

    setJoined(mockSession, "p1", "ABC123");

    const state = useSessionStore.getState();
    expect(state.status).toBe("joined");
    expect(state.participantId).toBe("p1");
    expect(state.roomCode).toBe("ABC123");
    expect(state.error).toBeNull();
    expect(state.session).toBe(mockSession);
  });

  test("setError preserves roomCode", () => {
    const { setJoining, setError } = useSessionStore.getState();

    setJoining("ABC123");
    setError("Connection failed");

    const state = useSessionStore.getState();
    expect(state.status).toBe("error");
    expect(state.error).toBe("Connection failed");
    expect(state.roomCode).toBe("ABC123"); // preserved from previous state
  });

  test("reset clears all state", () => {
    const { setJoined, reset } = useSessionStore.getState();

    setJoined(mockSession, "p1", "ABC123");
    reset();

    const state = useSessionStore.getState();
    expect(state.status).toBe("idle");
    expect(state.participantId).toBeNull();
    expect(state.roomCode).toBeNull();
    expect(state.error).toBeNull();
    expect(state.session).toBeNull();
  });

  test("setJoining clears previous error", () => {
    const { setError, setJoining } = useSessionStore.getState();

    setError("Previous error");
    setJoining("XYZ789");

    const state = useSessionStore.getState();
    expect(state.error).toBeNull();
  });
});
