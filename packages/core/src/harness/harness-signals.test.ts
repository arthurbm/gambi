/**
 * No process is left behind when the participant runtime is told to stop
 * from outside: Ctrl+C in its terminal, or SIGTERM. The runtime runs in a
 * process of its own here (`../testing/harness-host.ts`), with a harness that
 * starts a process of its own, and the test sends the signals a terminal and
 * a supervisor send.
 */
import { expect } from "bun:test";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { BunServices } from "@effect/platform-bun";
import { layer } from "@gambi/testing/effect";
import { Effect, FileSystem, Layer } from "effect";
import { Hub } from "../hub/hub.ts";
import { Tunnels } from "../hub/tunnels.ts";
import {
  type FixtureMode,
  nothingHoldsOpen,
} from "../testing/harness-fixtures.ts";
import { layerHub, managementClient } from "../testing/hub.ts";

const HOST = fileURLToPath(
  new URL("../testing/harness-host.ts", import.meta.url)
);

const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Starts the host the way a shell starts a foreground job: as the leader of
 * a process group of its own. Returns when its participant is online.
 */
const startHost = (mode: FixtureMode) =>
  Effect.gen(function* () {
    const hub = yield* Hub;
    const fs = yield* FileSystem.FileSystem;
    const client = yield* managementClient;
    const { room } = yield* client.rooms.create({
      payload: { name: "Sinais" },
    });
    const workspacePath = yield* fs.makeTempDirectoryScoped({
      prefix: "gambi-harness-",
    });
    const held = yield* nothingHoldsOpen;
    const child = spawn(
      process.execPath,
      [HOST, hub.url, room.code, "harness-1", workspacePath, mode, held.path],
      { detached: true, stdio: ["ignore", "pipe", "inherit"] }
    );
    const exited = new Promise<{ code: number | null; signal: string | null }>(
      (resolve) => {
        child.on("exit", (code, signal) => resolve({ code, signal }));
      }
    );
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (child.pid !== undefined && isAlive(child.pid)) {
          process.kill(-child.pid, "SIGKILL");
        }
      })
    );
    const ready = yield* Effect.promise(
      () =>
        new Promise<{ pid: number; harnessPid: number }>((resolve) => {
          createInterface({ input: child.stdout }).once("line", (line) =>
            resolve(JSON.parse(line))
          );
        })
    );
    return {
      ...ready,
      roomCode: room.code,
      exited: Effect.promise(() => exited),
      /** Every process that held the FIFO open is gone: the harness and what it started. */
      nothingLeft: held.released,
    };
  });

layer(Layer.merge(layerHub(), BunServices.layer), {
  excludeTestServices: true,
})("stopping a harness participant from outside", (it) => {
  it.effect(
    "Ctrl+C in the runtime's terminal stops the harness and what the harness started",
    () =>
      Effect.gen(function* () {
        const tunnels = yield* Tunnels;
        const host = yield* startHost("with-child");
        expect(isAlive(host.harnessPid)).toBe(true);

        // What a terminal does on Ctrl+C: SIGINT to the foreground process
        // group. The harness is in a group of its own and does not get it.
        process.kill(-host.pid, "SIGINT");

        const exit = yield* host.exited;
        expect(exit.signal).toBeNull();
        yield* host.nothingLeft;
        expect(isAlive(host.harnessPid)).toBe(false);
        yield* tunnels.awaitDrop(host.roomCode, "harness-1");
      }),
    20_000
  );

  it.effect(
    "SIGTERM to the runtime stops the harness and what the harness started",
    () =>
      Effect.gen(function* () {
        const tunnels = yield* Tunnels;
        const host = yield* startHost("with-child");

        process.kill(host.pid, "SIGTERM");

        const exit = yield* host.exited;
        expect(exit.signal).toBeNull();
        yield* host.nothingLeft;
        expect(isAlive(host.harnessPid)).toBe(false);
        yield* tunnels.awaitDrop(host.roomCode, "harness-1");
      }),
    20_000
  );

  it.effect.each([{ signal: "SIGINT" }, { signal: "SIGTERM" }] as const)(
    "$signal still ends everything when the harness and its child ignore SIGTERM",
    ({ signal }) =>
      Effect.gen(function* () {
        const host = yield* startHost("stubborn");

        process.kill(signal === "SIGINT" ? -host.pid : host.pid, signal);

        yield* host.exited;
        yield* host.nothingLeft;
        // biome-ignore lint/suspicious/noMisplacedAssertion: `it.effect.each` is a test body.
        expect(isAlive(host.harnessPid)).toBe(false);
      }),
    20_000
  );
});
