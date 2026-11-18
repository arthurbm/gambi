/**
 * The one error the participant entry rejects with. `code` tells the cases
 * apart; the rest explains the case.
 */
import type { HarnessNotReady } from "@gambi/core/harness/detection";
import type { HarnessStartFailed } from "@gambi/core/harness/harness";
import type {
  WorkspaceFailed,
  WorkspaceTooLarge,
} from "@gambi/core/harness/workspace";
import type {
  RegistrationError,
  TunnelOpenFailed,
} from "@gambi/core/participant/runtime";
import type { HarnessFailed } from "@gambi/protocol";

/**
 * Why a participant did not join, or why something of it failed.
 *
 * The hub refused the registration:
 *
 * - `ROOM_NOT_FOUND`: there is no room with that code on the hub.
 * - `INVALID_PASSWORD`: the room has a password and the session brought none, or the wrong one.
 * - `VERSION_MISMATCH`: this SDK and the hub are on different minor versions.
 * - `INVALID_REQUEST`: the hub refused what the participant said about itself.
 * - `INTERNAL_ERROR`: a bug in the hub.
 *
 * The hub was not reached:
 *
 * - `HUB_UNREACHABLE`: nothing answered the registration at the hub URL.
 * - `TUNNEL_OPEN_FAILED`: the hub registered the participant, but its tunnel did not open.
 *
 * The harness of a harness participant:
 *
 * - `HARNESS_NOT_READY`: it is not installed or not logged in on this machine;
 *   the message says what to install or which login to run.
 * - `HARNESS_START_FAILED`: its command could not be run at all.
 * - `HARNESS_FAILED`: it started and did not speak ACP v1, did not answer, or exited.
 *
 * The Workspace of a harness participant:
 *
 * - `WORKSPACE_FAILED`: its folder could not be made ready, read or observed.
 * - `WORKSPACE_TOO_LARGE`: its files are more than one artifact can carry.
 */
export type ParticipantErrorCode =
  | "ROOM_NOT_FOUND"
  | "INVALID_PASSWORD"
  | "VERSION_MISMATCH"
  | "INVALID_REQUEST"
  | "INTERNAL_ERROR"
  | "HUB_UNREACHABLE"
  | "TUNNEL_OPEN_FAILED"
  | "HARNESS_NOT_READY"
  | "HARNESS_START_FAILED"
  | "HARNESS_FAILED"
  | "WORKSPACE_FAILED"
  | "WORKSPACE_TOO_LARGE";

export interface ParticipantErrorInit {
  readonly cause?: unknown;
  readonly code: ParticipantErrorCode;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
  readonly message: string;
}

export class ParticipantError extends Error {
  override readonly name = "ParticipantError";
  readonly code: ParticipantErrorCode;
  /**
   * The structured fields of the error: `roomCode` for `ROOM_NOT_FOUND`,
   * `hubVersion` and `participantVersion` for `VERSION_MISMATCH`, `hubUrl`
   * for `HUB_UNREACHABLE`, `harness` and `problem` for `HARNESS_NOT_READY`,
   * `path` for the two of the Workspace.
   */
  readonly details: Readonly<Record<string, unknown>>;

  constructor(init: ParticipantErrorInit) {
    super(init.message, { cause: init.cause });
    this.code = init.code;
    this.details = init.details ?? {};
  }
}

/** Everything hosting a participant can fail with, before it is translated. */
export type ParticipantFailure =
  | RegistrationError
  | TunnelOpenFailed
  | HarnessNotReady
  | HarnessStartFailed
  | HarnessFailed
  | WorkspaceFailed
  | WorkspaceTooLarge;

/** The code of each failure. A failure added to `ParticipantFailure` gets a row. */
const CODES: {
  readonly [Tag in ParticipantFailure["_tag"]]: ParticipantErrorCode;
} = {
  HarnessFailed: "HARNESS_FAILED",
  HarnessNotReady: "HARNESS_NOT_READY",
  HarnessStartFailed: "HARNESS_START_FAILED",
  HubUnreachable: "HUB_UNREACHABLE",
  InternalError: "INTERNAL_ERROR",
  InvalidPassword: "INVALID_PASSWORD",
  InvalidRequest: "INVALID_REQUEST",
  RoomNotFound: "ROOM_NOT_FOUND",
  TunnelOpenFailed: "TUNNEL_OPEN_FAILED",
  VersionMismatch: "VERSION_MISMATCH",
  WorkspaceFailed: "WORKSPACE_FAILED",
  WorkspaceTooLarge: "WORKSPACE_TOO_LARGE",
};

/** The fields that are not part of `details`: what the error class already names. */
const NOT_A_DETAIL: ReadonlySet<string> = new Set([
  "_tag",
  "cause",
  "requestId",
]);

/**
 * The typed failure as the error a consumer catches. A failure that already
 * is one (a Workspace of the consumer's own rejected with it) stays as it is.
 */
export const toParticipantError = (
  failure: ParticipantFailure | ParticipantError
): ParticipantError =>
  failure instanceof ParticipantError
    ? failure
    : new ParticipantError({
        cause: "cause" in failure ? failure.cause : undefined,
        code: CODES[failure._tag],
        details: Object.fromEntries(
          Object.entries({ ...failure }).filter(
            ([key]) => !NOT_A_DETAIL.has(key)
          )
        ),
        message: failure.message,
      });
