/**
 * The management client: rooms, participants and room events of one hub, in
 * `Promise`. It is the client derived from the management contract behind a
 * `Promise` boundary. It calls the hub with `fetch`, so it runs in Node and
 * in Bun alike.
 */
import { GAMBI_VERSION } from "@gambi/protocol";
import { Effect, Stream } from "effect";
import {
  type ManagementFailure,
  ManagementPlane,
  translated,
  translatedMidStream,
} from "./contract.ts";
import { withoutUndefined } from "./input.ts";
import { makePromiseBoundary } from "./promise.ts";
import type {
  AcpMessage,
  CreateRoomInput,
  HarnessAttachEvent,
  HarnessSessionRef,
  HubHealth,
  OpenHarnessSessionInput,
  ParticipantLeft,
  ParticipantRegistered,
  ParticipantSummary,
  RegisterParticipantInput,
  RoomCreated,
  RoomEvent,
  RoomSummary,
} from "./types.ts";

export const DEFAULT_HUB_URL = "http://localhost:3000";

export interface ClientOptions {
  /** The URL of the hub, without `/v1`. Default `http://localhost:3000`. */
  readonly hubUrl?: string;
}

export interface WatchOptions {
  /** Stops watching when it aborts. The iteration ends without an error. */
  readonly signal?: AbortSignal;
}

/**
 * Every method rejects with a `ClientError`; `error.code` says why.
 */
export interface GambiClient {
  /**
   * Ends every open `events.watch` and refuses later calls. A client that is
   * never closed holds nothing open once its watches end.
   */
  readonly close: () => Promise<void>;
  readonly events: {
    /**
     * Watches a room. The first event is always `room.snapshot`: the room and
     * its participants when the watch started. Every change after it follows,
     * in order.
     *
     * Nothing is requested until the loop starts. The loop ends, without an
     * error, when the hub closes or `signal` aborts; leaving it early
     * (`break`) stops watching. To keep watching across a hub restart, watch
     * again when the loop ends.
     *
     * @example
     * for await (const event of client.events.watch("ABC123")) {
     *   if (event.type === "participant.online") {
     *     console.log(event.participant.nickname);
     *   }
     * }
     */
    readonly watch: (
      roomCode: string,
      options?: WatchOptions
    ) => AsyncIterable<RoomEvent>;
  };
  /**
   * Attaching to a harness participant: a participant that contributes a
   * harness (OpenCode, Claude Code, Codex) instead of a model endpoint. Any
   * number of clients attach to the same participant.
   */
  readonly harness: {
    /**
     * Reads what the harness of a participant says: its ACP v1 messages, the
     * status of its harness sessions and the artifacts of its Workspace. The
     * first event says whether the hub is receiving the harness now
     * (`harness.connected` or `harness.disconnected`); the client stays
     * attached while the participant's tunnel is down, and `harness.detached`
     * is the last event, when the participant is out of the room.
     *
     * Nothing is replayed: the stream carries what happens from the attach
     * on. A client that reads too slowly loses its own oldest events and is
     * told how many (`harness.dropped`).
     *
     * Nothing is requested until the loop starts. The loop ends, without an
     * error, when the hub closes or `signal` aborts; leaving it early
     * (`break`) detaches.
     *
     * @example
     * for await (const event of client.harness.attach("ABC123", "frevo-bot")) {
     *   if (event.type === "harness.message") {
     *     console.log(event.sessionId, event.message);
     *   }
     * }
     */
    readonly attach: (
      roomCode: string,
      participantId: string,
      options?: WatchOptions
    ) => AsyncIterable<HarnessAttachEvent>;
    /** Closes a harness session. One that is not open is already closed. */
    readonly closeSession: (
      roomCode: string,
      participantId: string,
      sessionId: string
    ) => Promise<HarnessSessionRef>;
    /**
     * Opens a harness session under an id this client picks, and resolves
     * once the harness opened it. One that is already open stays as it is.
     */
    readonly openSession: (
      roomCode: string,
      participantId: string,
      sessionId: string,
      input?: OpenHarnessSessionInput
    ) => Promise<HarnessSessionRef>;
    /**
     * Sends one ACP message to the harness, for one of its open sessions. It
     * resolves when the message was written to the harness, not when the
     * harness answered: the answer comes through `attach`.
     */
    readonly send: (
      roomCode: string,
      participantId: string,
      sessionId: string,
      message: AcpMessage
    ) => Promise<HarnessSessionRef>;
  };
  readonly hub: {
    readonly health: () => Promise<HubHealth>;
  };
  readonly participants: {
    readonly list: (roomCode: string) => Promise<readonly ParticipantSummary[]>;
    /**
     * Registers a participant in a room, or updates one that is already in
     * it, and answers the bootstrap token of its tunnel. The participant stays
     * `offline` until a participant runtime opens that tunnel, and is removed
     * after 60 seconds without one.
     */
    readonly register: (
      roomCode: string,
      participantId: string,
      input: RegisterParticipantInput
    ) => Promise<ParticipantRegistered>;
    /**
     * Takes a participant out of a room at once and closes its tunnel for
     * good: its participant runtime ends, and does not come back.
     *
     * `runtimeId` names the runtime the participant belongs to, as
     * `participants.list` shows it. When the participant belongs to another
     * runtime by the time the hub hears this (one that joined with the same
     * id since), the call rejects with `PARTICIPANT_OF_ANOTHER_RUNTIME` and
     * the participant stays.
     */
    readonly remove: (
      roomCode: string,
      participantId: string,
      runtimeId: string
    ) => Promise<ParticipantLeft>;
  };
  readonly rooms: {
    readonly create: (input: CreateRoomInput) => Promise<RoomCreated>;
    readonly get: (roomCode: string) => Promise<RoomSummary>;
    readonly list: () => Promise<readonly RoomSummary[]>;
  };
  readonly [Symbol.asyncDispose]: () => Promise<void>;
}

/**
 * Creates the management client of the hub at `options.hubUrl`.
 *
 * @example
 * const client = createClient({ hubUrl: "http://192.168.1.10:3000" });
 * const { room } = await client.rooms.create({ name: "Frevo" });
 * const participants = await client.participants.list(room.code);
 */
export const createClient = (options: ClientOptions = {}): GambiClient => {
  const hubUrl = options.hubUrl ?? DEFAULT_HUB_URL;
  const boundary = makePromiseBoundary(
    ManagementPlane.layer(hubUrl),
    "The client"
  );
  const asClientError = translated(hubUrl);

  /**
   * One call of the derived client, as a `Promise`. To cover a new group of
   * the contract, add its methods to `GambiClient` and write each one as a
   * `call` (or a `watch`, for an endpoint that streams events).
   */
  const call = <A>(
    use: (
      management: ManagementPlane["Service"]
    ) => Effect.Effect<A, ManagementFailure>
  ): Promise<A> => boundary.run(asClientError(ManagementPlane.use(use)));

  return {
    hub: {
      health: () => call((management) => management.hub.health()),
    },
    rooms: {
      create: (input) =>
        call((management) =>
          management.rooms.create({ payload: withoutUndefined(input) })
        ),
      get: (roomCode) =>
        call((management) =>
          management.rooms.get({ params: { code: roomCode } })
        ),
      list: () => call((management) => management.rooms.list()),
    },
    participants: {
      list: (roomCode) =>
        call((management) =>
          management.participants.list({ params: { code: roomCode } })
        ),
      register: (roomCode, participantId, input) =>
        call((management) =>
          management.participants.register({
            params: { code: roomCode, id: participantId },
            payload: withoutUndefined({
              ...input,
              version: input.version ?? GAMBI_VERSION,
            }),
          })
        ),
      remove: (roomCode, participantId, runtimeId) =>
        call((management) =>
          management.participants.remove({
            params: { code: roomCode, id: participantId },
            query: { runtimeId },
          })
        ),
    },
    events: {
      watch: (roomCode, watchOptions) =>
        boundary.iterate(
          ManagementPlane.use((management) =>
            management.events.watch({ params: { code: roomCode } })
          ).pipe(
            asClientError,
            Effect.map(Stream.mapError(translatedMidStream(hubUrl))),
            Stream.unwrap
          ),
          watchOptions
        ),
    },
    harness: {
      attach: (roomCode, participantId, watchOptions) =>
        boundary.iterate(
          ManagementPlane.use((management) =>
            management.harness.events({
              params: { code: roomCode, id: participantId },
            })
          ).pipe(
            asClientError,
            Effect.map(Stream.mapError(translatedMidStream(hubUrl))),
            Stream.unwrap
          ),
          watchOptions
        ),
      closeSession: (roomCode, participantId, sessionId) =>
        call((management) =>
          management.harness.closeSession({
            params: { code: roomCode, id: participantId, sessionId },
          })
        ),
      openSession: (roomCode, participantId, sessionId, input = {}) =>
        call((management) =>
          management.harness.openSession({
            params: { code: roomCode, id: participantId, sessionId },
            payload: withoutUndefined(input),
          })
        ),
      send: (roomCode, participantId, sessionId, message) =>
        call((management) =>
          management.harness.send({
            params: { code: roomCode, id: participantId },
            payload: { sessionId, message: withoutUndefined(message) },
          })
        ),
    },
    close: boundary.close,
    [Symbol.asyncDispose]: boundary.close,
  };
};
