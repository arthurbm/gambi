import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const STARTUP_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;

export interface EventOptions {
  ephemeral: boolean;
  fake: boolean;
}

export interface DatabasePlan {
  cleanupDirectory?: string;
  displayPath: string;
  url: string;
}

interface Child {
  name: string;
  process: Bun.Subprocess<"ignore", "pipe", "pipe">;
  ready: Promise<void>;
}

interface SpawnChildInput {
  command: string[];
  env?: Record<string, string>;
  name: string;
  readyWhen: (line: string) => boolean;
}

export function parseEventArgs(args: string[]): EventOptions {
  const unknown = args.filter(
    (argument) => argument !== "--fake" && argument !== "--ephemeral"
  );
  if (unknown.length > 0) {
    throw new Error(`Unknown option: ${unknown.join(", ")}`);
  }
  return {
    ephemeral: args.includes("--ephemeral"),
    fake: args.includes("--fake"),
  };
}

function fileUrl(path: string): string {
  return `file:${isAbsolute(path) ? path : resolve(ROOT, path)}`;
}

export async function createDatabasePlan(input: {
  configuredUrl?: string;
  ephemeral: boolean;
  roomCode: string;
}): Promise<DatabasePlan> {
  if (input.configuredUrl) {
    return { displayPath: input.configuredUrl, url: input.configuredUrl };
  }
  if (input.ephemeral) {
    const directory = await mkdtemp(join(tmpdir(), "gambi-board-e2e-"));
    const path = join(directory, "board.db");
    return {
      cleanupDirectory: directory,
      displayPath: path,
      url: fileUrl(path),
    };
  }
  const directory = resolve(ROOT, "apps/board/data");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `event-${input.roomCode}.db`);
  return { displayPath: path, url: fileUrl(path) };
}

function prefixedLine(name: string, line: string, error = false) {
  const output = `[${name}] ${line}\n`;
  if (error) {
    process.stderr.write(output);
  } else {
    process.stdout.write(output);
  }
}

function ignorePromise(promise: Promise<unknown>) {
  promise.catch((error) => prefixedLine("event", String(error), true));
}

async function pump(
  stream: ReadableStream<Uint8Array>,
  name: string,
  error: boolean,
  onLine: (line: string) => void
) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    pending += value;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line) {
        prefixedLine(name, line, error);
        onLine(line);
      }
    }
  }
  if (pending) {
    prefixedLine(name, pending, error);
    onLine(pending);
  }
}

function spawnChild(input: SpawnChildInput): Child {
  let resolveReady: () => void;
  let rejectReady: (error: Error) => void;
  let readyFound = false;
  const ready = new Promise<void>((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise;
    rejectReady = rejectPromise;
  });
  const childProcess = Bun.spawn(input.command, {
    cwd: ROOT,
    detached: true,
    env: { ...process.env, ...input.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const inspect = (line: string) => {
    if (!readyFound && input.readyWhen(line)) {
      readyFound = true;
      resolveReady();
    }
  };
  pump(childProcess.stdout, input.name, false, inspect).catch((error) =>
    prefixedLine(input.name, String(error), true)
  );
  pump(childProcess.stderr, input.name, true, inspect).catch((error) =>
    prefixedLine(input.name, String(error), true)
  );
  childProcess.exited.then((exitCode) => {
    if (!readyFound) {
      rejectReady(
        new Error(`${input.name} exited with code ${exitCode} before readiness`)
      );
    }
  });
  return { name: input.name, process: childProcess, ready };
}

async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function waitReady(child: Child) {
  await withTimeout(
    child.ready,
    STARTUP_TIMEOUT_MS,
    `${child.name} did not become ready within ${STARTUP_TIMEOUT_MS}ms`
  );
}

async function createRoom(hubUrl: string): Promise<string> {
  const response = await fetch(`${hubUrl}/v1/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `Gambiarra ${new Date().toISOString()}` }),
  });
  const body = (await response.json()) as {
    data?: { room?: { code?: string } };
    error?: { message?: string };
  };
  if (!(response.ok && body.data?.room?.code)) {
    throw new Error(
      body.error?.message ?? `Room creation failed with ${response.status}`
    );
  }
  return body.data.room.code;
}

async function stopChild(child: Child) {
  if (child.process.exitCode !== null) {
    return;
  }
  child.process.kill("SIGTERM");
  try {
    await withTimeout(
      child.process.exited,
      SHUTDOWN_TIMEOUT_MS,
      `${child.name} did not stop after SIGTERM`
    );
  } catch (error) {
    prefixedLine(child.name, String(error), true);
    child.process.kill("SIGKILL");
    await child.process.exited;
  }
}

async function main() {
  const options = parseEventArgs(process.argv.slice(2));
  const hubUrl = process.env.GAMBI_HUB_URL ?? "http://127.0.0.1:3000";
  const adminToken = process.env.BOARD_ADMIN_TOKEN ?? "gambi-local-admin";
  const children: Child[] = [];
  let database: DatabasePlan | undefined;
  let shuttingDown = false;
  let restartingBoard = false;
  let board: Child | undefined;
  let failUnexpected: (error: Error) => void;
  const unexpectedExit = new Promise<never>((_, reject) => {
    failUnexpected = reject;
  });
  const addChild = (child: Child) => {
    children.push(child);
    child.process.exited.then((exitCode) => {
      if (!(shuttingDown || (restartingBoard && child === board))) {
        failUnexpected(
          new Error(`${child.name} exited unexpectedly with code ${exitCode}`)
        );
      }
    });
  };

  const shutdown = async (exitCode: number) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    for (const child of [...children].reverse()) {
      await stopChild(child);
    }
    if (database?.cleanupDirectory) {
      await rm(database.cleanupDirectory, { recursive: true, force: true });
    }
    process.exit(exitCode);
  };

  process.once("SIGINT", () => ignorePromise(shutdown(0)));
  process.once("SIGTERM", () => ignorePromise(shutdown(0)));

  try {
    const hub = spawnChild({
      name: "hub",
      command: [
        "bun",
        "run",
        "dev:cli",
        "--",
        "hub",
        "serve",
        "--host",
        "0.0.0.0",
        "--port",
        "3000",
        "--format",
        "ndjson",
      ],
      readyWhen: (line) => line.includes('"type":"started"'),
    });
    addChild(hub);
    await waitReady(hub);

    const roomCode = await createRoom(hubUrl);
    database = await createDatabasePlan({
      configuredUrl: process.env.BOARD_DATABASE_URL,
      ephemeral: options.ephemeral,
      roomCode,
    });

    if (options.fake) {
      const fixtures = [
        {
          name: "model-a",
          id: "event-model-a",
          model: "bairro-a",
          nickname: "Modelo Bairro A",
          port: process.env.BOARD_FIXTURE_MODEL_A_PORT ?? "3101",
        },
        {
          name: "model-b",
          id: "event-model-b",
          model: "bairro-b",
          nickname: "Modelo Bairro B",
          port: process.env.BOARD_FIXTURE_MODEL_B_PORT ?? "3102",
        },
      ];
      for (const fixture of fixtures) {
        const child = spawnChild({
          name: fixture.name,
          command: ["bun", "run", "scripts/event-model-fixture.ts"],
          env: {
            FIXTURE_MODEL: fixture.model,
            FIXTURE_NICKNAME: fixture.nickname,
            FIXTURE_PARTICIPANT_ID: fixture.id,
            FIXTURE_PORT: fixture.port,
            GAMBI_HUB_URL: hubUrl,
            GAMBI_ROOM_CODE: roomCode,
          },
          readyWhen: (line) => line.includes('"type":"ready"'),
        });
        addChild(child);
        await waitReady(child);
      }
    }

    const boardEnv = {
      BOARD_ADMIN_TOKEN: adminToken,
      BOARD_DATABASE_URL: database.url,
      BOARD_HOST: "0.0.0.0",
      BOARD_HOSTED_HARNESS: options.fake ? "fake" : "opencode",
      BOARD_PORT: "3001",
      GAMBI_HUB_URL: hubUrl,
      GAMBI_ROOM_CODE: roomCode,
    };
    const startBoard = async () => {
      const nextBoard = spawnChild({
        name: "board",
        command: ["bun", "run", "--cwd", "apps/board", "src/index.ts"],
        env: boardEnv,
        readyWhen: (line) => line.includes("Gambi board listening on"),
      });
      addChild(nextBoard);
      await waitReady(nextBoard);
      board = nextBoard;
    };
    await startBoard();

    const web = spawnChild({
      name: "web",
      command: ["bun", "run", "--cwd", "apps/board-web", "dev"],
      env: {
        BOARD_PROXY_URL: "http://127.0.0.1:3001",
        VITE_BOARD_ENABLE_FAKE_HARNESS: options.fake ? "1" : "0",
      },
      readyWhen: (line) => line.includes("Local:") && line.includes("3002"),
    });
    addChild(web);
    await waitReady(web);

    process.on("SIGUSR1", () => {
      if (restartingBoard || shuttingDown || !board) {
        return;
      }
      restartingBoard = true;
      const previous = board;
      ignorePromise(
        (async () => {
          prefixedLine("event", "Restarting only the board after SIGUSR1");
          await stopChild(previous);
          const index = children.indexOf(previous);
          if (index >= 0) {
            children.splice(index, 1);
          }
          await startBoard();
          prefixedLine("event", "Board restart complete");
          restartingBoard = false;
        })().catch(async (error) => {
          prefixedLine("event", String(error), true);
          await shutdown(1);
        })
      );
    });

    process.stdout.write(
      [
        "",
        `Gambi ${options.fake ? "E2E" : "event"} ready`,
        `Room: ${roomCode}`,
        `Admin: http://localhost:3002/admin?token=${adminToken}`,
        "Projector: http://localhost:3002/",
        `Database: ${database.displayPath}`,
        `Board-only restart: kill -USR1 ${process.pid}`,
        "Stop everything: Ctrl+C",
        "",
      ].join("\n")
    );

    await unexpectedExit;
  } catch (error) {
    process.stderr.write(
      `Event startup failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    await shutdown(1);
  }
}

if (import.meta.main) {
  await main();
}
