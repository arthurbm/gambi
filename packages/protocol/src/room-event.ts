/**
 * The events of a room: what `GET /v1/rooms/:code/events` streams.
 *
 * Every event is a struct with a `type`, the `roomCode` and a `timestamp`.
 * The hub stamps the last two when it publishes, so a publisher writes only
 * the rest (`RoomEventBody`).
 *
 * To add an event: define its struct here with `roomEvent`, add it to
 * `RoomEvent`, and publish it on the hub with `RoomEvents.publish`. The
 * stream, the derived client and the OpenAPI document pick it up from the
 * union.
 */
import { Schema } from "effect";
import { ParticipantId, ParticipantSummary } from "./participant.ts";
import { ParticipantStatus } from "./participant-status.ts";
import { RoomCode, RoomSummary } from "./room.ts";

/** The struct of one room event: its `type`, what every event carries, and its own fields. */
export const roomEvent = <
  const Type extends string,
  const Fields extends Schema.Struct.Fields,
>(
  type: Type,
  fields: Fields
) =>
  Schema.Struct({
    type: Schema.Literal(type),
    roomCode: RoomCode,
    /** Milliseconds since the epoch, on the hub's clock. */
    timestamp: Schema.Finite,
    ...fields,
  });

/**
 * The first event of every stream: the room and its participants at the
 * moment the stream started. Every later event happened after it, so a
 * client that applies them in order never misses a change.
 */
export const RoomSnapshot = roomEvent("room.snapshot", {
  room: RoomSummary,
  participants: Schema.Array(ParticipantSummary),
});
export type RoomSnapshot = typeof RoomSnapshot.Type;

/** A participant registered in the room. It starts `offline`. */
export const ParticipantJoined = roomEvent("participant.joined", {
  participant: ParticipantSummary,
});
export type ParticipantJoined = typeof ParticipantJoined.Type;

/**
 * A participant that was already in the room registered again. Its profile
 * may have changed; its status did not.
 */
export const ParticipantUpdated = roomEvent("participant.updated", {
  participant: ParticipantSummary,
});
export type ParticipantUpdated = typeof ParticipantUpdated.Type;

/** What a change of status carries: the participant after it, and the status it had. */
const statusChange = {
  participant: ParticipantSummary,
  previousStatus: ParticipantStatus,
};

/**
 * The participant can receive routes: its tunnel opened (it was `offline`),
 * or the request it was answering ended (it was `busy`).
 */
export const ParticipantOnline = roomEvent("participant.online", statusChange);
export type ParticipantOnline = typeof ParticipantOnline.Type;

/** The hub dispatched a request into the participant's tunnel. */
export const ParticipantBusy = roomEvent("participant.busy", statusChange);
export type ParticipantBusy = typeof ParticipantBusy.Type;

/**
 * The participant's tunnel dropped. It stays in the room until it reconnects
 * or the reconnection deadline passes.
 */
export const ParticipantOffline = roomEvent(
  "participant.offline",
  statusChange
);
export type ParticipantOffline = typeof ParticipantOffline.Type;

/**
 * Why a participant is no longer in the room: it `left`, or it stayed
 * offline past the reconnection deadline. The names are the ones of the
 * status table (`StatusEvent`).
 */
export const RemovalReason = Schema.Literals([
  "left",
  "reconnectDeadlinePassed",
]);
export type RemovalReason = typeof RemovalReason.Type;

/** The participant is no longer in the room. */
export const ParticipantRemoved = roomEvent("participant.removed", {
  participantId: ParticipantId,
  reason: RemovalReason,
});
export type ParticipantRemoved = typeof ParticipantRemoved.Type;

/** Every event a room's stream can carry, told apart by `type`. */
export const RoomEvent = Schema.Union([
  RoomSnapshot,
  ParticipantJoined,
  ParticipantUpdated,
  ParticipantOnline,
  ParticipantBusy,
  ParticipantOffline,
  ParticipantRemoved,
]);
export type RoomEvent = typeof RoomEvent.Type;

/**
 * An event as its publisher writes it: without the `roomCode` and the
 * `timestamp`, which the hub stamps. The snapshot is not published; each
 * stream gets its own.
 */
export type RoomEventBody =
  Exclude<RoomEvent, RoomSnapshot> extends infer Event
    ? Event extends RoomEvent
      ? Omit<Event, "roomCode" | "timestamp">
      : never
    : never;
