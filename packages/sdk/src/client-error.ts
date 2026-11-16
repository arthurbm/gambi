/**
 * The one error the management client rejects with. `code` tells the cases
 * apart; the rest explains the case.
 */

/**
 * Why a call to a hub failed.
 *
 * Answered by the hub, in its error envelope:
 *
 * - `ROOM_NOT_FOUND`, `PARTICIPANT_NOT_FOUND`: what the call named is not there.
 * - `INVALID_PASSWORD`: the room has a password and the call brought none, or the wrong one.
 * - `VERSION_MISMATCH`: the participant and the hub are on different minor versions.
 * - `INVALID_REQUEST`: the call does not match the management contract.
 * - `INTERNAL_ERROR`: a bug in the hub.
 *
 * Found by the client, with no envelope:
 *
 * - `HUB_UNREACHABLE`: nothing answered at the hub URL.
 * - `NOT_A_HUB`: something answered, but not what the management contract
 *   describes: another server, a proxy, or a hub of another version.
 */
export type ClientErrorCode =
  | "ROOM_NOT_FOUND"
  | "PARTICIPANT_NOT_FOUND"
  | "INVALID_PASSWORD"
  | "VERSION_MISMATCH"
  | "INVALID_REQUEST"
  | "INTERNAL_ERROR"
  | "HUB_UNREACHABLE"
  | "NOT_A_HUB";

export interface ClientErrorInit {
  readonly cause?: unknown;
  readonly code: ClientErrorCode;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
  readonly hint?: string | undefined;
  readonly message: string;
  readonly requestId?: string | undefined;
  readonly status?: number | undefined;
}

export class ClientError extends Error {
  override readonly name = "ClientError";
  readonly code: ClientErrorCode;
  /**
   * The structured fields of the error: `roomCode` for `ROOM_NOT_FOUND`,
   * `hubVersion` and `participantVersion` for `VERSION_MISMATCH`, `issues`
   * for `INVALID_REQUEST`, `hubUrl` for the two the client finds.
   */
  readonly details: Readonly<Record<string, unknown>>;
  /** What the caller can do about it. */
  readonly hint?: string | undefined;
  /** The id of the request in the hub's log. Set when the hub answered. */
  readonly requestId?: string | undefined;
  /** The HTTP status of the answer. Absent when nothing answered. */
  readonly status?: number | undefined;

  constructor(init: ClientErrorInit) {
    super(init.message, { cause: init.cause });
    this.code = init.code;
    this.details = init.details ?? {};
    this.hint = init.hint;
    this.requestId = init.requestId;
    this.status = init.status;
  }
}
