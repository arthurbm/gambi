import { create } from "zustand";

type SessionStatus = "idle" | "joining" | "joined" | "leaving" | "error";
export type HealthStatus = "healthy" | "degraded" | "unhealthy";

interface SessionState {
  // Connection state
  status: SessionStatus;
  participantId: string | null;
  roomCode: string | null;
  nickname: string | null;
  model: string | null;
  endpoint: string | null;
  error: string | null;
  closeReason: string | null;

  // Health tracking
  healthStatus: HealthStatus;
  lastHealthCheck: Date | null;

  // Connection actions
  setJoining: (roomCode: string) => void;
  setJoined: (
    participantId: string,
    roomCode: string,
    details?: { nickname?: string; model?: string; endpoint?: string }
  ) => void;
  setLeaving: () => void;
  setError: (error: string, closeReason?: string) => void;
  reset: () => void;

  // Health actions
  setHealthStatus: (status: HealthStatus) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  // Initial connection state
  status: "idle",
  participantId: null,
  roomCode: null,
  nickname: null,
  model: null,
  endpoint: null,
  error: null,
  closeReason: null,

  // Initial health state
  healthStatus: "healthy",
  lastHealthCheck: null,

  // Connection actions
  setJoining: (roomCode) =>
    set({
      status: "joining",
      roomCode,
      error: null,
      closeReason: null,
      healthStatus: "degraded",
      lastHealthCheck: null,
    }),

  setJoined: (participantId, roomCode, details) =>
    set({
      status: "joined",
      participantId,
      roomCode,
      nickname: details?.nickname ?? null,
      model: details?.model ?? null,
      endpoint: details?.endpoint ?? null,
      error: null,
      closeReason: null,
      healthStatus: "healthy",
      lastHealthCheck: new Date(),
    }),

  setLeaving: () => set({ status: "leaving", healthStatus: "degraded" }),

  setError: (error, closeReason) =>
    set({
      status: "error",
      error,
      closeReason: closeReason ?? null,
      healthStatus: "unhealthy",
    }),

  reset: () =>
    set({
      status: "idle",
      participantId: null,
      roomCode: null,
      nickname: null,
      model: null,
      endpoint: null,
      error: null,
      closeReason: null,
      healthStatus: "healthy",
      lastHealthCheck: null,
    }),

  // Health actions
  setHealthStatus: (healthStatus) => set({ healthStatus }),
}));
