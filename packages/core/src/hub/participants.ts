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
  NoParticipantAvailable,
  type ParticipantCapabilities,
  ParticipantIsBusy,
  ParticipantIsOffline,
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
import { Clock, Context, Effect, FiberMap, Layer, Random } from "effect";
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
  readonly id: string;
  readonly joinedAt: number;
  readonly model: string;
  readonly nickname: string;
  readonly specs: NonNullable<ParticipantProfile["specs"]>;
  readonly status: ParticipantStatus;
  readonly updatedAt: number;
}

/**
 * The participant a request was dispatched to, with what the inference plane
 * needs to build the request. `config` carries the instructions text: it
 * stays inside the hub.
 */
export interface DispatchedParticipant {
  readonly config: RuntimeConfig;
  readonly id: string;
  readonly model: string;
  readonly nickname: string;
}

/** Why a model selector found no participant to take a request. */
export type DispatchError =
  | NoParticipantAvailable
  | ParticipantIsBusy
  | ParticipantIsOffline;

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
    /**
     * Routes a request: picks the participant the model selector asks for
     * and marks it `busy`. Only an `online` participant is picked, so a
     * participant never takes two requests at once.
     *
     * The model selector has four forms:
     *
     * - `*` or `any`: any `online` participant, at random;
     * - `model:<name>`: the first `online` participant that shares that model;
     * - `<participantId>`: that participant;
     * - `<name>`, when no `online` participant has that id: the same as
     *   `model:<name>`. It is what an OpenAI client sends.
     *
     * A selector that names a participant that cannot take the request says
     * why (`ParticipantIsBusy`, `ParticipantIsOffline`); every other miss is
     * `NoParticipantAvailable`.
     *
     * The caller owes a `transition(..., "requestEnded")` when the request
     * ends, however it ends.
     */
    readonly dispatch: (
      roomCode: string,
      modelSelector: string
    ) => Effect.Effect<DispatchedParticipant, DispatchError>;
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

      const MODEL_PREFIX = "model:";

      /**
       * The participant the selector asks for, or why there is none. `chance`
       * is a number in `[0, 1)` that picks among equals.
       */
      const pick = (
        roomCode: string,
        modelSelector: string,
        chance: number
      ): ParticipantState | DispatchError => {
        const room = byRoom.get(roomCode);
        const online = [...(room?.values() ?? [])].filter(
          (participant) => participant.status === "online"
        );
        const sharing = (model: string) =>
          online.find((participant) => participant.model === model);
        const none = new NoParticipantAvailable({
          roomCode,
          model: modelSelector,
        });

        if (modelSelector === "*" || modelSelector === "any") {
          return online[Math.floor(chance * online.length)] ?? none;
        }
        if (modelSelector.startsWith(MODEL_PREFIX)) {
          return sharing(modelSelector.slice(MODEL_PREFIX.length)) ?? none;
        }
        const named = room?.get(modelSelector);
        if (named?.status === "online") {
          return named;
        }
        const byModel = sharing(modelSelector);
        if (byModel !== undefined) {
          return byModel;
        }
        if (named?.status === "busy") {
          return new ParticipantIsBusy({ roomCode, participantId: named.id });
        }
        if (named?.status === "offline") {
          return new ParticipantIsOffline({
            roomCode,
            participantId: named.id,
          });
        }
        return none;
      };

      const dispatch = Effect.fn("Participants.dispatch")(function* (
        roomCode: string,
        modelSelector: string
      ) {
        // Picking and marking busy are two steps, and another request may take
        // the participant in between: then the table has no row for
        // `requestDispatched`, and this one picks again.
        while (true) {
          const picked = pick(roomCode, modelSelector, yield* Random.next);
          if (!("status" in picked)) {
            return yield* picked;
          }
          const change = yield* transition(
            roomCode,
            picked.id,
            "requestDispatched"
          );
          if (change !== undefined) {
            return {
              id: picked.id,
              nickname: picked.nickname,
              model: picked.model,
              config: picked.config,
            } satisfies DispatchedParticipant;
          }
        }
      });

      return Participants.of({
        count: (roomCode) => Effect.sync(() => byRoom.get(roomCode)?.size ?? 0),
        list: (roomCode) =>
          Effect.sync(() =>
            [...(byRoom.get(roomCode)?.values() ?? [])].map(toSummary)
          ),
        dispatch,
        register,
        status: (roomCode, participantId) =>
          Effect.sync(() => byRoom.get(roomCode)?.get(participantId)?.status),
        transition,
      });
    })
  );
}
