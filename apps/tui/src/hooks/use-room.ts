import { ParticipantInfo as ParticipantInfoSchema } from "@gambi/core/types";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import type { ActivityLogEntry, ParticipantInfo, RoomState } from "../types";
import {
  SSEConnectedEvent,
  SSELlmCompleteEvent,
  SSELlmErrorEvent,
  SSELlmRequestEvent,
  SSEParticipantJoinedEvent,
  SSEParticipantLeftEvent,
  SSEParticipantOfflineEvent,
  SSEParticipantUpdatedEvent,
  SSERoomCreatedEvent,
} from "../types";
import { useSSE } from "./use-sse";

interface UseRoomOptions {
  hubUrl: string;
  roomCode: string;
  enabled?: boolean;
}

interface UseRoomReturn extends RoomState {
  refresh: () => Promise<void>;
}

export function useRoom(options: UseRoomOptions): UseRoomReturn {
  const { hubUrl, roomCode, enabled = true } = options;

  const [participants, setParticipants] = useState<
    Map<string, ParticipantInfo>
  >(new Map());
  const [logs, setLogs] = useState<ActivityLogEntry[]>([]);
  const [processingRequests, setProcessingRequests] = useState<Set<string>>(
    new Set()
  );
  const [name, setName] = useState(roomCode);

  // Ref to access current participants in event handler
  const participantsRef = useRef(participants);
  participantsRef.current = participants;

  // Fetch initial participants
  const fetchParticipants = useCallback(async () => {
    try {
      const response = await fetch(
        `${hubUrl}/v1/rooms/${roomCode}/participants`
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const envelope = (await response.json()) as { data?: unknown };
      const parsed = z
        .array(ParticipantInfoSchema)
        .safeParse(envelope.data ?? envelope);
      if (!parsed.success) {
        console.error("Invalid participants data:", parsed.error);
        return;
      }
      const map = new Map<string, ParticipantInfo>();
      for (const p of parsed.data) {
        map.set(p.id, p);
      }
      setParticipants(map);
    } catch {
      // Will be handled by SSE connection error
    }
  }, [hubUrl, roomCode]);

  const addLog = useCallback(
    (entry: Omit<ActivityLogEntry, "id" | "timestamp" | "roomCode">) => {
      setLogs((prev) => {
        const newEntry: ActivityLogEntry = {
          ...entry,
          id: nanoid(),
          timestamp: Date.now(),
          roomCode,
        };
        // Keep last 100 entries
        const next = [...prev, newEntry];
        if (next.length > 100) {
          return next.slice(-100);
        }
        return next;
      });
    },
    [roomCode]
  );

  // Individual event handlers
  const handleConnected = useCallback(
    (data: unknown) => {
      if (SSEConnectedEvent.safeParse(data).success) {
        fetchParticipants();
      }
    },
    [fetchParticipants]
  );

  const handleRoomCreated = useCallback(
    (data: unknown) => {
      const parsed = SSERoomCreatedEvent.safeParse(data);
      if (parsed.success && parsed.data.code === roomCode) {
        setName(parsed.data.name);
      }
    },
    [roomCode]
  );

  const handleParticipantJoined = useCallback(
    (data: unknown) => {
      const parsed = SSEParticipantJoinedEvent.safeParse(data);
      if (parsed.success) {
        const participant = parsed.data;
        setParticipants((prev) =>
          new Map(prev).set(participant.id, participant)
        );
        addLog({
          type: "join",
          participantId: participant.id,
          participantName: participant.nickname,
          message: `${participant.nickname} joined`,
        });
      }
    },
    [addLog]
  );

  const handleParticipantUpdated = useCallback((data: unknown) => {
    const parsed = SSEParticipantUpdatedEvent.safeParse(data);
    if (parsed.success) {
      const participant = parsed.data;
      setParticipants((prev) =>
        new Map(prev).set(participant.id, participant)
      );
    }
  }, []);

  const handleParticipantLeft = useCallback(
    (data: unknown) => {
      const parsed = SSEParticipantLeftEvent.safeParse(data);
      if (parsed.success) {
        const { participantId } = parsed.data;
        const participant = participantsRef.current.get(participantId);
        setParticipants((prev) => {
          const next = new Map(prev);
          next.delete(participantId);
          return next;
        });
        if (participant) {
          addLog({
            type: "leave",
            participantId,
            participantName: participant.nickname,
            message: `${participant.nickname} left`,
          });
        }
      }
    },
    [addLog]
  );

  const handleParticipantOffline = useCallback(
    (data: unknown) => {
      const parsed = SSEParticipantOfflineEvent.safeParse(data);
      if (parsed.success) {
        const { participantId } = parsed.data;
        const participant = participantsRef.current.get(participantId);
        if (participant) {
          setParticipants((prev) =>
            new Map(prev).set(participantId, {
              ...participant,
              status: "offline",
            })
          );
          addLog({
            type: "offline",
            participantId,
            participantName: participant.nickname,
            message: `${participant.nickname} offline`,
          });
        }
      }
    },
    [addLog]
  );

  const handleLlmRequest = useCallback(
    (data: unknown) => {
      const parsed = SSELlmRequestEvent.safeParse(data);
      if (parsed.success) {
        const { participantId, model } = parsed.data;
        setProcessingRequests((prev) => new Set(prev).add(participantId));
        const participant = participantsRef.current.get(participantId);
        if (participant) {
          setParticipants((prev) =>
            new Map(prev).set(participantId, { ...participant, status: "busy" })
          );
        }
        addLog({
          type: "request",
          participantId,
          participantName: participant?.nickname,
          message: `req → ${participant?.nickname ?? participantId} (${model})`,
        });
      }
    },
    [addLog]
  );

  const handleLlmComplete = useCallback(
    (data: unknown) => {
      const parsed = SSELlmCompleteEvent.safeParse(data);
      if (parsed.success) {
        const { participantId, metrics } = parsed.data;
        setProcessingRequests((prev) => {
          const next = new Set(prev);
          next.delete(participantId);
          return next;
        });
        const participant = participantsRef.current.get(participantId);
        if (participant) {
          setParticipants((prev) =>
            new Map(prev).set(participantId, {
              ...participant,
              status: "online",
            })
          );
        }
        addLog({
          type: "complete",
          participantId,
          message: "complete",
          metrics,
        });
      }
    },
    [addLog]
  );

  const handleLlmError = useCallback(
    (data: unknown) => {
      const parsed = SSELlmErrorEvent.safeParse(data);
      if (parsed.success) {
        const { participantId, error: errorMsg } = parsed.data;
        setProcessingRequests((prev) => {
          const next = new Set(prev);
          next.delete(participantId);
          return next;
        });
        const participant = participantsRef.current.get(participantId);
        if (participant) {
          setParticipants((prev) =>
            new Map(prev).set(participantId, {
              ...participant,
              status: "online",
            })
          );
        }
        addLog({ type: "error", participantId, message: `error: ${errorMsg}` });
      }
    },
    [addLog]
  );

  const handleEvent = useCallback(
    (event: string, data: unknown) => {
      const handlers: Record<string, (d: unknown) => void> = {
        connected: handleConnected,
        "room.created": handleRoomCreated,
        "participant.joined": handleParticipantJoined,
        "participant.updated": handleParticipantUpdated,
        "participant.left": handleParticipantLeft,
        "participant.offline": handleParticipantOffline,
        "llm.request": handleLlmRequest,
        "llm.complete": handleLlmComplete,
        "llm.error": handleLlmError,
      };
      handlers[event]?.(data);
    },
    [
      handleConnected,
      handleRoomCreated,
      handleParticipantJoined,
      handleParticipantUpdated,
      handleParticipantLeft,
      handleParticipantOffline,
      handleLlmRequest,
      handleLlmComplete,
      handleLlmError,
    ]
  );

  const { connected, reconnect } = useSSE({
    hubUrl,
    roomCode,
    onEvent: handleEvent,
    enabled,
  });

  // Fetch participants on mount
  useEffect(() => {
    if (enabled) {
      fetchParticipants();
    }
  }, [enabled, fetchParticipants]);

  return {
    code: roomCode,
    name,
    participants,
    logs,
    connected,
    processingRequests,
    refresh: async () => {
      await fetchParticipants();
      reconnect();
    },
  };
}
