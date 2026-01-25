import { create } from "zustand";

type SessionStatus = "idle" | "joining" | "joined" | "error";

interface SessionState {
  status: SessionStatus;
  participantId: string | null;
  roomCode: string | null;
  error: string | null;
  setJoining: (roomCode: string) => void;
  setJoined: (participantId: string, roomCode: string) => void;
  setError: (error: string) => void;
  reset: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  status: "idle",
  participantId: null,
  roomCode: null,
  error: null,
  setJoining: (roomCode) => set({ status: "joining", roomCode, error: null }),
  setJoined: (participantId, roomCode) =>
    set({ status: "joined", participantId, roomCode, error: null }),
  setError: (error) => set({ status: "error", error }),
  reset: () =>
    set({ status: "idle", participantId: null, roomCode: null, error: null }),
}));
