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

  // How the participant runtime is doing: `healthy` while its tunnel is
  // open, `degraded` while it tries to come back, `unhealthy` once it ended.
  healthStatus: HealthStatus;

  // Connection actions
  setJoining: (roomCode: string) => void;
  setJoined: (
    participantId: string,
    roomCode: string,
    details?: { nickname?: string; model?: string; endpoint?: string }
  ) => void;
  /** The runtime lost its tunnel (`degraded`) or got it back (`healthy`). */
  setConnection: (healthStatus: "healthy" | "degraded") => void;
  setLeaving: () => void;
  setError: (error: string) => void;
  reset: () => void;
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

  // Initial health state
  healthStatus: "healthy",

  // Connection actions
  setJoining: (roomCode) =>
    set({
      status: "joining",
      roomCode,
      error: null,
      healthStatus: "degraded",
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
      healthStatus: "healthy",
    }),

  setConnection: (healthStatus) => {
    // Only a session that is in the room has a connection to speak of.
    if (get().status === "joined") {
      set({ healthStatus });
    }
  },

  setLeaving: () => set({ status: "leaving", healthStatus: "degraded" }),

  setError: (error) =>
    set({
      status: "error",
      error,
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
      healthStatus: "healthy",
    }),
}));
