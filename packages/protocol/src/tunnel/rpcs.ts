/**
 * The tunnel calls (ADR-0007): what the hub can ask of a participant runtime
 * over its tunnel. The roles are inverted on purpose. The participant dials
 * the WebSocket and serves these calls; the hub accepts the socket and makes
 * them. The hub never originates a connection.
 *
 * Every call here is hub to participant. What is born on the participant
 * (harness messages, artifacts) travels as the chunks of a stream call the
 * hub opens, never as a call in the other direction.
 *
 * To add a call: define it with `Rpc.make`, add it to `TunnelRpcs`, and
 * implement its handler where the participant runtime is hosted. The compiler
 * points at every runtime that is missing the handler.
 */
import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/rpc";
import { AcpMessage, HarnessEvent, HarnessSessionId } from "../harness.ts";
import {
  CallNotSupported,
  HarnessFailed,
  HarnessSessionNotOpen,
  HarnessSessionOutsideWorkspace,
  ProviderResponseInterrupted,
  ProviderUnreachable,
} from "./errors.ts";

/**
 * The hub's first call on a new tunnel. It tells the participant runtime
 * that the hub accepted the tunnel and that the participant is `online`
 * from now on. The runtime answers it itself.
 */
export const Welcome = Rpc.make("Welcome", {
  payload: {
    roomCode: Schema.String,
    participantId: Schema.String,
    /** The Gambi version of the hub. */
    hubVersion: Schema.String,
    /**
     * How often the hub pings this tunnel, in milliseconds. A runtime that
     * hears nothing from the hub for several of these takes it for frozen.
     */
    pingIntervalMillis: Schema.Number,
  },
});

/**
 * Diagnostic: the participant runtime answers with the same text. A cheap
 * round trip through the whole tunnel.
 */
export const Echo = Rpc.make("Echo", {
  payload: { text: Schema.String },
  success: Schema.String,
});

/**
 * Diagnostic: the participant runtime streams the integers from `0` up to
 * `count`, exclusive. Exercises streaming and backpressure through the tunnel.
 */
export const Ticks = Rpc.make("Ticks", {
  payload: { count: Schema.Int },
  success: Schema.Int,
  stream: true,
});

/**
 * The long-lived stream of a harness participant: everything that is born on
 * the participant (ACP messages of the harness, the status of its sessions,
 * the artifacts of its Workspace) goes up as a chunk of this one call. The
 * hub opens it on every tunnel, right after `Welcome`, and reads it for as
 * long as the tunnel lives; it ends with the tunnel.
 *
 * A participant that shares a model endpoint answers it with
 * `CallNotSupported`.
 */
export const HarnessEvents = Rpc.make("HarnessEvents", {
  success: HarnessEvent,
  error: CallNotSupported,
  stream: true,
});

/**
 * Hands one ACP message to the harness, for one of its sessions. It answers
 * when the message is written to the harness, not when the harness answers:
 * whatever the harness says comes up through `HarnessEvents`.
 */
export const HarnessSend = Rpc.make("HarnessSend", {
  payload: { sessionId: HarnessSessionId, message: AcpMessage },
  error: Schema.Union([CallNotSupported, HarnessSessionNotOpen, HarnessFailed]),
});

/**
 * Opens a harness session under the id the caller picked. It answers when the
 * harness has opened it; a session that is already open stays as it is.
 * `cwd` must be inside the participant's Workspace, which is also the default.
 */
export const HarnessOpenSession = Rpc.make("HarnessOpenSession", {
  payload: {
    sessionId: HarnessSessionId,
    cwd: Schema.optionalKey(Schema.NonEmptyString),
  },
  error: Schema.Union([
    CallNotSupported,
    HarnessSessionOutsideWorkspace,
    HarnessFailed,
  ]),
});

/** Closes a harness session. A session that is not open is already closed. */
export const HarnessCloseSession = Rpc.make("HarnessCloseSession", {
  payload: { sessionId: HarnessSessionId },
  error: Schema.Union([CallNotSupported, HarnessFailed]),
});

/**
 * The operations that create something on the participant's provider. Each
 * one sends a body to a fixed route:
 *
 * - `chatCompletions.create`: `POST /v1/chat/completions`
 * - `responses.create`: `POST /v1/responses`
 */
export const InferenceCreation = Schema.Literals([
  "chatCompletions.create",
  "responses.create",
]);
export type InferenceCreation = typeof InferenceCreation.Type;

/**
 * The operations on a Response the participant's provider stored when it
 * created it. Each one names the Response and sends no body:
 *
 * - `responses.retrieve`: `GET /v1/responses/:id`
 * - `responses.delete`: `DELETE /v1/responses/:id`
 * - `responses.cancel`: `POST /v1/responses/:id/cancel`
 * - `responses.inputItems.list`: `GET /v1/responses/:id/input_items`
 */
export const StoredResponseOperation = Schema.Literals([
  "responses.retrieve",
  "responses.delete",
  "responses.cancel",
  "responses.inputItems.list",
]);
export type StoredResponseOperation = typeof StoredResponseOperation.Type;

/**
 * What the hub asks of the participant's provider, named after the OpenAI
 * operation. A new operation is a new literal in one of the two lists and a
 * new row in the participant runtime's table of provider routes.
 */
export type InferenceOperation = InferenceCreation | StoredResponseOperation;

/**
 * One request for the participant's provider: the operation and what it
 * needs, a body or the id of a stored Response, never both.
 */
export const InferenceRequest = Schema.Union([
  Schema.Struct({
    operation: InferenceCreation,
    /** The JSON text of the request body, already final: the runtime does not read it. */
    body: Schema.String,
  }),
  Schema.Struct({
    operation: StoredResponseOperation,
    /** The id the provider gave the Response. */
    responseId: Schema.NonEmptyString,
    /** The query string the app sent, without the `?`, passed on as it came. */
    query: Schema.optionalKey(Schema.String),
  }),
]);
export type InferenceRequest = typeof InferenceRequest.Type;

/**
 * One piece of the provider's response, in the order it arrives: first one
 * `Head`, then the body as text, split wherever the provider flushed. The
 * body of an inference API is JSON or `text/event-stream`, both UTF-8, so it
 * travels as text and the hub puts the same bytes back.
 */
export const InferenceChunk = Schema.Union([
  Schema.TaggedStruct("Head", {
    /** The HTTP status the provider answered with, passed on as it is. */
    status: Schema.Int,
    /** The provider's `Content-Type`, when it sent one. */
    contentType: Schema.optionalKey(Schema.String),
  }),
  Schema.TaggedStruct("Body", { text: Schema.String }),
]);
export type InferenceChunk = typeof InferenceChunk.Type;

/**
 * An inference request for the participant's provider. The participant
 * runtime sends it to its local provider as it is, with the
 * `ParticipantAuthHeaders` that only it knows, and streams the response back.
 *
 * Interrupting the call stops the request to the provider. The stream is
 * pulled chunk by chunk: a provider faster than the hub's consumer waits.
 */
export const Infer = Rpc.make("Infer", {
  payload: InferenceRequest,
  success: InferenceChunk,
  error: Schema.Union([
    CallNotSupported,
    ProviderUnreachable,
    ProviderResponseInterrupted,
  ]),
  stream: true,
});

/** Every call of the tunnel. The hub's client and the participant's server derive from it. */
export class TunnelRpcs extends RpcGroup.make(
  Welcome,
  Echo,
  Ticks,
  Infer,
  HarnessEvents,
  HarnessSend,
  HarnessOpenSession,
  HarnessCloseSession
) {}

/**
 * The WebSocket close code of a tunnel the hub closed because the same
 * participant opened another one. A participant runtime that sees its tunnel
 * close with it was replaced by another runtime with its `participantId`, and
 * must not dial again: the two would take the tunnel from each other forever.
 *
 * It is in the range the WebSocket protocol leaves to applications
 * (4000 to 4999).
 */
export const TUNNEL_REPLACED_CLOSE_CODE = 4001;

/**
 * The WebSocket close code of a tunnel the hub closed because its participant
 * was taken out of the room (`participants.remove`). A participant runtime
 * that sees its tunnel close with it left the room for good, and must not
 * dial again: registering would bring back the participant someone removed.
 */
export const TUNNEL_REMOVED_CLOSE_CODE = 4002;

/** The path of the tunnel's WebSocket upgrade on the hub. */
export const tunnelPath = (roomCode: string, participantId: string): string =>
  `/v1/rooms/${encodeURIComponent(roomCode)}/participants/${encodeURIComponent(participantId)}/tunnel`;

const HTTP_SCHEME = /^http/;
const TRAILING_SLASHES = /\/+$/;

/**
 * The URL a participant runtime dials to open its tunnel: the hub URL it
 * registered at, with the WebSocket scheme, and the bootstrap token.
 *
 * @example
 * tunnelUrl("http://192.168.0.10:3000", "AB12CD", "arthur-1", token);
 * // "ws://192.168.0.10:3000/v1/rooms/AB12CD/participants/arthur-1/tunnel?token=..."
 */
export const tunnelUrl = (
  hubUrl: string,
  roomCode: string,
  participantId: string,
  token: string
): string =>
  `${hubUrl.replace(HTTP_SCHEME, "ws").replace(TRAILING_SLASHES, "")}${tunnelPath(roomCode, participantId)}?token=${encodeURIComponent(token)}`;
