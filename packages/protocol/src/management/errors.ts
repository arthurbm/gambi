/**
 * The typed errors of the management plane. Each class declares the `code`
 * that travels in the error envelope and its HTTP `status`; `failure` (in
 * `envelope.ts`) turns the class into the response schema of an endpoint.
 */
import { Schema } from "effect";
import { requestIdField } from "./envelope.ts";

export class RoomNotFound extends Schema.TaggedError<RoomNotFound>()(
  "RoomNotFound",
  { roomCode: Schema.String, ...requestIdField }
) {
  static readonly code = "ROOM_NOT_FOUND";
  static readonly status = 404;

  override get message(): string {
    return `Room '${this.roomCode}' was not found.`;
  }

  get hint(): string {
    return "List the rooms of this hub to see the codes that exist.";
  }
}

/** The room has a password and the request did not bring the right one. */
export class InvalidPassword extends Schema.TaggedError<InvalidPassword>()(
  "InvalidPassword",
  { roomCode: Schema.String, ...requestIdField }
) {
  static readonly code = "INVALID_PASSWORD";
  static readonly status = 401;

  override get message(): string {
    return `Room '${this.roomCode}' is password-protected and the password is missing or wrong.`;
  }

  get hint(): string {
    return "Provide the room password and retry.";
  }
}

/**
 * The participant runtime and the hub are on different minor versions. The
 * tunnel's wire format has no version of its own, so the hub refuses the
 * registration instead of letting the tunnel fail in an unreadable way.
 */
export class VersionMismatch extends Schema.TaggedError<VersionMismatch>()(
  "VersionMismatch",
  {
    /** The version of the hub: the one the participant must match in major and minor. */
    hubVersion: Schema.String,
    participantVersion: Schema.String,
    ...requestIdField,
  }
) {
  static readonly code = "VERSION_MISMATCH";
  static readonly status = 409;

  override get message(): string {
    const [major, minor] = this.hubVersion.split(".");
    return `This hub runs Gambi ${this.hubVersion} and expects participants on ${major}.${minor}.x; this participant runs ${this.participantVersion}.`;
  }

  get hint(): string {
    const [major, minor] = this.hubVersion.split(".");
    return `Install Gambi ${major}.${minor} on the participant's machine, or update the hub, so both are on the same minor version.`;
  }
}

/**
 * The tunnel's WebSocket upgrade came without a bootstrap token the hub
 * issued for that participant, or with one that expired or was already used.
 */
export class TunnelTokenInvalid extends Schema.TaggedError<TunnelTokenInvalid>()(
  "TunnelTokenInvalid",
  {
    roomCode: Schema.String,
    participantId: Schema.String,
    ...requestIdField,
  }
) {
  static readonly code = "TUNNEL_TOKEN_INVALID";
  static readonly status = 401;

  override get message(): string {
    return `The bootstrap token for participant '${this.participantId}' in room '${this.roomCode}' is missing, expired or already used.`;
  }

  get hint(): string {
    return "Register the participant again to get a new token; it is valid for 60 seconds and for one tunnel.";
  }
}

/** One problem found in a request: where it is and what is wrong. */
export const RequestIssue = Schema.Struct({
  path: Schema.Array(Schema.Union([Schema.String, Schema.Number])),
  message: Schema.String,
});
export type RequestIssue = typeof RequestIssue.Type;

/** The request did not match the contract (params, query, headers or body). */
export class InvalidRequest extends Schema.TaggedError<InvalidRequest>()(
  "InvalidRequest",
  { issues: Schema.Array(RequestIssue), ...requestIdField }
) {
  static readonly code = "INVALID_REQUEST";
  static readonly status = 400;

  override get message(): string {
    const [first] = this.issues;
    if (first === undefined) {
      return "The request is invalid.";
    }
    const where = first.path.join(".");
    return `The request is invalid: ${where === "" ? "" : `${where}: `}${first.message}`;
  }

  get hint(): string {
    return "Check the request against the management contract and retry.";
  }
}

/** The hub hit a bug while answering. The cause stays in the hub's log. */
export class InternalError extends Schema.TaggedError<InternalError>()(
  "InternalError",
  { ...requestIdField }
) {
  static readonly code = "INTERNAL_ERROR";
  static readonly status = 500;

  override get message(): string {
    return "The hub failed to handle the request.";
  }

  get hint(): string {
    return "Look for this request id in the hub's log.";
  }
}
