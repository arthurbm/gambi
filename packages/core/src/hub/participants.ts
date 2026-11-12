/**
 * The participants of the rooms of one hub, and their status.
 *
 * `transition` is the only place a status changes: it runs the event through
 * `transitionStatus` (the table of the spec) and stores the result. Whatever
 * must follow a change of status, such as a room event, belongs there.
 *
 * The service does not know rooms: the caller answers for the room existing.
 * `Rooms` reads `count` for its summaries.
 */
import {
  type ParticipantCapabilities,
  type ParticipantStatus,
  type ParticipantSummary,
  type RegisterParticipant,
  type RuntimeConfig,
  type StatusAfter,
  type StatusEvent,
  toRuntimeConfigPublic,
  transitionStatus,
} from "@gambi/protocol";
import { Clock, Context, Effect, Layer } from "effect";

/** What a registration says about the participant: everything but the password and the version. */
export type ParticipantProfile = Omit<
  RegisterParticipant,
  "authHeaders" | "password" | "version"
>;

interface ParticipantState {
  readonly capabilities: ParticipantCapabilities;
  readonly config: RuntimeConfig;
  readonly endpoint: string | undefined;
  readonly id: string;
  readonly joinedAt: number;
  readonly model: string;
  readonly nickname: string;
  readonly specs: NonNullable<ParticipantProfile["specs"]>;
  readonly status: ParticipantStatus;
  readonly updatedAt: number;
}

/** A change of status that happened: what #115 turns into a room event. */
export interface StatusChange {
  readonly event: StatusEvent;
  readonly from: ParticipantStatus | undefined;
  readonly participantId: string;
  readonly roomCode: string;
  readonly to: StatusAfter;
}

const UNKNOWN_CAPABILITIES: ParticipantCapabilities = {
  openResponses: "unknown",
  chatCompletions: "unknown",
};

// The instructions text never leaves the hub.
const toSummary = (participant: ParticipantState): ParticipantSummary => ({
  id: participant.id,
  nickname: participant.nickname,
  model: participant.model,
  ...(participant.endpoint === undefined
    ? {}
    : { endpoint: participant.endpoint }),
  config: toRuntimeConfigPublic(participant.config),
  specs: participant.specs,
  capabilities: participant.capabilities,
  status: participant.status,
  joinedAt: participant.joinedAt,
  updatedAt: participant.updatedAt,
});

export class Participants extends Context.Service<
  Participants,
  {
    /** How many participants the room has, whatever their status. */
    readonly count: (roomCode: string) => Effect.Effect<number>;
    readonly list: (
      roomCode: string
    ) => Effect.Effect<readonly ParticipantSummary[]>;
    /**
     * Adds the participant to the room, `offline`. An id that is already in
     * the room is updated instead and keeps its `joinedAt` and its status.
     */
    readonly register: (
      roomCode: string,
      participantId: string,
      profile: ParticipantProfile
    ) => Effect.Effect<ParticipantSummary>;
    /** The status of a participant; `undefined` when it is not in the room. */
    readonly status: (
      roomCode: string,
      participantId: string
    ) => Effect.Effect<ParticipantStatus | undefined>;
    /**
     * Applies `event` to the participant. Answers the change, or `undefined`
     * when the status table has no row for it (nothing changed).
     */
    readonly transition: (
      roomCode: string,
      participantId: string,
      event: StatusEvent
    ) => Effect.Effect<StatusChange | undefined>;
  }
>()("gambi/core/Participants") {
  static readonly layer = Layer.sync(Participants, () => {
    const byRoom = new Map<string, Map<string, ParticipantState>>();

    const roomOf = (roomCode: string) => {
      let room = byRoom.get(roomCode);
      if (room === undefined) {
        room = new Map();
        byRoom.set(roomCode, room);
      }
      return room;
    };

    const transition = Effect.fn("Participants.transition")(function* (
      roomCode: string,
      participantId: string,
      event: StatusEvent
    ) {
      const room = roomOf(roomCode);
      const participant = room.get(participantId);
      const to = transitionStatus(participant?.status, event);
      // Only registration brings a participant in, with its profile.
      if (to === undefined || participant === undefined) {
        return undefined;
      }
      if (to === "removed") {
        room.delete(participantId);
      } else {
        room.set(participantId, {
          ...participant,
          status: to,
          updatedAt: yield* Clock.currentTimeMillis,
        });
      }
      const change: StatusChange = {
        roomCode,
        participantId,
        event,
        from: participant.status,
        to,
      };
      yield* Effect.logInfo("participant status changed").pipe(
        Effect.annotateLogs({ ...change })
      );
      // #115: emit the room event of `change` here.
      return change;
    });

    const register = Effect.fn("Participants.register")(function* (
      roomCode: string,
      participantId: string,
      profile: ParticipantProfile
    ) {
      const room = roomOf(roomCode);
      const existing = room.get(participantId);
      const now = yield* Clock.currentTimeMillis;
      // The table has one row for registration: a new participant starts
      // offline. For one already in the room it changes no status.
      const status =
        existing?.status ?? transitionStatus(undefined, "registered");
      if (status === undefined || status === "removed") {
        return yield* Effect.die(
          new Error("The status table must register a participant offline.")
        );
      }
      const participant: ParticipantState = {
        id: participantId,
        nickname: profile.nickname,
        model: profile.model,
        endpoint: profile.endpoint,
        config: profile.config ?? {},
        specs: profile.specs ?? {},
        capabilities: profile.capabilities ?? UNKNOWN_CAPABILITIES,
        status,
        joinedAt: existing?.joinedAt ?? now,
        updatedAt: now,
      };
      room.set(participantId, participant);
      yield* Effect.logInfo(
        existing === undefined
          ? "participant registered"
          : "participant updated"
      ).pipe(Effect.annotateLogs({ roomCode, participantId }));
      // #115: emit the room event of a registration here.
      return toSummary(participant);
    });

    return Participants.of({
      count: (roomCode) => Effect.sync(() => byRoom.get(roomCode)?.size ?? 0),
      list: (roomCode) =>
        Effect.sync(() =>
          [...(byRoom.get(roomCode)?.values() ?? [])].map(toSummary)
        ),
      register,
      status: (roomCode, participantId) =>
        Effect.sync(() => byRoom.get(roomCode)?.get(participantId)?.status),
      transition,
    });
  });
}
