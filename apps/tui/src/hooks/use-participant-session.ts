import { useCallback, useEffect, useRef, useState } from "react";
import { type JoinParticipantData, useHubApi } from "./use-hub-api";

const HEALTH_CHECK_INTERVAL = 10_000;
const MAX_FAILURES = 3;

type SessionStatus = "idle" | "joining" | "joined" | "disconnected" | "error";

export interface UseParticipantSessionOptions {
  hubUrl: string;
}

export interface UseParticipantSessionReturn {
  status: SessionStatus;
  participantId: string | null;
  roomCode: string | null;
  error: string | null;
  join: (code: string, data: JoinParticipantData) => Promise<void>;
  leave: () => Promise<void>;
}

export function useParticipantSession(
  options: UseParticipantSessionOptions
): UseParticipantSessionReturn {
  const { hubUrl } = options;
  const api = useHubApi({ hubUrl });

  const [status, setStatus] = useState<SessionStatus>("idle");
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const healthIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const failureCountRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const stopHealthCheck = useCallback(() => {
    if (healthIntervalRef.current) {
      clearInterval(healthIntervalRef.current);
      healthIntervalRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, []);

  const startHealthCheck = useCallback(
    (code: string, id: string) => {
      stopHealthCheck();
      failureCountRef.current = 0;
      abortControllerRef.current = new AbortController();

      healthIntervalRef.current = setInterval(async () => {
        const result = await api.healthCheck(code, id);

        if (result.error) {
          failureCountRef.current += 1;
          if (failureCountRef.current >= MAX_FAILURES) {
            setStatus("disconnected");
            setError(
              `Lost connection after ${MAX_FAILURES} failed health checks`
            );
            stopHealthCheck();
          }
        } else {
          failureCountRef.current = 0;
        }
      }, HEALTH_CHECK_INTERVAL);
    },
    [api, stopHealthCheck]
  );

  const join = useCallback(
    async (code: string, data: JoinParticipantData) => {
      setStatus("joining");
      setError(null);

      const result = await api.joinRoom(code, data);

      if (result.error) {
        setStatus("error");
        setError(result.error);
        return;
      }

      if (result.data) {
        setParticipantId(result.data.participant.id);
        setRoomCode(code);
        setStatus("joined");
        startHealthCheck(code, result.data.participant.id);
      }
    },
    [api, startHealthCheck]
  );

  const leave = useCallback(async () => {
    stopHealthCheck();

    if (roomCode && participantId) {
      await api.leaveRoom(roomCode, participantId);
    }

    setStatus("idle");
    setParticipantId(null);
    setRoomCode(null);
    setError(null);
  }, [api, roomCode, participantId, stopHealthCheck]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopHealthCheck();
    };
  }, [stopHealthCheck]);

  return {
    status,
    participantId,
    roomCode,
    error,
    join,
    leave,
  };
}
