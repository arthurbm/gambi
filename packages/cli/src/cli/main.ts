#!/usr/bin/env bun
/**
 * The entrypoint of the `gambi` binary, and the only file of the CLI that
 * touches the platform (ADR-0007): the `@effect/platform-bun` layers, the
 * process signals and the process exit code.
 *
 * Everything a command does is in `runCli`. The command tests run that same
 * function (`testing.ts`); `main.test.ts` covers what is only here.
 */
import { BunHttpServer, BunServices } from "@effect/platform-bun";
import { Mdns } from "@gambi/core/hub/mdns";
import { Effect, Layer, Runtime } from "effect";
import { FetchHttpClient } from "effect/http";
import { HubListen } from "./commands/hub.ts";
import { ExitCode } from "./exit-codes.ts";
import { Installation } from "./installation.ts";
import { type CliEnvironment, processExitCode, runCli } from "./run.ts";
import {
  makeTermination,
  Termination,
  type TerminationSignal,
} from "./termination.ts";

/**
 * The npm wrapper (`bin/gambi`) relays the signal it receives, so one Ctrl+C
 * reaches this process twice. A second signal inside this window is that
 * copy; after it, a second signal is a person who stopped waiting.
 */
const DUPLICATE_SIGNAL_WINDOW_MS = 1000;

const termination = makeTermination();

/**
 * `BunRuntime.runMain` with two differences. The first signal goes to the
 * command when it waits for one (`Termination`), and interrupts it
 * otherwise. A later signal ends the process at once, so a cleanup that
 * hangs never traps the person at the terminal.
 */
const runMain = Runtime.makeRunMain(({ fiber, teardown }) => {
  let firstSignalAt: number | undefined;

  const onSignal = (signal: TerminationSignal) => {
    const now = performance.now();
    if (firstSignalAt === undefined) {
      firstSignalAt = now;
      if (!termination.request(signal)) {
        fiber.interruptUnsafe(fiber.id);
      }
      return;
    }
    if (now - firstSignalAt >= DUPLICATE_SIGNAL_WINDOW_MS) {
      process.exit(ExitCode.interrupted);
    }
  };
  const onSigint = () => onSignal("SIGINT");
  const onSigterm = () => onSignal("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  fiber.addObserver((exit) => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    teardown(exit, (code) => {
      // Without a signal and without an error, let the process end by
      // itself, so pending writes to stdout are flushed.
      if (firstSignalAt !== undefined || code !== 0) {
        process.exit(code);
      }
    });
  });
});

/**
 * Everything `runCli` asks of its environment. A command that needs a new
 * service gets it here and in `testing.ts`.
 */
const Platform: Layer.Layer<CliEnvironment> = Layer.mergeAll(
  Layer.succeed(Termination, termination.service),
  Layer.succeed(HubListen, BunHttpServer.layer),
  Layer.succeed(Installation, {
    arch: process.arch,
    argv: process.argv,
    execPath: process.execPath,
    pid: process.pid,
    platform: process.platform,
  }),
  Mdns.layer,
  FetchHttpClient.layer
).pipe(Layer.provideMerge(BunServices.layer));

runCli(process.argv.slice(2)).pipe(
  Effect.provide(Platform),
  runMain({
    teardown: (exit, onExit) => onExit(processExitCode(exit)),
  })
);
