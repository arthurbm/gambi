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
