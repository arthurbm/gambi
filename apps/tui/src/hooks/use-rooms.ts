import { ParticipantInfo as ParticipantInfoSchema } from "@gambi/core/types";
import { useQueryClient } from "@tanstack/react-query";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useAppStore } from "../store/app-store";
import type { ActivityLogEntry, ParticipantInfo, RoomState } from "../types";
import { roomKeys } from "./queries";

export type { RoomState } from "../types";

import {
  SSELlmCompleteEvent,
  SSELlmErrorEvent,
  SSELlmRequestEvent,
  SSEParticipantJoinedEvent,
  SSEParticipantLeftEvent,
  SSEParticipantOfflineEvent,
  SSERoomCreatedEvent,
} from "../types";

interface RoomConnection {
  code: string;
  abortController: AbortController;
  connected: boolean;
}

interface RoomEventEnvelope {
  type: string;
  timestamp: number;
  roomCode: string;
  data: unknown;
}

interface UseRoomsReturn {
  rooms: Map<string, RoomState>;
  activeRoom: string | null;
  setActiveRoom: (code: string | null) => void;
  addRoom: (code: string) => void;
  removeRoom: (code: string) => void;
  refreshRoom: (code: string) => Promise<void>;
  allConnected: boolean;
}

const RECONNECT_DELAY = 3000;

function isRoomEventEnvelope(value: unknown): value is RoomEventEnvelope {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "string" &&
    "timestamp" in value &&
    typeof value.timestamp === "number" &&
    "roomCode" in value &&
    typeof value.roomCode === "string" &&
    "data" in value
  );
}

export function unwrapSSEEventPayload(
  fallbackEvent: string,
  payload: unknown
): { event: string; data: unknown } {
  if (isRoomEventEnvelope(payload)) {
    return {
      event: payload.type,
      data: payload.data,
    };
  }

  return {
    event: fallbackEvent,
    data: payload,
  };
}

// Types for event handler results - exported for testing
export interface LogAction {
  type: "join" | "leave" | "offline" | "request" | "complete" | "error";
  participantId: string;
  participantName?: string;
  message: string;
  metrics?: { tokensPerSecond?: number; latencyMs?: number };
}

export interface EventResult {
  room: RoomState;
  log?: LogAction;
}

// Individual event handlers (pure functions) - exported for testing
export function handleConnectedEvent(room: RoomState): EventResult {
  return { room: { ...room, connected: true } };
}

export function handleRoomCreatedEvent(
  room: RoomState,
  code: string,
  data: unknown
): EventResult {
  const parsed = SSERoomCreatedEvent.safeParse(data);
  if (parsed.success && parsed.data.code === code) {
    return { room: { ...room, name: parsed.data.name } };
  }
  return { room };
}

export function handleParticipantJoinedEvent(
  room: RoomState,
  data: unknown
): EventResult {
  const parsed = SSEParticipantJoinedEvent.safeParse(data);
  if (!parsed.success) {
    return { room };
  }
  const participant = parsed.data;
  const participants = new Map(room.participants);
  participants.set(participant.id, participant);
  return {
    room: { ...room, participants },
    log: {
      type: "join",
      participantId: participant.id,
      participantName: participant.nickname,
      message: `${participant.nickname} joined`,
    },
  };
}

export function handleParticipantLeftEvent(
  room: RoomState,
  data: unknown
): EventResult {
  const parsed = SSEParticipantLeftEvent.safeParse(data);
  if (!parsed.success) {
    return { room };
  }
  const { participantId } = parsed.data;
  const participant = room.participants.get(participantId);
  const participants = new Map(room.participants);
  participants.delete(participantId);
  return {
    room: { ...room, participants },
    log: participant
      ? {
          type: "leave",
          participantId,
          participantName: participant.nickname,
          message: `${participant.nickname} left`,
        }
      : undefined,
  };
}

export function handleParticipantOfflineEvent(
  room: RoomState,
  data: unknown
): EventResult {
  const parsed = SSEParticipantOfflineEvent.safeParse(data);
  if (!parsed.success) {
    return { room };
  }
  const { participantId } = parsed.data;
  const participant = room.participants.get(participantId);
  if (!participant) {
    return { room };
  }
  const participants = new Map(room.participants);
  participants.set(participantId, { ...participant, status: "offline" });
  return {
    room: { ...room, participants },
    log: {
      type: "offline",
      participantId,
      participantName: participant.nickname,
      message: `${participant.nickname} offline`,
    },
  };
}

export function handleLlmRequestEvent(
  room: RoomState,
  data: unknown
): EventResult {
  const parsed = SSELlmRequestEvent.safeParse(data);
  if (!parsed.success) {
    return { room };
  }
  const { participantId, model } = parsed.data;
  const participant = room.participants.get(participantId);
  const processingRequests = new Set(room.processingRequests);
  processingRequests.add(participantId);

  let updatedRoom: RoomState = { ...room, processingRequests };
  if (participant) {
    const participants = new Map(room.participants);
    participants.set(participantId, { ...participant, status: "busy" });
    updatedRoom = { ...updatedRoom, participants };
  }

  return {
    room: updatedRoom,
    log: {
      type: "request",
      participantId,
      participantName: participant?.nickname,
      message: `req → ${participant?.nickname ?? participantId} (${model})`,
    },
  };
}

export function handleLlmCompleteEvent(
  room: RoomState,
  data: unknown
): EventResult {
  const parsed = SSELlmCompleteEvent.safeParse(data);
  if (!parsed.success) {
    return { room };
  }
  const { participantId, metrics } = parsed.data;
  const participant = room.participants.get(participantId);
  const processingRequests = new Set(room.processingRequests);
  processingRequests.delete(participantId);

  let updatedRoom: RoomState = { ...room, processingRequests };
  if (participant) {
    const participants = new Map(room.participants);
    participants.set(participantId, { ...participant, status: "online" });
    updatedRoom = { ...updatedRoom, participants };
  }

  return {
    room: updatedRoom,
    log: {
      type: "complete",
      participantId,
      message: "complete",
      metrics,
    },
  };
}

export function handleLlmErrorEvent(
  room: RoomState,
  data: unknown
): EventResult {
  const parsed = SSELlmErrorEvent.safeParse(data);
  if (!parsed.success) {
    return { room };
  }
  const { participantId, error: errorMsg } = parsed.data;
  const participant = room.participants.get(participantId);
  const processingRequests = new Set(room.processingRequests);
  processingRequests.delete(participantId);

  let updatedRoom: RoomState = { ...room, processingRequests };
  if (participant) {
    const participants = new Map(room.participants);
    participants.set(participantId, { ...participant, status: "online" });
    updatedRoom = { ...updatedRoom, participants };
  }

  return {
    room: updatedRoom,
    log: {
      type: "error",
      participantId,
      message: `error: ${errorMsg}`,
    },
  };
}

// SSE buffer parsing helpers
interface SSEParseResult {
  events: Array<{ event: string; data: unknown }>;
  remaining: string;
}

function parseSSEBuffer(buffer: string): SSEParseResult {
  const events: Array<{ event: string; data: unknown }> = [];
  const lines = buffer.split("\n");
  let currentEvent = "";
  let currentData = "";

  for (const line of lines) {
    if (line === "") {
      if (currentEvent && currentData) {
        try {
          events.push({ event: currentEvent, data: JSON.parse(currentData) });
        } catch {
          // Invalid JSON, skip
        }
      }
      currentEvent = "";
      currentData = "";
    } else if (line.startsWith("event: ")) {
      currentEvent = line.slice(7);
    } else if (line.startsWith("data: ")) {
      currentData = line.slice(6);
    }
  }

  const remaining =
    currentEvent || currentData
      ? `event: ${currentEvent}\ndata: ${currentData}\n`
      : "";

  return { events, remaining };
}

export function useRooms(): UseRoomsReturn {
  const hubUrl = useAppStore((s) => s.hubUrl);
  const queryClient = useQueryClient();

  const [rooms, setRooms] = useState<Map<string, RoomState>>(new Map());
  const [activeRoom, setActiveRoom] = useState<string | null>(null);

  const connectionsRef = useRef<Map<string, RoomConnection>>(new Map());
  const reconnectTimeoutsRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());

  const addLog = useCallback(
    (
      code: string,
      entry: Omit<ActivityLogEntry, "id" | "timestamp" | "roomCode">
    ) => {
      setRooms((prev) => {
        const room = prev.get(code);
        if (!room) {
          return prev;
        }

        const newEntry: ActivityLogEntry = {
          ...entry,
          id: nanoid(),
          timestamp: Date.now(),
          roomCode: code,
        };

        const logs = [...room.logs, newEntry];
        const next = new Map(prev);
        next.set(code, {
          ...room,
          logs: logs.length > 100 ? logs.slice(-100) : logs,
        });
        return next;
      });
    },
    []
  );

  const handleSSEEvent = useCallback(
    (code: string, event: string, data: unknown) => {
      setRooms((prev) => {
        const room = prev.get(code);
        if (!room) {
          return prev;
        }

        const handlers: Record<
          string,
          (r: RoomState, d: unknown) => EventResult
        > = {
          connected: (r) => handleConnectedEvent(r),
          "room.created": (r, d) => handleRoomCreatedEvent(r, code, d),
          "participant.joined": handleParticipantJoinedEvent,
          "participant.left": handleParticipantLeftEvent,
          "participant.offline": handleParticipantOfflineEvent,
          "llm.request": handleLlmRequestEvent,
          "llm.complete": handleLlmCompleteEvent,
          "llm.error": handleLlmErrorEvent,
        };

        const handler = handlers[event];
        if (!handler) {
          return prev;
        }

        const result = handler(room, data);
        const next = new Map(prev);
        next.set(code, result.room);

        // Schedule log outside of setRooms to avoid nested setState
        if (result.log) {
          setTimeout(() => addLog(code, result.log as LogAction), 0);
        }

        return next;
      });

      // Invalidate participant queries when relevant events occur
      if (
        event === "participant.joined" ||
        event === "participant.left" ||
        event === "participant.offline"
      ) {
        queryClient.invalidateQueries({
          queryKey: roomKeys.participants(code),
        });
      }

      // Invalidate room list when room is created
      if (event === "room.created") {
        queryClient.invalidateQueries({ queryKey: roomKeys.list() });
      }
    },
    [addLog, queryClient]
  );

  const fetchParticipants = useCallback(
    async (code: string) => {
      try {
        const response = await fetch(`${hubUrl}/v1/rooms/${code}/participants`);
        if (!response.ok) {
          return;
        }

        const envelope = (await response.json()) as { data?: unknown };
        const participantsArray = envelope.data ?? envelope;
        const parsed = z
          .array(ParticipantInfoSchema)
          .safeParse(participantsArray);
        if (!parsed.success) {
          return;
        }

        const participants = new Map<string, ParticipantInfo>();
        for (const p of parsed.data) {
          participants.set(p.id, p);
        }

        setRooms((prev) => {
          const room = prev.get(code);
          if (!room) {
            return prev;
          }
          const next = new Map(prev);
          next.set(code, { ...room, participants });
          return next;
        });
      } catch {
        // Ignore fetch errors
      }
    },
    [hubUrl]
  );

  const processSSEStream = useCallback(
    async (
      reader: ReadableStreamDefaultReader,
      code: string
    ): Promise<void> => {
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const { events, remaining } = parseSSEBuffer(buffer);
        buffer = remaining;

        for (const sseEvent of events) {
          const unwrapped = unwrapSSEEventPayload(
            sseEvent.event,
            sseEvent.data
          );
          handleSSEEvent(code, unwrapped.event, unwrapped.data);
        }
      }
    },
    [handleSSEEvent]
  );

  const handleConnectionError = useCallback(
    (code: string, connectFn: (c: string) => void) => {
      setRooms((prev) => {
        const room = prev.get(code);
        if (!room) {
          return prev;
        }
        const next = new Map(prev);
        next.set(code, { ...room, connected: false });
        return next;
      });

      const timeout = setTimeout(() => {
        if (connectionsRef.current.has(code)) {
          connectFn(code);
        }
      }, RECONNECT_DELAY);
      reconnectTimeoutsRef.current.set(code, timeout);
    },
    []
  );

  const connectToRoom = useCallback(
    async (code: string) => {
      // Cleanup existing connection
      const existing = connectionsRef.current.get(code);
      if (existing) {
        existing.abortController.abort();
      }

      const abortController = new AbortController();
      connectionsRef.current.set(code, {
        code,
        abortController,
        connected: false,
      });

      try {
        const response = await fetch(`${hubUrl}/v1/rooms/${code}/events`, {
          signal: abortController.signal,
          headers: { Accept: "text/event-stream" },
        });

        if (!(response.ok && response.body)) {
          throw new Error(`HTTP ${response.status}`);
        }

        fetchParticipants(code);
        const reader =
          response.body.getReader() as unknown as ReadableStreamDefaultReader;
        await processSSEStream(reader, code);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }
        handleConnectionError(code, connectToRoom);
      }
    },
    [hubUrl, fetchParticipants, processSSEStream, handleConnectionError]
  );

  const addRoom = useCallback(
    (code: string) => {
      if (rooms.has(code)) {
        return;
      }

      setRooms((prev) => {
        const next = new Map(prev);
        next.set(code, {
          code,
          name: code,
          participants: new Map(),
          logs: [],
          connected: false,
          processingRequests: new Set(),
        });
        return next;
      });

      // Set as active if first room
      if (activeRoom === null) {
        setActiveRoom(code);
      }

      connectToRoom(code);
    },
    [rooms, activeRoom, connectToRoom]
  );

  const removeRoom = useCallback(
    (code: string) => {
      // Abort connection
      const connection = connectionsRef.current.get(code);
      if (connection) {
        connection.abortController.abort();
        connectionsRef.current.delete(code);
      }

      // Clear reconnect timeout
      const timeout = reconnectTimeoutsRef.current.get(code);
      if (timeout) {
        clearTimeout(timeout);
        reconnectTimeoutsRef.current.delete(code);
      }

      // Remove from state
      setRooms((prev) => {
        const next = new Map(prev);
        next.delete(code);
        return next;
      });

      // Update active room if needed
      setActiveRoom((current) => {
        if (current === code) {
          const remaining = [...rooms.keys()].filter((k) => k !== code);
          return remaining[0] ?? null;
        }
        return current;
      });
    },
    [rooms]
  );

  const refreshRoom = useCallback(
    async (code: string) => {
      await fetchParticipants(code);

      // Reconnect SSE
      const connection = connectionsRef.current.get(code);
      if (connection) {
        connection.abortController.abort();
      }
      connectToRoom(code);
    },
    [fetchParticipants, connectToRoom]
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const connection of connectionsRef.current.values()) {
        connection.abortController.abort();
      }
      for (const timeout of reconnectTimeoutsRef.current.values()) {
        clearTimeout(timeout);
      }
    };
  }, []);

  const allConnected =
    rooms.size > 0 && [...rooms.values()].every((r) => r.connected);

  return {
    rooms,
    activeRoom,
    setActiveRoom,
    addRoom,
    removeRoom,
    refreshRoom,
    allConnected,
  };
}
