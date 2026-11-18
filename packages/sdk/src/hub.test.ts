import { expect } from "bun:test";
import { it } from "@gambi/testing/effect";
import { Effect } from "effect";
import { createClient } from "./client.ts";
import { ClientError } from "./client-error.ts";
import { createHub, HubError, type LogEntry } from "./hub.ts";

/** A hub on a free loopback port, closed when the test ends. */
const hostedHub = Effect.acquireRelease(
  Effect.promise(() => createHub({ hostname: "127.0.0.1", port: 0 })),
  (hub) => Effect.promise(() => hub.close())
);

it.live("a hosted hub answers a management client", () =>
  Effect.gen(function* () {
    const hub = yield* hostedHub;
    const client = createClient({ hubUrl: hub.url });

    const { room } = yield* Effect.promise(() =>
      client.rooms.create({ name: "Frevo" })
    );
    // Only the hub of 0.8 starts a room's stream with its snapshot.
    const first = yield* Effect.promise(() =>
      client.events.watch(room.code)[Symbol.asyncIterator]().next()
    );

    expect(hub.port).toBeGreaterThan(0);
    expect(hub.url).toBe(`http://127.0.0.1:${hub.port}`);
    expect(hub.mdnsName).toBeUndefined();
    expect(first.value?.type).toBe("room.snapshot");
    yield* Effect.promise(() => client.close());
  })
);

it.live("a closed hub answers nobody and frees its port", () =>
  Effect.gen(function* () {
    const hub = yield* Effect.promise(() =>
      createHub({ hostname: "127.0.0.1", port: 0 })
    );
    const client = createClient({ hubUrl: hub.url });
    yield* Effect.promise(() => client.hub.health());

    yield* Effect.promise(() => hub.close());
    const error = yield* Effect.promise(() =>
      client.hub.health().catch((caught: unknown) => caught)
    );
    const next = yield* Effect.promise(() =>
      createHub({ hostname: "127.0.0.1", port: hub.port })
    );

    expect(error).toBeInstanceOf(ClientError);
    expect((error as ClientError).code).toBe("HUB_UNREACHABLE");
    expect(next.port).toBe(hub.port);
    yield* Effect.promise(() => next.close());
    yield* Effect.promise(() => client.close());
  })
);

it.live("a port in use rejects with an error that names the port", () =>
  Effect.gen(function* () {
    const hub = yield* hostedHub;

    const error = yield* Effect.promise(() =>
      createHub({ hostname: "127.0.0.1", mdns: true, port: hub.port }).then(
        () => {
          throw new Error("Expected the second hub not to start.");
        },
        (caught: unknown) => caught
      )
    );

    expect(error).toBeInstanceOf(HubError);
    expect((error as HubError).code).toBe("PORT_IN_USE");
    expect((error as HubError).details).toEqual({
      hostname: "127.0.0.1",
      port: hub.port,
    });
    expect((error as HubError).message).toBe(
      `Port ${hub.port} is already in use on 127.0.0.1. Stop the process that holds it or choose another port.`
    );
  })
);

it.live("an option left undefined is an option not given", () =>
  Effect.gen(function* () {
    const hub = yield* Effect.promise(() =>
      createHub({
        hostname: "127.0.0.1",
        inferenceIdleTimeoutMs: undefined,
        mdns: undefined,
        onLog: undefined,
        port: 0,
        reconnectDeadlineMs: undefined,
      })
    );

    expect(hub.mdnsName).toBeUndefined();
    yield* Effect.promise(() => hub.close());
  })
);

it.live("the hub's log lines go to onLog", () =>
  Effect.gen(function* () {
    const lines: LogEntry[] = [];
    const hub = yield* Effect.acquireRelease(
      Effect.promise(() =>
        createHub({
          hostname: "127.0.0.1",
          onLog: (entry) => lines.push(entry),
          port: 0,
        })
      ),
      (started) => Effect.promise(() => started.close())
    );
    const client = createClient({ hubUrl: hub.url });

    const { room } = yield* Effect.promise(() =>
      client.rooms.create({ name: "Frevo" })
    );

    const created = lines.find((line) => line.message === "room created");
    expect(created?.level).toBe("INFO");
    expect(created?.annotations.roomCode).toBe(room.code);
    expect(Date.parse(created?.timestamp ?? "")).not.toBeNaN();
    yield* Effect.promise(() => client.close());
  })
);
