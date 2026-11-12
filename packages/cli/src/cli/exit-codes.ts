/**
 * The one table from typed error to exit code (ADR-0002). A supervising
 * agent reads the code to decide what to do: `2` do not retry, fix the
 * call; `3` retry later; `4` the hub said no.
 *
 * A command that can fail with a new error does not compile until the error
 * has a row in `failureKinds`.
 */
import { Predicate } from "effect";
import type { FailureReport } from "./output.ts";
import type { CommandFailure } from "./root.ts";

export const ExitCode = {
  success: 0,
  /** A bug, here or in the hub. */
  internal: 1,
  /** The command line, or what it asks for, is wrong. Retrying will not help. */
  usage: 2,
  /** Something this command depends on is not there: the hub, the network. */
  connectivity: 3,
  /** The hub understood the request and refused it. */
  rejected: 4,
  /** A signal stopped a command that was not waiting for one. */
  interrupted: 130,
} as const;

export type FailureKind = Exclude<
  keyof typeof ExitCode,
  "success" | "interrupted"
>;

type FailureTag = CommandFailure["_tag"];

export const failureKinds = {
  // Parse errors of `effect/cli`.
  DuplicateOption: "usage",
  InvalidValue: "usage",
  MissingArgument: "usage",
  MissingOption: "usage",
  ShowHelp: "usage",
  UnexpectedArgument: "usage",
  UnknownSubcommand: "usage",
  UnrecognizedOption: "usage",
  UserError: "usage",
  ValidationError: "usage",

  // Starting a hub (`@gambi/core`).
  HubListenFailed: "internal",
  MdnsAnnounceFailed: "connectivity",
  PortInUse: "usage",

  // Reaching the hub (`hub-client.ts`).
  HubUnreachable: "connectivity",
  NotAHub: "connectivity",

  // Updating this installation (`commands/self.ts`).
  BinaryReplaceFailed: "internal",
  PackageManagerFailed: "internal",
  PackageManagerUnavailable: "internal",
  UnknownInstallSource: "connectivity",
  UpdateDownloadFailed: "connectivity",
  UpdateNotScheduled: "internal",

  // The management contract (`@gambi/protocol`).
  InternalError: "internal",
  InvalidRequest: "usage",
  RoomNotFound: "rejected",
} as const satisfies Record<FailureTag, FailureKind>;

export const exitCodeOf = (failure: CommandFailure): number =>
  ExitCode[failureKinds[failure._tag]];

/** The fields of a typed error, without the wrapped cause and the type brands. */
const detailsOf = (
  failure: object
): Readonly<Record<string, unknown>> | undefined => {
  const entries = Object.entries(failure).filter(
    ([key, value]) =>
      key !== "_tag" &&
      key !== "cause" &&
      !key.startsWith("~") &&
      value !== undefined
  );
  return entries.length === 0 ? undefined : Object.fromEntries(entries);
};

/** A typed error as `Output.failure` shows it. */
export const reportOf = (failure: CommandFailure): FailureReport => ({
  name: failure._tag,
  message: failure.message,
  hint:
    Predicate.hasProperty(failure, "hint") && Predicate.isString(failure.hint)
      ? failure.hint
      : undefined,
  details: detailsOf(failure),
  exitCode: exitCodeOf(failure),
});
