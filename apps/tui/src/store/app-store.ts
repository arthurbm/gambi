import { create } from "zustand";

interface AppState {
  hubUrl: string;
  setHubUrl: (url: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  hubUrl: "http://localhost:3000",
  setHubUrl: (hubUrl) => set({ hubUrl }),
}));
