import { useCallback, useEffect, useRef } from "react";
import { useSessionStore } from "../store/session-store";
import { type JoinParticipantData, useHubApi } from "./use-hub-api";

const HEALTH_CHECK_INTERVAL = 10_000;
const MAX_FAILURES = 3;

export interface UseParticipantSessionReturn {
  status: "idle" | "joining" | "joined" | "leaving" | "error";
  participantId: string | null;
  roomCode: string | null;
  error: string | null;
  join: (code: string, data: JoinParticipantData) => Promise<boolean>;
  leave: () => Promise<void>;
}

export function useParticipantSession(): UseParticipantSessionReturn {
  const api = useHubApi();

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
  const recordHealthCheck = useSessionStore((s) => s.recordHealthCheck);

  const healthIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const failureCountRef = useRef(0);

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
        const success = !result.error;

        // Update global health status in session store
        recordHealthCheck(success);

        if (success) {
          failureCountRef.current = 0;
        } else {
          failureCountRef.current += 1;
          if (failureCountRef.current >= MAX_FAILURES) {
            setError(
              `Lost connection after ${MAX_FAILURES} failed health checks`
            );
            stopHealthCheck();
          }
        }
      }, HEALTH_CHECK_INTERVAL);
    },
    [api, stopHealthCheck, recordHealthCheck, setError]
  );

  const join = useCallback(
    async (code: string, data: JoinParticipantData): Promise<boolean> => {
      setJoining(code);

      const result = await api.joinRoom(code, data);

      if (result.error) {
        setError(result.error);
        return false;
      }

      if (result.data) {
        setJoined(result.data.participant.id, code, {
          nickname: data.nickname,
          model: data.model,
          endpoint: data.endpoint,
        });
        startHealthCheck(code, result.data.participant.id);
        return true;
      }

      return false;
    },
    [api, setJoining, setJoined, setError, startHealthCheck]
  );

  const leave = useCallback(async () => {
    setLeaving();
    stopHealthCheck();

    // Get current values from store for API call
    const currentState = useSessionStore.getState();
    if (currentState.roomCode && currentState.participantId) {
      await api.leaveRoom(currentState.roomCode, currentState.participantId);
    }

    reset();
  }, [api, setLeaving, reset, stopHealthCheck]);

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
