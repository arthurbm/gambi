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

  // Health tracking
  healthStatus: HealthStatus;
  lastHealthCheck: Date | null;
  consecutiveFailures: number;

  // Connection actions
  setJoining: (roomCode: string) => void;
  setJoined: (
    participantId: string,
    roomCode: string,
    details?: { nickname?: string; model?: string; endpoint?: string }
  ) => void;
  setLeaving: () => void;
  setError: (error: string) => void;
  reset: () => void;

  // Health actions
  setHealthStatus: (status: HealthStatus) => void;
  recordHealthCheck: (success: boolean) => void;
}

const DEGRADED_THRESHOLD = 1;
const UNHEALTHY_THRESHOLD = 3;

export const useSessionStore = create<SessionState>((set, get) => ({
  // Initial connection state
  status: "idle",
  participantId: null,
  roomCode: null,
  nickname: null,
  model: null,
  endpoint: null,
  error: null,

  // Initial health state
  healthStatus: "healthy",
  lastHealthCheck: null,
  consecutiveFailures: 0,

  // Connection actions
  setJoining: (roomCode) => set({ status: "joining", roomCode, error: null }),

  setJoined: (participantId, roomCode, details) =>
    set({
      status: "joined",
      participantId,
      roomCode,
      nickname: details?.nickname ?? null,
      model: details?.model ?? null,
      endpoint: details?.endpoint ?? null,
      error: null,
      healthStatus: "healthy",
      consecutiveFailures: 0,
    }),

  setLeaving: () => set({ status: "leaving" }),

  setError: (error) => set({ status: "error", error }),

  reset: () =>
    set({
      status: "idle",
      participantId: null,
      roomCode: null,
      nickname: null,
      model: null,
      endpoint: null,
      error: null,
      healthStatus: "healthy",
      lastHealthCheck: null,
      consecutiveFailures: 0,
    }),

  // Health actions
  setHealthStatus: (healthStatus) => set({ healthStatus }),

  recordHealthCheck: (success) => {
    const current = get();

    if (success) {
      set({
        healthStatus: "healthy",
        lastHealthCheck: new Date(),
        consecutiveFailures: 0,
      });
    } else {
      const failures = current.consecutiveFailures + 1;
      let healthStatus: HealthStatus = "healthy";

      if (failures >= UNHEALTHY_THRESHOLD) {
        healthStatus = "unhealthy";
      } else if (failures >= DEGRADED_THRESHOLD) {
        healthStatus = "degraded";
      }

      set({
        healthStatus,
        consecutiveFailures: failures,
      });
    }
  },
}));
