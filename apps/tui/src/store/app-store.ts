import { create } from "zustand";
import { loadConfig, updateConfig } from "../utils/config";

interface RoomInfo {
  code: string;
  connected: boolean;
}

interface AppState {
  hubUrl: string;
  setHubUrl: (url: string) => void;

  // Stable participant ID for retry-safe tunnel registrations
  participantId: string;
  setParticipantId: (id: string) => void;

  // Last used LLM endpoint (for join form)
  lastLlmEndpoint: string;
  setLastLlmEndpoint: (endpoint: string) => void;

  // Active rooms being monitored
  activeRooms: RoomInfo[];
  addRoom: (code: string) => void;
  removeRoom: (code: string) => void;
  setRoomConnected: (code: string, connected: boolean) => void;
}

// Load initial values from config
const initialConfig = loadConfig();
const initialParticipantId =
  initialConfig.participantId ?? crypto.randomUUID();
if (!initialConfig.participantId) {
  updateConfig({ participantId: initialParticipantId });
}

export const useAppStore = create<AppState>((set, get) => ({
  hubUrl: initialConfig.hubUrl ?? "http://localhost:3000",
  setHubUrl: (hubUrl) => {
    set({ hubUrl });
    updateConfig({ hubUrl });
  },

  participantId: initialParticipantId,
  setParticipantId: (participantId) => {
    set({ participantId });
    updateConfig({ participantId });
  },

  lastLlmEndpoint: initialConfig.llmEndpoint ?? "http://localhost:11434",
  setLastLlmEndpoint: (endpoint) => {
    set({ lastLlmEndpoint: endpoint });
    updateConfig({ llmEndpoint: endpoint });
  },

  activeRooms: [],

  addRoom: (code) => {
    const existing = get().activeRooms.find((r) => r.code === code);
    if (!existing) {
      set({ activeRooms: [...get().activeRooms, { code, connected: false }] });
    }
  },

  removeRoom: (code) => {
    set({ activeRooms: get().activeRooms.filter((r) => r.code !== code) });
  },

  setRoomConnected: (code, connected) => {
    set({
      activeRooms: get().activeRooms.map((r) =>
        r.code === code ? { ...r, connected } : r
      ),
    });
  },
}));
