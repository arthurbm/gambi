/**
 * Runs the CLI as a command inside a test: arguments in; stdout, stderr and
 * the exit code out. It calls the same `runCli` as the binary (`main.ts`),
 * with a recording console, a terminal the test controls, an mDNS double and
 * signals the test sends.
 *
 * `runCommand` runs a command to the end. `startCommand` starts a
 * long-running one and hands back a handle to read its events, signal it and
 * wait for it.
 */
import { BunHttpServer, BunServices } from "@effect/platform-bun";
import { Mdns } from "@gambi/core/hub/mdns";
import {
  type Cause,
  ConfigProvider,
  Console,
  Effect,
  Fiber,
  Layer,
  Option,
  Queue,
  type Scope,
  Stdio,
  Terminal,
} from "effect";
import { FetchHttpClient } from "effect/http";
import { HubListen } from "./commands/hub.ts";
import { processExitCode, runCli } from "./run.ts";
import {
  makeTermination,
  Termination,
  type TerminationSignal,
} from "./termination.ts";

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
  /**
   * The environment variables the command sees. Default: none, so that the
   * environment of whoever runs the tests (`TERM`, `NO_COLOR`, `GAMBI_*`)
   * does not change what a command does.
   */
  readonly env?: Readonly<Record<string, string>> | undefined;
  /** The mDNS responder. Default: `Mdns.layerTest`, which touches no network. */
  readonly mdns?: Layer.Layer<Mdns> | undefined;
  /** Whether stdin and stdout are a terminal. Default `false`: a pipe. */
  readonly tty?: boolean | undefined;
}

/** One event of a long-running command, as it is on a line of stdout. */
export interface CommandEventLine {
  readonly data: Readonly<Record<string, unknown>>;
  readonly timestamp: number;
  readonly type: string;
}

export interface RunningCommand {
  /** The next line of stdout, parsed as an event. Waits for it. */
  readonly nextEvent: Effect.Effect<CommandEventLine>;
  /** The next line of stdout. Waits for it; dies when the command ends first. */
  readonly nextLine: Effect.Effect<string>;
  /** Waits for the command to end. */
  readonly result: Effect.Effect<CommandResult>;
  /** Sends SIGINT or SIGTERM, as the entrypoint does when the process gets one. */
  readonly signal: (signal: TerminationSignal) => Effect.Effect<void>;
}

const recordingConsole = (lines: Queue.Enqueue<string, Cause.Done>) => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const format = (parameters: readonly unknown[]) =>
    parameters.map(String).join(" ");
  const toStdout = (...parameters: readonly unknown[]): void => {
    const text = format(parameters);
    stdout.push(`${text}\n`);
    Queue.offerAllUnsafe(lines, text.split("\n"));
  };
  const toStderr = (...parameters: readonly unknown[]): void => {
    stderr.push(`${format(parameters)}\n`);
  };
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

/**
 * Starts `gambi <args>` in the background. The command is interrupted when
 * the scope closes, if it is still running.
 */
export const startCommand = (
  args: readonly string[],
  options: RunOptions = {}
): Effect.Effect<RunningCommand, never, Scope.Scope> =>
  Effect.gen(function* () {
    const tty = options.tty ?? false;
    const lines = yield* Queue.unbounded<string, Cause.Done>();
    const recording = recordingConsole(lines);
    const drawn: string[] = [];
    const terminal = yield* scriptedTerminal(options.answers ?? [], drawn);
    const termination = makeTermination();

    const fiber = yield* runCli(args).pipe(
      Effect.provide(
        Layer.mergeAll(
          Stdio.layerTest({
            stdinIsTerminal: Effect.succeed(tty),
            stdoutIsTerminal: Effect.succeed(tty),
            stderrIsTerminal: Effect.succeed(tty),
          }),
          Layer.succeed(Terminal.Terminal, terminal),
          Layer.succeed(Termination, termination.service),
          Layer.succeed(HubListen, BunHttpServer.layer),
          options.mdns ?? Mdns.layerTest,
          FetchHttpClient.layer
        )
      ),
      Effect.provide(BunServices.layer),
      Effect.provideService(Console.Console, recording.console),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv({ env: { ...options.env } })
      ),
      Effect.ensuring(Queue.end(lines)),
      Effect.forkScoped
    );

    const nextLine = Queue.take(lines).pipe(
      Effect.catchCause(() =>
        Effect.die(
          new Error(
            `gambi ${args.join(" ")} ended before writing another line.\nstdout:\n${recording.stdout.join("")}\nstderr:\n${recording.stderr.join("")}`
          )
        )
      )
    );

    return {
      nextLine,
      nextEvent: Effect.map(
        nextLine,
        (line) => JSON.parse(line) as CommandEventLine
      ),
      signal: (signal) =>
        termination.request(signal) ? Effect.void : Fiber.interrupt(fiber),
      result: Effect.map(Fiber.await(fiber), (exit) => ({
        exitCode: processExitCode(exit),
        stderr: recording.stderr.join(""),
        stdout: recording.stdout.join(""),
        terminal: drawn.join(""),
      })),
    };
  });

/** Runs `gambi <args>` to the end. */
export const runCommand = (
  args: readonly string[],
  options: RunOptions = {}
): Effect.Effect<CommandResult> =>
  startCommand(args, options).pipe(
    Effect.flatMap((running) => running.result),
    Effect.scoped
  );
