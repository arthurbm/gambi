/**
 * The typed errors of the inference plane and their form on the wire.
 *
 * The inference plane speaks the OpenAI format, so none of these travels in
 * the management envelope. Each one has a `code` (its name on the wire) and
 * an HTTP `status`, listed once in `INFERENCE_FAILURES`, and is written as
 * an OpenAI error body: `{ error: { message, type, param, code } }`.
 *
 * A client tells the errors apart by `error.code`.
 */
import { Schema } from "effect";
import type { RoomNotFound } from "../management/errors.ts";
import type {
  CallNotSupported,
  ProviderResponseInterrupted,
  ProviderUnreachable,
} from "../tunnel/errors.ts";

/**
 * The request body is not what the inference plane reads: it is not a JSON
 * object, `model` is missing, or `stream` is not a boolean. The hub checks
 * nothing else; every other field goes to the provider as it came.
 */
export class InvalidInferenceRequest extends Schema.TaggedError<InvalidInferenceRequest>()(
  "InvalidInferenceRequest",
  {
    /** The field of the body that is wrong; absent when the body itself is. */
    param: Schema.optionalKey(Schema.String),
    issue: Schema.String,
  }
) {
  override get message(): string {
    return this.param === undefined
      ? `The request body is invalid: ${this.issue}`
      : `The request is invalid: ${this.param}: ${this.issue}`;
  }
}

/** No participant of the room can take the request the model selector asks for. */
export class NoParticipantAvailable extends Schema.TaggedError<NoParticipantAvailable>()(
  "NoParticipantAvailable",
  { roomCode: Schema.String, model: Schema.String }
) {
  override get message(): string {
    return `No participant of room '${this.roomCode}' is available for model '${this.model}'.`;
  }
}

/** The model selector names a participant that is handling another request. */
export class ParticipantBusy extends Schema.TaggedError<ParticipantBusy>()(
  "ParticipantBusy",
  { roomCode: Schema.String, participantId: Schema.String }
) {
  override get message(): string {
    return `Participant '${this.participantId}' is already handling another request.`;
  }
}

/** The model selector names a participant whose tunnel is not open. */
export class ParticipantOffline extends Schema.TaggedError<ParticipantOffline>()(
  "ParticipantOffline",
  { roomCode: Schema.String, participantId: Schema.String }
) {
  override get message(): string {
    return `Participant '${this.participantId}' is offline: its tunnel is not open.`;
  }
}

/** The participant's tunnel dropped while it was answering the request. */
export class ParticipantDisconnected extends Schema.TaggedError<ParticipantDisconnected>()(
  "ParticipantDisconnected",
  { roomCode: Schema.String, participantId: Schema.String }
) {
  override get message(): string {
    return `Participant '${this.participantId}' disconnected before the response ended.`;
  }
}

/**
 * The participant sent nothing for the hub's inactivity timeout. The hub
 * interrupted the request on the participant.
 */
export class InferenceTimedOut extends Schema.TaggedError<InferenceTimedOut>()(
  "InferenceTimedOut",
  {
    roomCode: Schema.String,
    participantId: Schema.String,
    /** How long the hub waited for the next piece of the response. */
    idleSeconds: Schema.Finite,
  }
) {
  override get message(): string {
    return `Participant '${this.participantId}' sent nothing for ${this.idleSeconds} seconds; the request was cancelled.`;
  }
}

/**
 * A response that is not a stream came bigger than the hub holds in memory.
 * The hub holds such a response whole, to answer with a status it can stand
 * behind.
 */
export class ProviderResponseTooLarge extends Schema.TaggedError<ProviderResponseTooLarge>()(
  "ProviderResponseTooLarge",
  {
    roomCode: Schema.String,
    participantId: Schema.String,
    limitCharacters: Schema.Int,
  }
) {
  override get message(): string {
    return `The provider of participant '${this.participantId}' answered with more than ${this.limitCharacters} characters outside a stream.`;
  }
}

/** Everything an inference request can fail with, before or during the response. */
export type InferenceError =
  | InvalidInferenceRequest
  | RoomNotFound
  | NoParticipantAvailable
  | ParticipantBusy
  | ParticipantOffline
  | ParticipantDisconnected
  | InferenceTimedOut
  | ProviderResponseTooLarge
  | CallNotSupported
  | ProviderUnreachable
  | ProviderResponseInterrupted;

/**
 * The name and the HTTP status of each error on the wire. A new
 * `InferenceError` does not compile until it has a row here.
 */
export const INFERENCE_FAILURES: {
  readonly [Tag in InferenceError["_tag"]]: {
    readonly code: string;
    readonly status: number;
  };
} = {
  InvalidInferenceRequest: { code: "invalid_request", status: 400 },
  RoomNotFound: { code: "room_not_found", status: 404 },
  // The code an OpenAI client already knows for "nothing serves this model".
  NoParticipantAvailable: { code: "model_not_found", status: 404 },
  ParticipantBusy: { code: "participant_busy", status: 409 },
  ParticipantOffline: { code: "participant_offline", status: 503 },
  ParticipantDisconnected: { code: "participant_disconnected", status: 502 },
  InferenceTimedOut: { code: "inference_timeout", status: 504 },
  ProviderResponseTooLarge: {
    code: "provider_response_too_large",
    status: 502,
  },
  CallNotSupported: { code: "inference_not_supported", status: 400 },
  ProviderUnreachable: { code: "provider_unreachable", status: 502 },
  ProviderResponseInterrupted: {
    code: "provider_response_interrupted",
    status: 502,
  },
};

/** An error body in the OpenAI format. */
export const OpenAiErrorBody = Schema.Struct({
  error: Schema.Struct({
    message: Schema.String,
    /** `invalid_request_error` for a 4xx, `api_error` for a 5xx. */
    type: Schema.String,
    param: Schema.NullOr(Schema.String),
    /** The name of the error: a `code` of `INFERENCE_FAILURES`, or `internal_error`. */
    code: Schema.NullOr(Schema.String),
  }),
});
export type OpenAiErrorBody = typeof OpenAiErrorBody.Type;

const errorType = (status: number) =>
  status < 500 ? "invalid_request_error" : "api_error";

/** The status and the OpenAI error body the hub answers an `InferenceError` with. */
export const toOpenAiError = (
  error: InferenceError
): { readonly status: number; readonly body: OpenAiErrorBody } => {
  const { code, status } = INFERENCE_FAILURES[error._tag];
  return {
    status,
    body: {
      error: {
        message: error.message,
        type: errorType(status),
        param:
          error._tag === "InvalidInferenceRequest"
            ? (error.param ?? null)
            : null,
        code,
      },
    },
  };
};

/** The body of a bug in the hub: status 500, no detail. The cause stays in the hub's log. */
export const OPENAI_INTERNAL_ERROR: OpenAiErrorBody = {
  error: {
    message: "The hub failed to handle the request.",
    type: errorType(500),
    param: null,
    code: "internal_error",
  },
};

/**
 * An error that happened after the response started, as the last event of a
 * `text/event-stream` body. The status is already sent by then, so the name
 * travels in the stream:
 *
 * ```text
 * event: error
 * data: {"type":"error","code":"participant_disconnected","message":"...","param":null,"error":{"message":"...","type":"api_error","param":null,"code":"participant_disconnected"}}
 * ```
 *
 * The data carries the two shapes OpenAI uses, so a client of either API
 * reads it: the top-level fields are the `error` event of the Responses API,
 * and `error` is the error object of Chat Completions (the OpenAI SDKs throw
 * on an event whose data has an `error`). No `[DONE]` follows it.
 */
export const toOpenAiStreamError = (error: InferenceError): string => {
  const { body } = toOpenAiError(error);
  const data = {
    type: "error",
    code: body.error.code,
    message: body.error.message,
    param: body.error.param,
    error: body.error,
  };
  return `event: error\ndata: ${JSON.stringify(data)}\n\n`;
};
