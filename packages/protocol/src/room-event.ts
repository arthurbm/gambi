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

/** The inference API a request came through. */
export const InferenceProtocol = Schema.Literals([
  "chatCompletions",
  "openResponses",
]);
export type InferenceProtocol = typeof InferenceProtocol.Type;

/** What the three events of one inference request have in common. */
const inferenceRequest = {
  /** The id of the HTTP request on the hub: the same in the three events and in the hub's log. */
  requestId: Schema.String,
  /** The participant the request was dispatched to. */
  participantId: ParticipantId,
  /** The participant's model, which is the one the provider was asked for. */
  model: Schema.String,
  protocol: InferenceProtocol,
};

/**
 * The hub dispatched an inference request to a participant. One of
 * `llm.complete` and `llm.error` follows, with the same `requestId`.
 */
export const LlmRequest = roomEvent("llm.request", {
  ...inferenceRequest,
  /** The model selector the app asked for. */
  modelSelector: Schema.String,
});
export type LlmRequest = typeof LlmRequest.Type;

/**
 * How long a request took, as the hub saw it, and the tokens the provider
 * reported. The token counts come from the `usage` of an answer that is not
 * a stream; a streamed answer has none.
 */
export const RequestMetrics = Schema.Struct({
  /** Milliseconds from the dispatch to the first piece of the answer's body. */
  ttftMs: Schema.Finite,
  /** Milliseconds from the dispatch to the end of the answer. */
  durationMs: Schema.Finite,
  inputTokens: Schema.optionalKey(Schema.Finite),
  outputTokens: Schema.optionalKey(Schema.Finite),
  totalTokens: Schema.optionalKey(Schema.Finite),
  tokensPerSecond: Schema.optionalKey(Schema.Finite),
});
export type RequestMetrics = typeof RequestMetrics.Type;

/**
 * The provider's answer to a request ended. It may be an error of the
 * provider itself: `status` is the HTTP status it answered with.
 */
export const LlmComplete = roomEvent("llm.complete", {
  ...inferenceRequest,
  status: Schema.Int,
  metrics: RequestMetrics,
});
export type LlmComplete = typeof LlmComplete.Type;

/**
 * A dispatched request ended without the provider's whole answer.
 *
 * - `stage`: `dispatch` when the app had received nothing yet, `stream` when
 *   a streamed answer was already on its way.
 * - `code`: the `code` of the inference error the app got
 *   (`INFERENCE_FAILURES`), or `request_cancelled` when the app itself gave
 *   the request up.
 */
export const LlmError = roomEvent("llm.error", {
  ...inferenceRequest,
  stage: Schema.Literals(["dispatch", "stream"]),
  code: Schema.String,
  /** The message of the error. */
  error: Schema.String,
});
export type LlmError = typeof LlmError.Type;

/** Every event a room's stream can carry, told apart by `type`. */
export const RoomEvent = Schema.Union([
  RoomSnapshot,
  ParticipantJoined,
  ParticipantUpdated,
  ParticipantOnline,
  ParticipantBusy,
  ParticipantOffline,
  ParticipantRemoved,
  LlmRequest,
  LlmComplete,
  LlmError,
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
