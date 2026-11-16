/**
 * The typed errors of the tunnel calls: what a participant runtime answers
 * when it cannot serve a call. They travel inside the tunnel; the hub turns
 * them into the error of the plane the request came from.
 *
 * The harness errors are also errors of the management plane, as they are: a
 * management client that sends a message to a harness reads the same error
 * the participant answered. So they declare a `code` and a `status` like the
 * classes of `../management/errors.ts`.
 */
import { Schema } from "effect";
import { requestIdField } from "../management/envelope.ts";

/**
 * The participant does not serve this call: an inference call sent to a
 * harness participant, or a harness call sent to a participant that shares a
 * model endpoint. A call lists it as its `error` and the runtime of the other
 * kind of participant answers the call with it.
 */
export class CallNotSupported extends Schema.TaggedError<CallNotSupported>()(
  "CallNotSupported",
  { call: Schema.String }
) {
  override get message(): string {
    return `This participant does not serve the '${this.call}' tunnel call.`;
  }
}

/**
 * A message or a close was sent to a harness session the participant has not
 * open: it never opened, or it closed already.
 */
export class HarnessSessionNotOpen extends Schema.TaggedError<HarnessSessionNotOpen>()(
  "HarnessSessionNotOpen",
  { sessionId: Schema.String, ...requestIdField }
) {
  static readonly code = "HARNESS_SESSION_NOT_OPEN";
  static readonly status = 409;

  get hint(): string {
    return "Open the session first, or use the id of a session that is open.";
  }

  override get message(): string {
    return `Harness session '${this.sessionId}' is not open.`;
  }
}

/**
 * A harness session was asked to run in a folder outside the participant's
 * Workspace. The tunnel gives nobody a way to reach the rest of the
 * participant's machine (ADR-0006).
 */
export class HarnessSessionOutsideWorkspace extends Schema.TaggedError<HarnessSessionOutsideWorkspace>()(
  "HarnessSessionOutsideWorkspace",
  { sessionId: Schema.String, ...requestIdField }
) {
  static readonly code = "HARNESS_SESSION_OUTSIDE_WORKSPACE";
  static readonly status = 403;

  get hint(): string {
    return "Leave `cwd` out to use the workspace itself, or give a folder inside it.";
  }

  override get message(): string {
    return "Harness sessions must stay inside the participant workspace.";
  }
}

/**
 * The harness itself failed an ACP call the participant runtime made
 * (`initialize`, `session/new`, `session/close`), or its process is gone.
 *
 * - `timedOut`: the harness did not answer in time.
 * - `rejected`: it answered with a JSON-RPC error; `detail` is its message.
 * - `invalidAnswer`: it answered something that is not what ACP v1 says.
 * - `versionNotNegotiated`: it did not agree to ACP v1.
 * - `exited`: its process exited; `exitCode` and `detail` (the end of its
 *   stderr) say what is known.
 */
export class HarnessFailed extends Schema.TaggedError<HarnessFailed>()(
  "HarnessFailed",
  {
    reason: Schema.Literals([
      "timedOut",
      "rejected",
      "invalidAnswer",
      "versionNotNegotiated",
      "exited",
    ]),
    /** The ACP method that failed, when one did. */
    method: Schema.optionalKey(Schema.String),
    detail: Schema.optionalKey(Schema.String),
    exitCode: Schema.optionalKey(Schema.Int),
    ...requestIdField,
  }
) {
  static readonly code = "HARNESS_FAILED";
  static readonly status = 502;

  override get message(): string {
    const detail = this.detail === undefined ? "" : ` ${this.detail}`;
    switch (this.reason) {
      case "timedOut":
        return `ACP ${this.method} timed out.`;
      case "rejected":
        return `ACP ${this.method} failed: ${this.detail ?? "unknown error"}`;
      case "invalidAnswer":
        return `ACP ${this.method} returned an answer that is not ACP v1.`;
      case "versionNotNegotiated":
        return "Harness did not negotiate ACP v1.";
      default:
        return this.exitCode === undefined
          ? `Harness process exited.${detail}`
          : `Harness process exited with code ${this.exitCode}.${detail}`;
    }
  }
}
