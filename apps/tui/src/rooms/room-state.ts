/**
 * What a monitor shows of a room, and how each room event changes it.
 *
 * `applyRoomEvent` is the only place that reads a room event. The events and
 * their fields are the ones of the management contract (`RoomEvent`), so a
 * new event there stops this file from compiling until it has a case.
 */
import type {
  ActivityLogType,
  ParticipantSummary,
  RoomEvent,
  RoomState,
} from "../types";

/** A line for the activity log of a room. */
export interface LogAction {
  message: string;
  metrics?: { tokensPerSecond?: number; latencyMs?: number };
  participantId: string;
  participantName?: string;
  type: ActivityLogType;
}

export interface EventResult {
  log?: LogAction;
  room: RoomState;
}

/** A room nothing is known about yet: its stream has not opened. */
export const emptyRoom = (code: string): RoomState => ({
  code,
  name: code,
  participants: new Map(),
  logs: [],
  connected: false,
  processingRequests: new Set(),
});

const withParticipant = (
  room: RoomState,
  participant: ParticipantSummary
): RoomState => ({
  ...room,
  participants: new Map(room.participants).set(participant.id, participant),
});

const withoutRequest = (room: RoomState, participantId: string): RoomState => {
  const processingRequests = new Set(room.processingRequests);
  processingRequests.delete(participantId);
  return { ...room, processingRequests };
};

const about = (
  participant: ParticipantSummary,
  type: ActivityLogType,
  what: string
): LogAction => ({
  type,
  participantId: participant.id,
  participantName: participant.nickname,
  message: `${participant.nickname} ${what}`,
});

export const applyRoomEvent = (
  room: RoomState,
  event: RoomEvent
): EventResult => {
  switch (event.type) {
    // The first event of every stream: it replaces whatever was known, which
    // is what realigns the room after a reconnection.
    case "room.snapshot":
      return {
        room: {
          ...room,
          name: event.room.name,
          connected: true,
          // Whoever is `busy` is answering a request right now.
          processingRequests: new Set(
            event.participants
              .filter((participant) => participant.status === "busy")
              .map((participant) => participant.id)
          ),
          participants: new Map(
            event.participants.map((participant) => [
              participant.id,
              participant,
            ])
          ),
        },
      };
    case "participant.joined":
      return {
        room: withParticipant(room, event.participant),
        log: about(event.participant, "join", "joined"),
      };
    // A status has one source: the hub, which sends the participant after
    // each change. Nothing here derives a status from anything else.
    case "participant.online":
      return {
        room: withParticipant(room, event.participant),
        // Coming back from `busy` is the end of a request, which has its own
        // line (`llm.complete` or `llm.error`).
        ...(event.previousStatus === "offline"
          ? { log: about(event.participant, "online", "online") }
          : {}),
      };
    case "participant.offline":
      return {
        room: withParticipant(room, event.participant),
        log: about(event.participant, "offline", "offline"),
      };
    case "participant.busy":
      return { room: withParticipant(room, event.participant) };
    case "llm.request": {
      const nickname = room.participants.get(event.participantId)?.nickname;
      return {
        room: {
          ...room,
          processingRequests: new Set(room.processingRequests).add(
            event.participantId
          ),
        },
        log: {
          type: "request",
          participantId: event.participantId,
          ...(nickname === undefined ? {} : { participantName: nickname }),
          message: `req → ${nickname ?? event.participantId} (${event.model})`,
        },
      };
    }
    case "llm.complete":
      return {
        room: withoutRequest(room, event.participantId),
        log: {
          type: "complete",
          participantId: event.participantId,
          message: "complete",
          metrics: {
            latencyMs: event.metrics.durationMs,
            ...(event.metrics.tokensPerSecond === undefined
              ? {}
              : { tokensPerSecond: event.metrics.tokensPerSecond }),
          },
        },
      };
    case "llm.error":
      return {
        room: withoutRequest(room, event.participantId),
        log: {
          type: "error",
          participantId: event.participantId,
          message: `error: ${event.error}`,
        },
      };
    case "participant.updated":
      return { room: withParticipant(room, event.participant) };
    case "participant.removed": {
      const participant = room.participants.get(event.participantId);
      const participants = new Map(room.participants);
      participants.delete(event.participantId);
      return {
        room: {
          ...withoutRequest(room, event.participantId),
          participants,
        },
        ...(participant === undefined
          ? {}
          : {
              log: about(
                participant,
                "leave",
                event.reason === "left" ? "left" : "removed (did not reconnect)"
              ),
            }),
      };
    }
    default: {
      // A new event of the contract stops compiling here until it has a case.
      const _unhandled: never = event;
      return { room };
    }
  }
};
