/**
 * From the typed failures of hosting a participant to the one error a
 * consumer catches (`./participant-error.ts`).
 *
 * Internal: the declarations of an entry never reach this file.
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
import {
  ParticipantError,
  type ParticipantErrorCode,
} from "./participant-error.ts";

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
