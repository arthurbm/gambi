# Effect conventions

Rules for every line of Effect code in this repo. The decision is [ADR-0007](../adr/0007-effect-as-runtime-foundation.md); the facts behind it are in [`docs/research/effect-v4-foundation.md`](../research/effect-v4-foundation.md).

## Read the installed package first

Do not write Effect API from memory. Effect v4 renamed much of the v3 and beta API, and most code you have seen uses the old names.

Before writing Effect code, read these two, from the installed package:

1. `packages/protocol/node_modules/effect/AGENTS.md`
2. The examples in `packages/protocol/node_modules/effect/ai-docs/src/` for the area you touch (services, errors, resources, streams, testing, `51_http-server`, `60_child-process`, `70_cli`)

There is no `node_modules/effect` at the repo root. Bun links each dependency inside the workspace that declares it, so use the path above.

For anything those two do not cover, read the source in `packages/protocol/node_modules/effect/src/`. It is the same version the code runs. Do not use web documentation, a blog post, or another checkout of Effect.

## Version

- `effect` and every `@effect/*` package are pinned to the same exact version, without `^` or `~`. Today that is `4.1.4`.
- The workspace resolves one copy of `effect`. Two copies break schema decoding and service lookup.
- `bun test scripts/effect-foundation.test.ts` fails when a range, a second version, or a second copy appears.
- A bump is its own change: update every `package.json` at once, run the whole suite, and read the release notes. The `cli`, `http`, `http-api`, `rpc`, `socket` and `process` modules are marked unstable and may break in a minor.
- Bun is pinned to `1.4.4` (`packageManager` in the root `package.json` and `bun-version` in the release workflows).

## Imports

- Import by name from the barrel: `import { Effect, Layer, Schema } from "effect"`. Lint rejects namespace imports (`import * as Effect from "effect/Effect"`).
- The modules that used to be separate packages are subpaths of `effect`: `effect/cli`, `effect/http`, `effect/http-api`, `effect/rpc`, `effect/socket`, `effect/process`, `effect/testing`.
- `effect/unstable/*` does not exist. `@effect/platform`, `@effect/cli` and `@effect/rpc` have no v4 release; do not add them.

## Names that no longer exist

Each row was checked against the installed `effect@4.1.4`.

| Do not write | Write |
|---|---|
| `ServiceMap.Service`, `Context.Tag`, `Context.GenericTag`, `Effect.Service`, `Effect.Tag` | `Context.Service` with a `static layer` |
| `FiberRef` | `Context.Reference` |
| `Schema.TaggedErrorClass`, `Schema.ErrorClass` | `Schema.TaggedError` |
| `Effect.catchAll`, `Effect.catchAllCause`, `Effect.catchSome` | `Effect.catch`, `Effect.catchCause`, `Effect.catchIf` |
| `Effect.either`, the `Either` module | `Effect.result`, the `Result` module |
| `Effect.fork`, `Effect.forkDaemon` | `Effect.forkChild`, `Effect.forkDetach` (`Effect.forkScoped` is unchanged) |
| `Effect.async` | `Effect.callback` |
| `Effect.zipRight` | `Effect.andThen` |
| `Effect.timeoutFail` | `Effect.timeout` then `Effect.catchTag("TimeoutError", ...)`, or `Effect.timeoutOrElse` |
| `Cause.TimeoutException` | `Cause.TimeoutError` |
| `Effect.runtime` | `Effect.context`, or a `ManagedRuntime` at the boundary |
| `Layer.scoped`, `Layer.scopedDiscard`, `Layer.unwrapEffect` | `Layer.effect`, `Layer.effectDiscard`, `Layer.unwrap` (`Layer.effect` takes a scoped Effect) |
| `Schema.decodeUnknown` | `Schema.decodeUnknownEffect` (`decodeUnknownSync` is unchanged) |
| `Schema.Union(A, B)`, `Schema.Literal("a", "b")` | `Schema.Union([A, B])`, `Schema.Literals(["a", "b"])` |

`Data.TaggedError` still exists. Do not use it: errors here are `Schema.TaggedError`, because they cross the tunnel and the management plane.

A name missing from this table is not thereby safe. Check it in the installed source.

## Packages and the platform boundary

| Package | Holds | Platform rule |
|---|---|---|
| `@gambi/protocol` | Schemas, the management plane contract, the tunnel calls, the typed errors, the status transition function | No platform at all. No `Bun.*`, no `process`, no `node:*`, no `bun:*`, no `@effect/platform-*`. Lint and its `tsconfig.json` (`types: []`) both reject them. |
| `@gambi/core` | Hub, participant runtime, harness | Depends on the abstract services from `effect` (`FileSystem`, `ChildProcessSpawner`, `Socket`, `HttpServer`). No `Bun.*` in new code. |
| `packages/cli` entrypoint, SDK hosting entries | `BunRuntime.runMain` and the `@effect/platform-bun` layers | The only place `@effect/platform-bun` is imported. |
| `@gambi/testing` | The test helper | Test-only. Never a runtime dependency. |

Because `@gambi/protocol` type-checks without DOM types, a web type such as `Headers` or `ReadableStream` is not in scope there. Take it from an `effect` module instead of the global.

## The management plane contract

`packages/protocol/src/management/api.ts` is the only description of the management plane. The hub's handlers (`packages/core/src/hub/management.ts`), the client (`makeManagementClient`) and the OpenAPI document (`managementOpenApi`, served at `/v1/openapi.json`) derive from it.

- A success schema is wrapped in `success(...)` and an error class in `failure(...)`. They put the envelope on the wire (`{ data, meta }`, `{ error, meta }`) and keep it out of the code: a handler returns the plain value and fails with the typed error; the client gets the same value and the same error back, with `requestId` set.
- A management error is a `Schema.TaggedError` that spreads `requestIdField` into its fields and declares `static readonly code` and `static readonly status`. Its `message` and optional `hint` are getters built from the fields.
- Use `Schema.optionalKey` for an optional field of the wire, not `Schema.optional`: the JSON codec turns `undefined` into `null`.
- Never build the envelope, a status code or a `Response` by hand in a handler.

## The tunnel

A tunnel is `effect/rpc` over the WebSocket a participant dialed, with the roles inverted: the participant runtime dials and **serves** the calls, the hub accepts the socket and **makes** them. Every call is hub to participant.

| What | Where |
|---|---|
| The calls (`TunnelRpcs`) and the URL a runtime dials (`tunnelUrl`) | `packages/protocol/src/tunnel/rpcs.ts` |
| The status table (`transitionStatus`) | `packages/protocol/src/participant-status.ts` |
| Bootstrap tokens and open tunnels (`Tunnels`) | `packages/core/src/hub/tunnels.ts` |
| The upgrade route | `packages/core/src/hub/tunnel-route.ts` |
| Participants and their status (`Participants`) | `packages/core/src/hub/participants.ts` |
| The participant runtime (`register`, `openTunnel`, `ParticipantRuntime.layer`) | `packages/core/src/participant/runtime.ts` |

To add a call:

1. Define it with `Rpc.make` in `rpcs.ts` and add it to `TunnelRpcs`. A stream call sets `stream: true`; its `success` is then the schema of one chunk and its `error` the error of the stream.
2. Implement its handler with `TunnelRpcs.toLayerHandler("<Tag>", handler)` where the participant runtime is hosted, and provide it to `ParticipantRuntime.layer`. The compiler rejects a runtime that misses a handler.
3. On the hub, get the client with `Tunnels.client(roomCode, participantId)` and call it. A unary call is an `Effect`, a stream call a `Stream`.

Rules:

- The handlers belong to the host of the runtime, not to the runtime. That is where `ParticipantAuthHeaders` live; the runtime never receives them, so nothing it sends to the hub can carry them.
- A handler does its work in its own fiber and scope. Interrupting the call on the hub interrupts the handler, so anything it started (a request to the provider, a subprocess) must stop when it is interrupted.
- `Tunnels.client` needs a `Scope` and the client is good until that scope closes. If the tunnel drops meanwhile, the calls fail with `RpcClientError`; `error.reason` says why (`SocketCloseError` with the close code, `SocketReadError` on a ping timeout). Never keep a client past the scope it was taken in: a call on a client that was let go of is interrupted instead of failed.
- A participant's status changes only in `Participants.transition`, which runs the event through `transitionStatus`. Do not write a status anywhere else. What must follow a change (a room event) goes there.
- The hub's wiring of a tunnel (`Tunnels.serve`) has three load-bearing details, listed at the top of `tunnels.ts`. Read them before changing it.
- The hub pings every 5 s (`HubOptions.tunnelPingInterval`) and drops a tunnel that stays silent for one more interval. The participant has no ping of its own.
- A knob of the hub is a field of `HubSettings` (`packages/core/src/hub/settings.ts`), with its default resolved in `Hub.layer`. Services read it from there, not from parameters.

## Services

- State lives in a service. Never in a module-level variable: two hubs in one process must not see each other's rooms.
- Name a service after the domain concept, using [`GLOSSARY.md`](../../GLOSSARY.md): `Rooms`, `Tunnels`, `Harness`. No `Service`, `Manager` or `Impl` suffix.
- Define it with `Context.Service` and attach the implementation as `static readonly layer`. A test double is `static readonly layerTest`.
- The identifier is `gambi/<package>/<Name>`, for example `gambi/core/Rooms`.
- Dependencies come from the environment (`yield* Rooms`), not from parameters. Configuration and plain values may be parameters.
- A reusable function that returns an Effect is `Effect.fn("Rooms.create")(function* ...)`. The name becomes the span. Use `Effect.fnUntraced` for per-chunk and per-event work. Do not write a function whose body is only `Effect.gen`.
- A resource (port, mDNS announcement, timer, socket, subprocess) is acquired with `Effect.acquireRelease` or a scoped layer, so that a later failure releases it.
- Use `Clock` and `DateTime` for time, never `Date.now()` or `setTimeout`. The test clock only controls the former.
- `ManagedRuntime` and `Effect.runPromise` belong at the edges only: the SDK's `Promise` API, the TUI, the CLI entrypoint. Never inside a service.

## Errors

- Every expected failure is a `Schema.TaggedError` class with structured fields (a room code, a port, a participant id). No failure travels as a string.
- The message is fixed or built from the fields, never copied from `cause.message`. An error that wraps another keeps it in a `cause: Schema.Defect()` field.
- Create the error where the failure happens. Map it to an HTTP status or an exit code once, at the transport.
- Recover with `Effect.catchTag` or `Effect.catchTags`. `Effect.catch` handles the whole error channel; use it only when that is the intent.
- Inside a generator, fail with `return yield* new RoomNotFound({ code })`. Keep the `return`.
- A bug (a broken invariant) is a defect: `Effect.die` or `Effect.orDie`. Do not give it a typed error.

## Tests

Tests run on `bun test`. `@gambi/testing/effect` mirrors the `@effect/vitest` API; do not import `@effect/vitest`, which fails inside `bun test`.

Add `"@gambi/testing": "workspace:*"` to the `devDependencies` of the workspace that uses it.

```ts
import { expect } from "bun:test";
import { it, layer } from "@gambi/testing/effect";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";

it.effect("removes a participant 60 s after its tunnel drops", () =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(removal);
    yield* TestClock.adjust("60 seconds");
    expect(yield* Fiber.join(fiber)).toBe("removed");
  })
);

layer(Rooms.layerTest)("Rooms", (it) => {
  it.effect("creates a room", () => Effect.gen(function* () { /* ... */ }));
});
```

| Form | Runs with | Use for |
|---|---|---|
| `it.effect` | `TestClock` and `TestConsole` | Everything by default |
| `it.live` | The real clock | A real socket or a real subprocess, nothing else |
| `layer(L)(name, (it) => ...)` | `L` built once for the block and released when it ends; `it.effect` inside sees the same instances | A shared service, a shared hub |
| `layer(L, { excludeTestServices: true })` | The same, on the real clock | A block that shares a socket or a subprocess |

Each form also has `.skip`, `.only`, `.skipIf(condition)`, `.runIf(condition)`, `.each(cases)` and `.fails`. Plain synchronous tests still use `test` from `bun:test`.

Rules:

- **No real wait in a test.** No `setTimeout`, no `Bun.sleep`, no `Effect.sleep` on the real clock to "let things settle". Timeouts, backoff and removal deadlines run under `it.effect` and move with `TestClock.adjust`.
- **Live only for socket and subprocess.** A live test waits for an event (a `Deferred`, a `Queue`, a stream element), never for a duration.
- Under `it.effect` time does not move by itself. Fork the Effect that sleeps, then call `TestClock.adjust`; joining before adjusting hangs until the `bun test` timeout.
- Every test body gets a `Scope`, closed when the test ends. `Effect.acquireRelease` and `Effect.addFinalizer` work without `Effect.scoped`.
- Test behavior seen from outside: an HTTP response, a room event, a line of stdout, an exit code. Do not assert on which services or layers exist.

### A hub in a test

The main seam is the hub seen from outside: a real hub on a free port, called through the client derived from the contract. `@gambi/core/testing/hub` builds it.

```ts
import { expect } from "bun:test";
import { layerHub, managementClient } from "@gambi/core/testing/hub";
import { layer } from "@gambi/testing/effect";
import { Effect } from "effect";

layer(layerHub(), { excludeTestServices: true })("rooms", (it) => {
  it.effect("creates a room", () =>
    Effect.gen(function* () {
      const client = yield* managementClient;
      const created = yield* client.rooms.create({ payload: { name: "Frevo" } });
      expect(created.room.name).toBe("Frevo");
    })
  );
});
```

- `layerHub()` listens on `127.0.0.1`, port `0`. Read the real port and URL from the `Hub` service. Never pick a port number.
- A block shares one hub, so its tests share rooms. Assert on what the test created, not on the whole list. A test that needs an empty hub, or closes one, builds its own (see `start` in `packages/core/src/hub/hub-lifecycle.test.ts`).
- mDNS goes to `Mdns.layerTest`; `Mdns.announced` lists what is published. Logs go nowhere unless you pass `loggers`.
- Assert on the typed error (`Effect.flip`, then `_tag` or `toBeInstanceOf`). Send a raw request with `HttpClient` only to assert the envelope or the status on the wire.
- A workspace other than the core adds `@effect/platform-bun` and `@gambi/core` to its `devDependencies` to import the helper.

### A participant in a test

`@gambi/core/testing/participant` joins a real participant runtime to the hub of the block. It returns when the participant is `online`.

```ts
import { TunnelRpcs } from "@gambi/protocol";
import { Tunnels } from "@gambi/core/hub/tunnels";
import { TunnelDiagnostics } from "@gambi/core/participant/diagnostics";
import { joinParticipant } from "@gambi/core/testing/participant";

it.effect("answers through the tunnel", () =>
  Effect.gen(function* () {
    const client = yield* managementClient;
    const { room } = yield* client.rooms.create({ payload: { name: "Frevo" } });
    const participant = yield* joinParticipant({
      roomCode: room.code,
      participantId: "arthur-1",
      // Optional: replace a handler. The last layer merged wins.
      handlers: TunnelDiagnostics.pipe(
        Layer.merge(TunnelRpcs.toLayerHandler("Echo", ({ text }) => Effect.succeed(text.toUpperCase())))
      ),
    });
    const tunnel = yield* (yield* Tunnels).client(room.code, "arthur-1");
    expect(yield* tunnel.Echo({ text: "frevo" })).toBe("FREVO");
  })
);
```

- The participant stops when the test ends. `participant.stop` stops it earlier, with a closing handshake; `participant.kill` cuts its socket the way a dead process does.
- The hub notices a drop a moment later. Wait for it with `Tunnels.awaitDrop(roomCode, participantId)`, never with a sleep, and only then assert on the status.
- To see a cancellation arrive, give the handler an `Effect.onInterrupt` that completes a `Deferred` and wait on it (`observedHandler` in `packages/core/src/hub/tunnel.test.ts`).
- `participant.sentToHub` is everything the runtime sent to the hub (HTTP requests and tunnel frames), for asserting what must never leave the participant's machine.
- `register` and `openTunnel` are exported for a test that needs the two steps apart (`packages/core/src/hub/bootstrap-token.test.ts`).

Known traps:

- The `it` inside a `layer` block has no `live`. For a block that needs the real clock, pass `excludeTestServices: true` and use `it.effect`.
- `bun test` stops a test after 5 s. A live test that compiles or spawns something passes a timeout in milliseconds as the third argument.
- Biome's `noMisplacedAssertion` accepts `expect` inside `it.effect` and `it.live`, and rejects it inside `.fails` and `.each`. Suppress it there with a reason.
- A failed Effect test prints its error twice: the helper logs the full cause, then `bun test` reports the rejection.
- Moving the test clock while a tunnel is open can drop the tunnel: a jump leaves no time for a pong, and the hub's ping timeout fires (`adjust("4 seconds")` then `adjust("6 seconds")` does it with the default interval). A test that needs the clock and an open tunnel starts its hub with `layerHub({ tunnelPingInterval: "1 hour" })`.
- A hub built inside `it.effect` (`Effect.provide(layerHub())`) reads the test clock; one shared with `layer(layerHub(), { excludeTestServices: true })` reads the real one.

## The CLI

The new CLI lives in `packages/cli/src/cli/`, beside the current one, on `effect/cli`. `main.ts` is its entrypoint and the only file that imports `@effect/platform-bun`; lint rejects it anywhere else outside the tests.

A command:

- lives in `commands/<group>.ts`, under the group of its resource, and the group is one line in `root.ts`. No flat aliases ([ADR-0002](../adr/0002-agent-first-management-surface.md)).
- writes only through `Output`: `result` for a one-shot command, `event` for each step of a long-running one. Never `Console` or `process.stdout`: `Output` decides between text for a person and JSON for a program, and keeps stdout for data.
- fails with a typed error and renders nothing itself. `run.ts` shows the error on stderr and maps it to an exit code.
- reaches a hub with `withHub(hubUrl, (client) => ...)` and the shared `hubFlag`. It turns a transport failure into `HubUnreachable` and an answer outside the contract into `NotAHub`.
- asks for a missing required flag with `Flag.withFallbackPrompt`. The prompt only runs on a terminal; without one the flag is reported as missing.
- when it runs until stopped, awaits `Termination.signal` and then returns, so that a deliberate stop exits with `0`.

`exit-codes.ts` holds the one table from typed error to exit code. A command that can fail with a new error does not compile until the error has a row there.

A boolean flag needs `Flag.withDefault(false)`: without it the flag is required.

### A command in a test

The seam is the CLI as a command: arguments in; stdout, stderr and the exit code out. `packages/cli/src/cli/testing.ts` runs the same `runCli` as the binary.

```ts
import { expect } from "bun:test";
import { Hub } from "@gambi/core/hub/hub";
import { layerHub } from "@gambi/core/testing/hub";
import { layer } from "@gambi/testing/effect";
import { Effect } from "effect";
import { runCommand } from "./testing.ts";

layer(layerHub(), { excludeTestServices: true })("room commands", (it) => {
  it.effect("a room that does not exist is a remote rejection", () =>
    Effect.gen(function* () {
      const hub = yield* Hub;
      const result = yield* runCommand(["room", "get", "--code", "NOPE00", "--hub", hub.url]);
      expect(result.exitCode).toBe(4);
      expect(JSON.parse(result.stderr).error.name).toBe("RoomNotFound");
    })
  );
});
```

- `runCommand(args, options)` runs to the end. `options.tty` makes stdin and stdout a terminal, `options.answers` types into the prompts, `options.env` sets environment variables.
- `startCommand(args)` starts a long-running command: read its events with `nextEvent`, send `signal("SIGTERM")`, then await `result`.
- Assert on stdout, stderr and the exit code. Do not call a handler or `Output` directly.
- What only the real process shows (the two file descriptors, the exit code of the process, signals) is covered by `main.test.ts`, which spawns the entrypoint.

