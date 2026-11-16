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
  NoParticipantAvailable,
  ParticipantBusy,
  type ParticipantCapabilities,
  ParticipantOffline,
  type ParticipantStatus,
  type ParticipantSummary,
  type RegisterParticipant,
  type RuntimeConfig,
  type StatusAfter,
  type StatusEvent,
  toRuntimeConfigPublic,
  transitionStatus,
} from "@gambi/protocol";
import { Clock, Context, Effect, Layer, Random } from "effect";

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
  | ParticipantBusy
  | ParticipantOffline;

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
     * why (`ParticipantBusy`, `ParticipantOffline`); every other miss is
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
        return new ParticipantBusy({ roomCode, participantId: named.id });
      }
      if (named?.status === "offline") {
        return new ParticipantOffline({ roomCode, participantId: named.id });
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
  });
}
