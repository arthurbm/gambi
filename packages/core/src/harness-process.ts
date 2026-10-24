import { spawn } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { constants as osConstants } from "node:os";
import { delimiter, join } from "node:path";
import { createInterface } from "node:readline";

const STDERR_TAIL_LENGTH = 4000;

// The installed Node typings drop EventEmitter methods from ChildProcess
// (same workaround as packages/cli/src/utils/update.ts).
interface ChildProcessEvents {
  on(event: "spawn", listener: () => void): unknown;
  on(event: "error", listener: (error: Error) => void): unknown;
  on(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void
  ): unknown;
  on(event: "close", listener: (code: number | null) => void): unknown;
}

function events(child: unknown): ChildProcessEvents {
  return child as ChildProcessEvents;
}

/**
 * A harness child process speaking newline-delimited JSON over stdio. Uses
 * Node APIs so `gambi-sdk` consumers can run it under Node as well as Bun.
 */
export interface HarnessProcess {
  /** Exit code; a signal exit resolves to 128 + the signal number, like a shell. */
  readonly exited: Promise<number>;
  exitCode: () => number | null;
  kill: (signal?: NodeJS.Signals) => void;
  /** Stdout, one line at a time. */
  readonly lines: AsyncIterable<string>;
  readonly pid: number;
  /** The last few thousand characters written to stderr. */
  stderrTail: () => string;
  writeLine: (line: string) => void;
}

export async function spawnHarnessProcess(
  command: string,
  args: readonly string[],
  cwd: string
): Promise<HarnessProcess> {
  const child = spawn(command, [...args], {
    cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

  await new Promise<void>((resolveSpawn, reject) => {
    events(child).on("spawn", () => resolveSpawn());
    events(child).on("error", reject);
  });

  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-STDERR_TAIL_LENGTH);
  });
  // Writes after the child exits raise EPIPE; the exit itself is reported.
  child.stdin.on("error", () => undefined);

  const exited = new Promise<number>((resolveExit) => {
    events(child).on("exit", (code, signal) => {
      resolveExit(code ?? 128 + (signal ? osConstants.signals[signal] : 0));
    });
  });

  return {
    pid: child.pid ?? -1,
    exited,
    exitCode: () => child.exitCode ?? (child.signalCode ? -1 : null),
    kill: (signal) => {
      child.kill(signal);
    },
    lines: createInterface({
      input: child.stdout,
      crlfDelay: Number.POSITIVE_INFINITY,
    }),
    stderrTail: () => stderr,
    writeLine: (line) => {
      child.stdin.write(`${line}\n`);
    },
  };
}

function executableNames(command: string): string[] {
  if (process.platform !== "win32") {
    return [command];
  }
  const extensions = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";");
  return [command, ...extensions.map((extension) => `${command}${extension}`)];
}

/** Resolves a command on `PATH`, like `which`. */
export function whichCommand(command: string): string | undefined {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) {
      continue;
    }
    for (const name of executableNames(command)) {
      const candidate = join(directory, name);
      try {
        accessSync(candidate, constants.X_OK);
        return candidate;
      } catch {
        // Not here; keep looking.
      }
    }
  }
  return undefined;
}

export async function runCommand(
  command: string,
  args: readonly string[]
): Promise<{ exitCode: number; stderr: string; stdout: string }> {
  const child = spawn(command, [...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const exitCode = await new Promise<number>((resolveExit) => {
    events(child).on("error", (error) => {
      stderr += error.message;
      resolveExit(1);
    });
    events(child).on("close", (code) => resolveExit(code ?? 1));
  });
  return { stdout, stderr, exitCode };
}
