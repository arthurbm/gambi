import { useCallback } from "react";
import {
  type JoinParticipantData,
  joinAsParticipant,
  leaveAsParticipant,
} from "../session/participant-session";
import { useAppStore } from "../store/app-store";
import { useSessionStore } from "../store/session-store";

export type { JoinParticipantData } from "../session/participant-session";

export interface UseParticipantSessionReturn {
  status: "idle" | "joining" | "joined" | "leaving" | "error";
  participantId: string | null;
  roomCode: string | null;
  error: string | null;
  join: (code: string, data: JoinParticipantData) => Promise<boolean>;
  leave: () => Promise<void>;
}

/** The TUI's own participant session, as the screens see it. */
export function useParticipantSession(): UseParticipantSessionReturn {
  const hubUrl = useAppStore((s) => s.hubUrl);

  // Read state from session store
  const status = useSessionStore((s) => s.status);
  const participantId = useSessionStore((s) => s.participantId);
  const roomCode = useSessionStore((s) => s.roomCode);
  const error = useSessionStore((s) => s.error);

  const join = useCallback(
    (code: string, data: JoinParticipantData) =>
      joinAsParticipant(hubUrl, code, data),
    [hubUrl]
  );

  return {
    status,
    participantId,
    roomCode,
    error,
    join,
    leave: leaveAsParticipant,
  };
}
