/**
 * The CLI as a function: arguments in, exit code out, with stdout and stderr
 * written on the way. The entrypoint (`main.ts`) and the command tests
 * (`testing.ts`) both call `runCli`, so a test sees what a shell sees.
 */
import { Cause, Effect, Exit, Layer, Result } from "effect";
import { CliOutput, Command, TerminalCapabilities } from "effect/cli";
import { ExitCode, exitCodeOf, reportOf } from "./exit-codes.ts";
import { peekGlobalFlags } from "./global-flags.ts";
import { Output } from "./output.ts";
import { type CommandFailure, root } from "./root.ts";
import { CLI_VERSION } from "./version.ts";

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
 * prompt needs stdin and stdout on a terminal, and no `--no-interactive`.
 */
const terminalCapabilities = (interactive: boolean) =>
  Layer.effect(
    TerminalCapabilities.TerminalCapabilities,
    Effect.gen(function* () {
      const detected = yield* TerminalCapabilities.TerminalCapabilities;
      return { ...detected, canPrompt: detected.canPrompt && interactive };
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
    return yield* Effect.failCause(failure.failure);
  }).pipe(
    Effect.provide([
      Output.layer(flags.format),
      CliOutput.layerPresenter(presenter),
      terminalCapabilities(flags.interactive),
    ])
  );
};
