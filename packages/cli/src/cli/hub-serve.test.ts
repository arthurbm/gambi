import { expect } from "bun:test";
import { Hub } from "@gambi/core/hub/hub";
import { Mdns } from "@gambi/core/hub/mdns";
import { layerHub } from "@gambi/core/testing/hub";
import { it } from "@gambi/testing/effect";
import { Effect, Layer } from "effect";
import { runCommand, startCommand } from "./testing.ts";

const HUB_STARTED = /^Hub started at http:\/\/127\.0\.0\.1:\d+$/;

// Live: the tests that start a hub open a real port.

it.live("hub serve on a busy port names the port and is invalid usage", () =>
  Effect.gen(function* () {
    const { port } = yield* Hub;

    const result = yield* runCommand([
      "hub",
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(
      JSON.parse(result.stderr.trim().split("\n").at(-1) ?? "").error
    ).toMatchObject({
      name: "PortInUse",
      message: `Port ${port} is already in use on 127.0.0.1. Stop the process that holds it or choose another port.`,
      details: { hostname: "127.0.0.1", port },
      exitCode: 2,
    });
  }).pipe(Effect.provide(layerHub()))
);

it.live("hub serve runs a hub until it is told to stop", () =>
  Effect.gen(function* () {
    const serving = yield* startCommand([
      "hub",
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
    ]);

    const started = yield* serving.nextEvent;
    expect(started).toMatchObject({
      type: "started",
      data: { host: "127.0.0.1", mdns: false },
    });
    const hubUrl = String(started.data.hubUrl);
    expect(hubUrl).toBe(`http://127.0.0.1:${started.data.port}`);

    const created = yield* runCommand([
      "room",
      "create",
      "--name",
      "Pelo binário",
      "--hub",
      hubUrl,
    ]);
    expect(created.exitCode).toBe(0);

    yield* serving.signal("SIGTERM");
    expect(yield* serving.nextEvent).toMatchObject({
      type: "signal_received",
      data: { signal: "SIGTERM" },
    });
    expect(yield* serving.nextEvent).toMatchObject({
      type: "stopped",
      data: { signal: "SIGTERM" },
    });
    expect((yield* serving.result).exitCode).toBe(0);

    const afterStop = yield* runCommand(["room", "list", "--hub", hubUrl]);
    expect(afterStop.exitCode).toBe(3);
  })
);

it.live("hub serve --mdns announces the hub and says under which name", () =>
  Effect.gen(function* () {
    const serving = yield* startCommand([
      "hub",
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
      "--mdns",
    ]);

    const started = yield* serving.nextEvent;
    expect(started.data.mdns).toBe(true);
    expect(yield* serving.nextEvent).toMatchObject({
      type: "mdns_registered",
      data: { name: `gambi-hub-${started.data.port}` },
    });

    yield* serving.signal("SIGINT");
    expect((yield* serving.result).exitCode).toBe(0);
  })
);

it.live("hub serve keeps its log lines off stdout", () =>
  Effect.gen(function* () {
    const serving = yield* startCommand([
      "hub",
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      "0",
    ]);
    yield* serving.nextEvent;
    yield* serving.signal("SIGINT");
    const result = yield* serving.result;

    const events = result.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).type);
    expect(events).toEqual(["started", "signal_received", "stopped"]);
    const logs = result.stderr
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(logs).toContainEqual(
      expect.objectContaining({ level: "INFO", message: "hub listening" })
    );
  })
);

it.live(
  "hub serve on a terminal says where the hub is and how to stop it",
  () =>
    Effect.gen(function* () {
      const serving = yield* startCommand(
        [
          "hub",
          "serve",
          "--host",
          "127.0.0.1",
          "--port",
          "0",
          "--log-level",
          "none",
        ],
        { tty: true }
      );

      expect(yield* serving.nextLine).toMatch(HUB_STARTED);
      expect(yield* serving.nextLine).toBe("Press Ctrl+C to stop");
      yield* serving.signal("SIGINT");
      expect(yield* serving.nextLine).toBe("Shutting down (SIGINT)...");
      expect(yield* serving.nextLine).toBe("Hub stopped.");
      expect(yield* serving.result).toMatchObject({ exitCode: 0, stderr: "" });
    })
);

it.effect("hub serve rejects a port outside 0-65535 as invalid usage", () =>
  Effect.gen(function* () {
    const result = yield* runCommand(["hub", "serve", "--port", "70000"]);

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr).error).toMatchObject({
      name: "InvalidValue",
      details: { option: "port", value: "70000" },
    });
  })
);

it.effect("hub serve --dry-run prints the plan and starts nothing", () =>
  Effect.gen(function* () {
    const result = yield* runCommand([
      "hub",
      "serve",
      "--port",
      "4321",
      "--mdns",
      "--dry-run",
    ]);

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      data: { host: "0.0.0.0", port: 4321, mdns: true },
    });
  })
);

it.live(
  "a bug is reported on stderr as an internal failure, never on stdout",
  () =>
    Effect.gen(function* () {
      const result = yield* runCommand(
        ["hub", "serve", "--host", "127.0.0.1", "--port", "0", "--mdns"],
        {
          mdns: Layer.succeed(
            Mdns,
            Mdns.of({
              announce: () => Effect.die(new Error("responder exploded")),
              announced: Effect.succeed([]),
            })
          ),
        }
      );

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      const lines = result.stderr.trim().split("\n");
      expect(JSON.parse(lines.at(-1) ?? "").error).toMatchObject({
        name: "UnexpectedFailure",
        exitCode: 1,
      });
      expect(result.stderr).toContain("responder exploded");
    })
);
