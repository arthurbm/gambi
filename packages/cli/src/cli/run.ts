/**
 * The CLI as a function: arguments in, exit code out, with stdout and stderr
 * written on the way. The entrypoint (`main.ts`) and the command tests
 * (`testing.ts`) both call `runCli`, so a test sees what a shell sees.
 */
import { Cause, Effect, Exit, Result } from "effect";
import { Command } from "effect/cli";
import { ExitCode, exitCodeOf, reportOf } from "./exit-codes.ts";
import { peekGlobalFlags } from "./global-flags.ts";
import { Output } from "./output.ts";
import { type CommandFailure, root } from "./root.ts";
import { CLI_VERSION } from "./version.ts";

const run = Command.runWith(root, { version: CLI_VERSION });

/** Shows a typed error on stderr and answers with its exit code. */
const fail = Effect.fnUntraced(function* (failure: CommandFailure) {
  const output = yield* Output;
  yield* output.failure(reportOf(failure));
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
  }).pipe(Effect.provide(Output.layer(flags.format)));
};
