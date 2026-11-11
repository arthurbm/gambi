/**
 * The CLI as a function: arguments in, exit code out, with stdout and stderr
 * written on the way. The entrypoint (`main.ts`) and the command tests
 * (`testing.ts`) both call `runCli`, so a test sees what a shell sees.
 */
import {
  Cause,
  Config,
  Effect,
  Exit,
  Layer,
  Logger,
  Option,
  Predicate,
  Result,
} from "effect";
import { CliOutput, Command, TerminalCapabilities } from "effect/cli";
import { ExitCode, exitCodeOf, reportOf } from "./exit-codes.ts";
import { peekGlobalFlags } from "./global-flags.ts";
import { Output } from "./output.ts";
import { type CommandFailure, root } from "./root.ts";
import { CLI_VERSION } from "./version.ts";

const ISSUES_URL = "https://github.com/arthurbm/gambi/issues";

const run = Command.runWith(root, { version: CLI_VERSION });

/**
 * Help and version go to stdout as `effect/cli` renders them. For an invalid
 * command line it would print the whole help before the error: `runCli`
 * reports the error itself, on stderr, and points at `--help` instead.
 */
const presenter: CliOutput.Presenter = {
  present: (event) =>
    event._tag === "InvalidInvocation"
      ? Effect.void
      : CliOutput.defaultPresenter.present(event),
};

/**
 * What the terminal can do, detected from `Stdio` and the environment. A
 * prompt needs stdin and stdout on a terminal, no `--no-interactive` and no
 * `GAMBI_NO_INTERACTIVE=1`.
 */
const terminalCapabilities = (interactive: boolean) =>
  Layer.effect(
    TerminalCapabilities.TerminalCapabilities,
    Effect.gen(function* () {
      const detected = yield* TerminalCapabilities.TerminalCapabilities;
      const disabled = yield* Config.option(
        Config.String("GAMBI_NO_INTERACTIVE")
      ).pipe(Effect.orDie);
      return {
        ...detected,
        canPrompt:
          detected.canPrompt &&
          interactive &&
          Option.getOrUndefined(disabled) !== "1",
      };
    })
  ).pipe(Layer.provide(TerminalCapabilities.layer));

/** Shows a typed error on stderr and answers with its exit code. */
const fail = Effect.fnUntraced(function* (failure: CommandFailure) {
  const output = yield* Output;
  if (failure._tag !== "ShowHelp") {
    yield* output.failure(reportOf(failure));
    return exitCodeOf(failure);
  }
  // `ShowHelp` without errors is a command group called without a command:
  // the help was shown, nothing failed.
  if (failure.errors.length === 0) {
    return ExitCode.success;
  }
  const hint = `Run \`${failure.commandPath.join(" ")} --help\` to see how to call it.`;
  for (const error of failure.errors) {
    yield* output.failure({ ...reportOf(error), hint });
  }
  return exitCodeOf(failure);
});

/**
 * Log lines never share stdout with data: they go to stderr, as JSON when the
 * output is structured.
 */
const logging = Layer.unwrap(
  Effect.gen(function* () {
    const { format } = yield* Output;
    return Layer.mergeAll(
      Layer.succeed(Logger.LogToStderr, true),
      format === "text"
        ? Layer.empty
        : Logger.layer([Logger.withConsoleError(Logger.formatJson)])
    );
  })
);

/**
 * Runs `gambi <argv>` and answers with the exit code. It never fails: every
 * typed error and every defect is shown on stderr and becomes a code. Only an
 * interruption (a signal) gets past it; `processExitCode` covers that.
 */
export const runCli = (argv: readonly string[]) => {
  const flags = peekGlobalFlags(argv);
  return Effect.gen(function* () {
    const exit = yield* Effect.exit(run(argv));
    if (Exit.isSuccess(exit)) {
      return ExitCode.success;
    }
    const failure = Cause.findError(exit.cause);
    if (Result.isSuccess(failure)) {
      return yield* fail(failure.success);
    }
    if (Cause.hasInterruptsOnly(exit.cause)) {
      return yield* Effect.failCause(failure.failure);
    }
    // A defect: a bug here or in the core. The cause goes to the log.
    yield* Effect.logError("gambi failed unexpectedly", exit.cause);
    const output = yield* Output;
    yield* output.failure({
      name: "UnexpectedFailure",
      message: "gambi failed unexpectedly. This is a bug.",
      hint: `Report it at ${ISSUES_URL} with the log lines above.`,
      exitCode: ExitCode.internal,
    });
    return ExitCode.internal;
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        logging,
        CliOutput.layerPresenter(presenter),
        terminalCapabilities(flags.interactive)
      ).pipe(Layer.provideMerge(Output.layer(flags.format)))
    )
  );
};

/** What `runCli` needs from whoever runs it: the entrypoint, or a test. */
export type CliEnvironment = Effect.Services<ReturnType<typeof runCli>>;

/**
 * The exit code of the process for the way `runCli` ended. The parameter is
 * wide because that is what a `Runtime.Teardown` receives.
 */
export const processExitCode = (exit: Exit.Exit<unknown, unknown>): number => {
  if (Exit.isSuccess(exit)) {
    return Predicate.isNumber(exit.value) ? exit.value : ExitCode.success;
  }
  return Cause.hasInterruptsOnly(exit.cause)
    ? ExitCode.interrupted
    : ExitCode.internal;
};
