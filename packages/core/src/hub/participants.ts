/**
 * The participants of the rooms of one hub, and their status.
 *
 * `transition` is the only place a status changes: it runs the event through
 * `transitionStatus` (the table of the spec), stores the result and publishes
 * the room event of the change. Whatever else must follow a change of status
 * belongs there.
 *
 * A participant that is `offline` has a deadline to reconnect
 * (`HubSettings.reconnectDeadline`); past it, the participant is removed.
 * Going online cancels the deadline, and registering again restarts it: that
 * is the first step of coming back, and it issues a bootstrap token that
 * needs the participant to still be in the room.
 *
 * The service does not know rooms: the caller answers for the room existing.
 * `Rooms` reads `count` for its summaries.
 */
import {
  type HarnessProfile,
  type ParticipantCapabilities,
  type ParticipantStatus,
  type ParticipantSummary,
  type RegisterParticipant,
  type RoomEventBody,
  type RuntimeConfig,
  type StatusAfter,
  type StatusEvent,
  toRuntimeConfigPublic,
  transitionStatus,
} from "@gambi/protocol";
import { Clock, Context, Effect, FiberMap, Layer } from "effect";
import { HarnessClients } from "./harness-clients.ts";
import { RoomEvents } from "./room-events.ts";
import { HubSettings } from "./settings.ts";

/** What a registration says about the participant: everything but the password and the version. */
export type ParticipantProfile = Omit<
  RegisterParticipant,
  "authHeaders" | "password" | "version"
>;

interface ParticipantState {
  readonly capabilities: ParticipantCapabilities;
  readonly config: RuntimeConfig;
  readonly endpoint: string | undefined;
  readonly harness: HarnessProfile | undefined;
  readonly id: string;
  readonly joinedAt: number;
  readonly model: string;
  readonly nickname: string;
  readonly specs: NonNullable<ParticipantProfile["specs"]>;
  readonly status: ParticipantStatus;
  readonly updatedAt: number;
}

/** A change of status that happened. */
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
  ...(participant.harness === undefined
    ? {}
    : { harness: participant.harness }),
  config: toRuntimeConfigPublic(participant.config),
  specs: participant.specs,
  capabilities: participant.capabilities,
  status: participant.status,
  joinedAt: participant.joinedAt,
  updatedAt: participant.updatedAt,
});

// A room code never contains a space, so the pair is unambiguous.
const keyOf = (roomCode: string, participantId: string) =>
  `${roomCode} ${participantId}`;

/** The room event of a change of status: one per row of the status table. */
const eventOf = (
  change: StatusChange,
  before: ParticipantState,
  after: ParticipantState | undefined
): RoomEventBody => {
  if (after === undefined) {
    return {
      type: "participant.removed",
      participantId: change.participantId,
      reason:
        change.event === "reconnectDeadlinePassed"
          ? "reconnectDeadlinePassed"
          : "left",
    };
  }
  return {
    type: `participant.${after.status}`,
    participant: toSummary(after),
    previousStatus: before.status,
  };
};

export class Participants extends Context.Service<
  Participants,
  {
    /** How many participants the room has, whatever their status. */
    readonly count: (roomCode: string) => Effect.Effect<number>;
    /** One participant of the room; `undefined` when it is not there. */
    readonly get: (
      roomCode: string,
      participantId: string
    ) => Effect.Effect<ParticipantSummary | undefined>;
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
  static readonly layer = Layer.effect(
    Participants,
    Effect.gen(function* () {
      const events = yield* RoomEvents;
      const harnessClients = yield* HarnessClients;
      const settings = yield* HubSettings;
      // One fiber per offline participant, sleeping until its deadline.
      const deadlines = yield* FiberMap.make<string>();
      const byRoom = new Map<string, Map<string, ParticipantState>>();

      const roomOf = (roomCode: string) => {
        let room = byRoom.get(roomCode);
        if (room === undefined) {
          room = new Map();
          byRoom.set(roomCode, room);
        }
        return room;
      };

      // (Re)starts the time an offline participant has to reconnect.
      const startDeadline = (
        roomCode: string,
        participantId: string
      ): Effect.Effect<void> =>
        Effect.sleep(settings.reconnectDeadline).pipe(
          Effect.andThen(
            transition(roomCode, participantId, "reconnectDeadlinePassed")
          ),
          FiberMap.run(deadlines, keyOf(roomCode, participantId)),
          Effect.asVoid
        );

      const transition: Participants["Service"]["transition"] = Effect.fn(
        "Participants.transition"
      )(function* (
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
        const after: ParticipantState | undefined =
          to === "removed"
            ? undefined
            : {
                ...participant,
                status: to,
                updatedAt: yield* Clock.currentTimeMillis,
              };
        if (after === undefined) {
          room.delete(participantId);
        } else {
          room.set(participantId, after);
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
        yield* events.publish(roomCode, eventOf(change, participant, after));
        if (after === undefined) {
          // Nobody stays attached to a harness that is out of the room.
          yield* harnessClients.detach(
            roomCode,
            participantId,
            event === "reconnectDeadlinePassed"
              ? "reconnectDeadlinePassed"
              : "left"
          );
        }
        if (to === "offline") {
          yield* startDeadline(roomCode, participantId);
        } else if (event !== "reconnectDeadlinePassed") {
          // The deadline that passed is the fiber running this.
          yield* FiberMap.remove(deadlines, keyOf(roomCode, participantId));
        }
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
          harness: profile.harness,
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
        if (status === "offline") {
          yield* startDeadline(roomCode, participantId);
        }
        const summary = toSummary(participant);
        yield* events.publish(roomCode, {
          type:
            existing === undefined
              ? "participant.joined"
              : "participant.updated",
          participant: summary,
        });
        return summary;
      });

      return Participants.of({
        count: (roomCode) => Effect.sync(() => byRoom.get(roomCode)?.size ?? 0),
        get: (roomCode, participantId) =>
          Effect.sync(() => {
            const participant = byRoom.get(roomCode)?.get(participantId);
            return participant === undefined
              ? undefined
              : toSummary(participant);
          }),
        list: (roomCode) =>
          Effect.sync(() =>
            [...(byRoom.get(roomCode)?.values() ?? [])].map(toSummary)
          ),
        register,
        status: (roomCode, participantId) =>
          Effect.sync(() => byRoom.get(roomCode)?.get(participantId)?.status),
        transition,
      });
    })
  );
}
