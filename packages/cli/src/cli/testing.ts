/**
 * Runs the CLI as a command inside a test: arguments in; stdout, stderr and
 * the exit code out. It calls the same `runCli` as the binary, with a
 * recording console and a terminal the test controls.
 */
import { BunServices } from "@effect/platform-bun";
import { Console, Effect, Layer, Stdio } from "effect";
import { FetchHttpClient } from "effect/http";
import { runCli } from "./run.ts";

export interface CommandResult {
  readonly exitCode: number;
  readonly stderr: string;
  readonly stdout: string;
}

export interface RunOptions {
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

/** Runs `gambi <args>` to the end. */
export const runCommand = (
  args: readonly string[],
  options: RunOptions = {}
): Effect.Effect<CommandResult> => {
  const tty = options.tty ?? false;
  const recording = recordingConsole();
  const terminal = Stdio.layerTest({
    stdinIsTerminal: Effect.succeed(tty),
    stdoutIsTerminal: Effect.succeed(tty),
    stderrIsTerminal: Effect.succeed(tty),
  });
  return runCli(args).pipe(
    Effect.provide(Layer.mergeAll(terminal, FetchHttpClient.layer)),
    Effect.provide(BunServices.layer),
    Effect.provideService(Console.Console, recording.console),
    Effect.map((exitCode) => ({
      exitCode,
      stderr: recording.stderr.join(""),
      stdout: recording.stdout.join(""),
    }))
  );
};
