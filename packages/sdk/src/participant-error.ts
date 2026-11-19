/**
 * The one error the participant entry rejects with. `code` tells the cases
 * apart; the rest explains the case. `./participant-failure.ts` makes one
 * out of each typed failure.
 */

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
