import type { ParticipantSession } from "@gambi/core/participant-session";
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
  session: ParticipantSession | null;

  // Health tracking
  healthStatus: HealthStatus;
  lastHealthCheck: Date | null;

  // Connection actions
  setJoining: (roomCode: string) => void;
  setJoined: (
    session: ParticipantSession,
    participantId: string,
    roomCode: string,
    details?: { nickname?: string; model?: string; endpoint?: string }
  ) => void;
  setLeaving: () => void;
  setError: (error: string, closeReason?: string) => void;
  reset: () => void;

  // Health actions
  setHealthStatus: (status: HealthStatus) => void;
  markHealthy: () => void;
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
  session: null,

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

  setJoined: (session, participantId, roomCode, details) =>
    set({
      status: "joined",
      participantId,
      roomCode,
      nickname: details?.nickname ?? null,
      model: details?.model ?? null,
      endpoint: details?.endpoint ?? null,
      error: null,
      closeReason: null,
      session,
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
      session: null,
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
      session: null,
      healthStatus: "healthy",
      lastHealthCheck: null,
    }),

  // Health actions
  setHealthStatus: (healthStatus) => set({ healthStatus }),

  markHealthy: () =>
    set({
      healthStatus: "healthy",
      lastHealthCheck: new Date(),
    }),
}));
