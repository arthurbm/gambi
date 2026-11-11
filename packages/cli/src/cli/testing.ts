/**
 * Runs the CLI as a command inside a test: arguments in; stdout, stderr and
 * the exit code out. It calls the same `runCli` as the binary, with a
 * recording console and a terminal the test controls.
 */
import { BunServices } from "@effect/platform-bun";
import {
  type Cause,
  ConfigProvider,
  Console,
  Effect,
  Layer,
  Option,
  Queue,
  Stdio,
  Terminal,
} from "effect";
import { FetchHttpClient } from "effect/http";
import { runCli } from "./run.ts";

export interface CommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
  /** What the prompts drew on the terminal. Empty when nothing was asked. */
  readonly terminal: string;
}

export interface RunOptions {
  /**
   * What the person types, one entry per question, each followed by Enter.
   * A question beyond the last answer is cancelled, as with Ctrl+C.
   */
  readonly answers?: readonly string[] | undefined;
  /** Whether stdin and stdout are a terminal. Default `false`: a pipe. */
  readonly tty?: boolean | undefined;
}

const recordingConsole = () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const write =
    (lines: string[]) =>
    (...parameters: readonly unknown[]): void => {
      lines.push(`${parameters.map(String).join(" ")}\n`);
    };
  const toStdout = write(stdout);
  const toStderr = write(stderr);
  const console: Console.Console = Object.assign(
    Object.create(globalThis.console),
    {
      log: toStdout,
      info: toStdout,
      debug: toStderr,
      error: toStderr,
      trace: toStderr,
      warn: toStderr,
    }
  );
  return { console, stderr, stdout };
};

const key = (name: string, input?: string): Terminal.UserInput => ({
  input: Option.fromNullishOr(input),
  key: { name, ctrl: false, meta: false, shift: false },
});

/** A terminal that types `answers` and records what the prompts draw. */
const scriptedTerminal = Effect.fnUntraced(function* (
  answers: readonly string[],
  drawn: string[]
) {
  const input = yield* Queue.unbounded<Terminal.UserInput, Cause.Done>();
  yield* Queue.offerAll(
    input,
    answers.flatMap((answer) => [key("", answer), key("return")])
  );
  yield* Queue.end(input);
  return Terminal.make({
    columns: Effect.succeed(80),
    rows: Effect.succeed(24),
    size: Queue.unbounded<Terminal.Size, Cause.Done>(),
    readInput: Effect.succeed(input),
    readLine: Effect.fail(new Terminal.QuitError({})),
    display: (text) =>
      Effect.sync(() => {
        drawn.push(text);
      }),
  });
});

/** Runs `gambi <args>` to the end. */
export const runCommand = (
  args: readonly string[],
  options: RunOptions = {}
): Effect.Effect<CommandResult> =>
  Effect.gen(function* () {
    const tty = options.tty ?? false;
    const recording = recordingConsole();
    const drawn: string[] = [];
    const terminal = yield* scriptedTerminal(options.answers ?? [], drawn);
    const exitCode = yield* runCli(args).pipe(
      Effect.provide(
        Layer.mergeAll(
          Stdio.layerTest({
            stdinIsTerminal: Effect.succeed(tty),
            stdoutIsTerminal: Effect.succeed(tty),
            stderrIsTerminal: Effect.succeed(tty),
          }),
          Layer.succeed(Terminal.Terminal, terminal),
          FetchHttpClient.layer
        )
      ),
      Effect.provide(BunServices.layer),
      Effect.provideService(Console.Console, recording.console),
      // The environment of whoever runs the tests (`TERM`, `NO_COLOR`) must
      // not change what a command does.
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv({ env: {} })
      )
    );
    return {
      exitCode,
      stderr: recording.stderr.join(""),
      stdout: recording.stdout.join(""),
      terminal: drawn.join(""),
    };
  });
