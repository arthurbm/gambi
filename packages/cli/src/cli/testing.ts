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
  PlatformError,
  Queue,
  Redacted,
  type Scope,
  Sink,
  Stdio,
  Stream,
  Terminal,
} from "effect";
import { FetchHttpClient } from "effect/http";
import { type ChildProcess, ChildProcessSpawner } from "effect/process";
import { HubListen } from "./commands/hub.ts";
import { Installation } from "./installation.ts";
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
  /**
   * What the running `gambi` knows about itself, over `UNKNOWN_INSTALLATION`.
   * Default: an executable `self update` cannot tell the origin of.
   */
  readonly installation?: Partial<Installation["Service"]> | undefined;
  /** The mDNS responder. Default: `Mdns.layerTest`, which touches no network. */
  readonly mdns?: Layer.Layer<Mdns> | undefined;
  /**
   * What starts subprocesses. Default: nothing does, and a command that
   * spawns one fails the test. Pass `spawnerThat(...)` to play the
   * subprocess, or `BunChildProcessSpawner.layer` to really start it.
   */
  readonly spawner?:
    | Layer.Layer<ChildProcessSpawner.ChildProcessSpawner>
    | undefined;
  /** Whether stdin and stdout are a terminal. Default `false`: a pipe. */
  readonly tty?: boolean | undefined;
}

/**
 * An installation that is neither a package of a package manager nor a
 * standalone binary, so that no test updates anything by accident.
 */
export const UNKNOWN_INSTALLATION: Installation["Service"] = {
  arch: "x64",
  argv: ["bun", "/workspace/packages/cli/src/cli/main.ts"],
  execPath: "/workspace/bin/bun",
  pid: 4242,
  platform: "linux",
};

/** A command as the CLI handed it to the spawner. */
export interface SpawnedCommand {
  readonly args: readonly string[];
  readonly command: string;
  /**
   * Whether the CLI let go of the subprocess (`unref`), so that it keeps
   * running after the command ends. A subprocess the CLI still holds is
   * killed when the command ends.
   */
  readonly keptAlive: boolean;
  readonly options: ChildProcess.CommandOptions;
}

/** A subprocess as a test plays it: what it prints and how it ends. */
export interface SubprocessScript {
  /** Default `0`. */
  readonly exitCode?: number | undefined;
  readonly stderr?: string | undefined;
  readonly stdout?: string | undefined;
}

const scriptedOutput = (
  destination: ChildProcess.CommandOptions["stdout"],
  text: string | undefined
): Stream.Stream<Uint8Array> =>
  // Only a piped output reaches the CLI. An inherited one goes to the
  // terminal, an ignored one nowhere.
  destination === undefined || destination === "pipe"
    ? Stream.encodeText(Stream.make(text ?? ""))
    : Stream.empty;

/**
 * A `ChildProcessSpawner` that starts no process. `respond` receives each
 * command the CLI spawns and answers with what the subprocess prints and its
 * exit code, or with the error of a subprocess that could not start.
 */
export const spawnerThat = (
  respond: (
    command: SpawnedCommand
  ) => SubprocessScript | PlatformError.PlatformError
): Layer.Layer<ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make((command) => {
      if (command._tag !== "StandardCommand") {
        return Effect.die(new Error("spawnerThat does not play a pipeline."));
      }
      let referenced = true;
      const script = respond({
        command: command.command,
        args: command.args.map((arg) =>
          Redacted.isRedacted(arg) ? "<redacted>" : arg
        ),
        options: command.options,
        get keptAlive() {
          return !referenced;
        },
      });
      if (script instanceof PlatformError.PlatformError) {
        return Effect.fail(script);
      }
      const stdout = scriptedOutput(command.options.stdout, script.stdout);
      const stderr = scriptedOutput(command.options.stderr, script.stderr);
      return Effect.succeed(
        ChildProcessSpawner.makeHandle({
          pid: ChildProcessSpawner.ProcessId(1),
          exitCode: Effect.succeed(
            ChildProcessSpawner.ExitCode(script.exitCode ?? 0)
          ),
          isRunning: Effect.succeed(false),
          kill: () => Effect.void,
          stdin: Sink.drain,
          stdout,
          stderr,
          all: Stream.merge(stdout, stderr),
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.sync(() => {
            referenced = false;
            return Effect.sync(() => {
              referenced = true;
            });
          }),
        })
      );
    })
  );

/** No test starts a real process without saying so. */
const refuseToSpawn = spawnerThat(({ args, command }) => {
  throw new Error(
    `The command spawned \`${[command, ...args].join(" ")}\`, and the test did not say what it does. Pass \`spawner\` to runCommand.`
  );
});

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * `fetch` for a test: it reaches this machine only. A command that calls
 * anything else gets a transport failure, never the real network.
 */
const loopbackOnlyFetch: typeof globalThis.fetch = Object.assign(
  (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    return LOOPBACK_HOSTS.has(url.hostname)
      ? globalThis.fetch(input, init)
      : Promise.reject(
          new Error(
            `The command requested ${url.origin}. A test only reaches a server on loopback.`
          )
        );
  },
  { preconnect: globalThis.fetch.preconnect }
);

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
          Layer.succeed(Installation, {
            ...UNKNOWN_INSTALLATION,
            ...options.installation,
          }),
          options.mdns ?? Mdns.layerTest,
          options.spawner ?? refuseToSpawn,
          FetchHttpClient.layer,
          Layer.succeed(FetchHttpClient.Fetch, loopbackOnlyFetch)
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
