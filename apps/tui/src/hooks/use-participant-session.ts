import {
  createParticipantSession,
  type ParticipantSession,
} from "@gambi/core/participant-session";
import { useCallback } from "react";
import { useAppStore } from "../store/app-store";
import { useSessionStore } from "../store/session-store";
import type {
  MachineSpecs,
  ParticipantAuthHeaders,
  ParticipantCapabilities,
  RuntimeConfig,
} from "@gambi/core/types";

let activeSession: ParticipantSession | null = null;

export interface JoinParticipantData {
  authHeaders?: ParticipantAuthHeaders;
  capabilities?: ParticipantCapabilities;
  config?: RuntimeConfig;
  endpoint: string;
  id: string;
  model: string;
  nickname: string;
  password?: string;
  specs?: MachineSpecs;
}

export interface UseParticipantSessionReturn {
  status: "idle" | "joining" | "joined" | "leaving" | "error";
  participantId: string | null;
  roomCode: string | null;
  error: string | null;
  join: (code: string, data: JoinParticipantData) => Promise<boolean>;
  leave: () => Promise<void>;
}

export function useParticipantSession(): UseParticipantSessionReturn {
  const hubUrl = useAppStore((s) => s.hubUrl);

  // Read state from session store
  const status = useSessionStore((s) => s.status);
  const participantId = useSessionStore((s) => s.participantId);
  const roomCode = useSessionStore((s) => s.roomCode);
  const error = useSessionStore((s) => s.error);

  // Get store actions
  const setJoining = useSessionStore((s) => s.setJoining);
  const setJoined = useSessionStore((s) => s.setJoined);
  const setLeaving = useSessionStore((s) => s.setLeaving);
  const setError = useSessionStore((s) => s.setError);
  const reset = useSessionStore((s) => s.reset);
  const setHealthStatus = useSessionStore((s) => s.setHealthStatus);

  const join = useCallback(
    async (code: string, data: JoinParticipantData): Promise<boolean> => {
      const currentStatus = useSessionStore.getState().status;
      if (currentStatus === "joined" || currentStatus === "joining") {
        setError("Leave the current participant session before joining again.");
        return false;
      }

      setJoining(code);

      try {
        const session = await createParticipantSession({
          hubUrl,
          roomCode: code,
          participantId: data.id,
          endpoint: data.endpoint,
          model: data.model,
          nickname: data.nickname,
          password: data.password,
          specs: data.specs,
          config: data.config,
          capabilities: data.capabilities,
          authHeaders: data.authHeaders,
        });

        activeSession = session;
        setJoined(session, session.participant.id, code, {
          nickname: session.participant.nickname,
          model: session.participant.model,
          endpoint: session.participant.endpoint,
        });
        setHealthStatus("healthy");

        session.waitUntilClosed().then((event) => {
          if (activeSession !== session) {
            return;
          }
          activeSession = null;
          if (event.reason === "closed") {
            reset();
            return;
          }
          setError(
            event.error?.message ??
              (event.reason === "heartbeat_failed"
                ? "Participant heartbeat failed."
                : "Participant tunnel closed.")
          );
          setHealthStatus("unhealthy");
        });
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setHealthStatus("unhealthy");
        return false;
      }
    },
    [hubUrl, setJoining, setJoined, setError, setHealthStatus, reset]
  );

  const leave = useCallback(async () => {
    setLeaving();
    const session = activeSession;
    activeSession = null;

    if (session) {
      await session.close();
    }

    reset();
  }, [setLeaving, reset]);

  return {
    status,
    participantId,
    roomCode,
    error,
    join,
    leave,
  };
}
