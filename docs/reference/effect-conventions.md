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
| `gambi-sdk` default entry | The management client and the inference provider | Reaches a hub with `fetch` only. No built-in module of Node or Bun, checked on the packed package. |
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
- A participant's status changes only in `Participants.transition`, which runs the event through `transitionStatus` and publishes the room event of the change. Do not write a status anywhere else, and do not publish a status event yourself. What else must follow a change goes there.
- The hub's wiring of a tunnel (`Tunnels.serve`) has three load-bearing details, listed at the top of `tunnels.ts`. Read them before changing it.
- The hub pings every 5 s (`HubOptions.tunnelPingInterval`) and drops a tunnel that stays silent for one more interval. The participant has no ping of its own: it watches the hub's frames instead, and drops a tunnel that stays silent for three ping intervals (`HUB_SILENCE_PING_INTERVALS`). The hub says its interval in `Welcome`.
- `ParticipantRuntime.layer` joins once and fails when the join fails. After that it comes back by itself when the tunnel drops: it registers again (a bootstrap token opens one tunnel) and dials again with the same `participantId`, waiting 1 s and then twice as long after each attempt that fails, up to 30 s. A refusal of the hub (`VersionMismatch`, `RoomNotFound`, `InvalidPassword`, `InvalidRequest`) ends the runtime instead of being retried; `ParticipantRuntime.ended` fails with it.
- A participant has one tunnel, and the last one to open wins. The hub closes the tunnel it replaces with the WebSocket close code `TUNNEL_REPLACED_CLOSE_CODE` (`packages/protocol/src/tunnel/rpcs.ts`). A runtime whose tunnel closes with that code was replaced by another runtime with its `participantId`: it ends with `left` and the reason `replaced`, and does not dial again, or the two would take the tunnel from each other forever. A runtime that comes back by itself never sees the code, because it had already let go of the tunnel the hub closes.
- A host follows the runtime through `onLifecycle`, which receives `connected`, `reconnecting` and `left` (`ParticipantLifecycleEvent`), in order. Add a step of the runtime's life there, not as a second callback.
- A knob of the hub is a field of `HubSettings` (`packages/core/src/hub/settings.ts`), with its default resolved in `Hub.layer`. Services read it from there, not from parameters.
- A participant that is `offline` is removed after `HubSettings.reconnectDeadline` (60 s). Going online cancels the deadline; registering again restarts it.
- Whoever consumes a stream call on the hub takes each chunk as soon as it arrives and never waits for someone else before taking the next. A tunnel has one reader: while it waits on a stream nobody is draining, it reads nothing else on that tunnel, pongs included, and the hub drops the tunnel on a ping timeout. Put a bounded buffer with a policy (drop, or fail the consumer) between the stream and anything slow. `infer` in `packages/core/src/hub/inference.ts` is the example.
- Every call has a default handler for a participant that does not serve it, which fails with `CallNotSupported`: `InferenceNotServed` (`packages/core/src/participant/inference.ts`) for `Infer`. A host of a runtime provides, for each call, either the real handler or that one.

## The inference plane

The OpenAI-compatible routes under `/rooms/:code/v1/*` are plain `HttpRouter` routes in `packages/core/src/hub/inference.ts`, outside the management contract: they pass a provider's answer through.

| What | Where |
|---|---|
| The routes, and how a request lives and ends (`infer`, `storedResponse`, `askProvider`, `respond`) | `packages/core/src/hub/inference.ts` |
| What the hub reads of a body and what it fills in (`readRequest`, `providerBody`) | `packages/core/src/hub/inference-request.ts` |
| Routing by model selector (`Participants.dispatch`) | `packages/core/src/hub/participants.ts` |
| Which participant's provider holds each Response (`StoredResponses`) | `packages/core/src/hub/stored-responses.ts` |
| The Responses API through Chat Completions (`toChatCompletionsRequest`, `toResponse`, `toResponseEvents`) | `packages/core/src/hub/responses-translation.ts` |
| The tunnel call (`Infer`, `InferenceRequest`, `InferenceCreation`, `StoredResponseOperation`, `InferenceChunk`) | `packages/protocol/src/tunnel/rpcs.ts` |
| The handler that calls the local provider (`providerInference`) | `packages/core/src/participant/inference.ts` |
| Capability detection, on the participant's machine (`probeEndpoint`) | `packages/core/src/participant/endpoint-capabilities.ts` |
| The errors and their OpenAI form (`InferenceError`, `INFERENCE_FAILURES`, `toOpenAiError`) | `packages/protocol/src/inference/errors.ts` |
| The events of a request (`llm.request`, `llm.complete`, `llm.error`) | `packages/protocol/src/room-event.ts`, published by `packages/core/src/hub/request-events.ts` |

Rules:

- The hub reads `model` and `stream` of a body and nothing else. Do not validate, rename or drop any other field; the provider is the one that knows them.
- `ParticipantAuthHeaders` are an option of `providerInference`, on the participant's machine. Nothing in the hub or in `@gambi/protocol` has a field for them.
- An inference failure is an `InferenceError` with a row in `INFERENCE_FAILURES` (its `code` and HTTP status). The route answers it in the OpenAI error format, never in the management envelope: as the response when nothing was sent yet, as a last `error` event when a `text/event-stream` body was already on its way.
- The participant is `busy` while the call in its tunnel is open (the `call` scope in `infer`), and `Participants.dispatch` plus that scope are the only things that make it so. Everything a request holds goes in that scope, so that a cancelled request, a timeout and a dead participant all release it the same way.
- A new route that calls a provider is a new literal of `InferenceCreation` or of `StoredResponseOperation`, a row in `PROVIDER_ROUTES` (participant), and one `HttpRouter.add` in `InferenceRoutes`. An operation that creates also gets a row in `DEFAULT_FIELDS` (`inference-request.ts`) and in `PROTOCOLS` (`request-events.ts`). The compiler asks for each row.
- A route about a stored Response (`storedResponse`) is not dispatched: it goes to the participant that created the Response even while that participant is `busy`, changes no status and publishes no event. Only a route that creates something goes through `Participants.dispatch`.
- The hub remembers a bounded number of Responses (`HubOptions.storedResponsesLimit`) and forgets the one used the longest ago. Everything that enters `StoredResponses` goes through `remember`; do not keep a second map of Responses.
- A Response is created in the API the participant's provider speaks. `capabilities.openResponses: "unsupported"`, or a 404, 405 or 501 on `POST /v1/responses`, sends the request through Chat Completions, and `responses-translation.ts` writes the answer as a Response. A translated Response is stored nowhere: its routes answer `response_not_stored`.
- Whatever the hub does to an answer on its way to the app is an `AnswerForm` given to `respond`. Do not read the tunnel or build the response body anywhere else: `respond` is what makes a request cancellable, timed out and bounded.
- A provider's `text/event-stream` is read with `Sse.makeParser` and written with `Sse.encoder`, from `effect/encoding`. Do not split a stream on blank lines by hand.
- Capability detection (`probeEndpoint`) runs on the participant's machine, with the `ParticipantAuthHeaders`, and its result goes up as `profile.capabilities`. The hub never probes a provider.

## Room events and event streams

A room event tells whoever watches a room that something happened. The events are a union of structs told apart by `type`, in `packages/protocol/src/room-event.ts`; the hub publishes them through `RoomEvents` (`packages/core/src/hub/room-events.ts`) and streams them at `GET /v1/rooms/:code/events`.

To add an event:

1. Define it with `roomEvent("<thing>.<what happened>", { ...fields })` in `room-event.ts` and add it to the `RoomEvent` union. `roomEvent` adds `type`, `roomCode` and `timestamp`.
2. Publish it where it happens: `yield* (yield* RoomEvents).publish(roomCode, { type: "<thing>.<what happened>", ...fields })`. The hub stamps the room code and the time.

The stream, the derived client and the OpenAPI document take the new event from the union.

Rules:

- `publish` never waits for a watcher and never fails. A room keeps its last 256 events for a watcher that is behind; one that falls further behind loses the oldest. Do not build a second fan-out for room events.
- Every stream of a room starts with `room.snapshot`: the room and its participants when the stream started. A client that keeps state applies the snapshot and then each event in order; it needs no `list` first.
- An endpoint that streams events declares `success: eventStream(Schema)` (`packages/protocol/src/management/event-stream.ts`), where the schema is a struct with a string `type` or a union of them. On the wire it is Server-Sent Events, one JSON object per event, with the `type` repeated on the `event:` line.
- Its handler returns a `Stream` and passes it through `OpenStreams.untilHubCloses` (`packages/core/src/hub/open-streams.ts`). A stream that skips it holds the hub open for 20 s when it closes.
- The method of the derived client answers an `Effect` of a `Stream`: `Stream.unwrap(client.events.watch({ params: { code } }))`. That is the one SSE parser of the management plane (`effect/encoding/Sse`, inside `HttpApiClient`). Do not write another, and do not read the response body by hand.
- The stream completes, without an error, when the hub closes. A client that wants to keep watching reconnects when it does.

## Harness participants

A harness participant contributes a harness instead of a model endpoint ([ADR-0006](../adr/0006-harness-participants-over-acp.md)). Its registration carries `harness: { id, model?, hosted? }`, and it serves the harness calls of the tunnel.

| What | Where |
|---|---|
| The events and the attach schemas (`HarnessEvent`, `HarnessAttachEvent`, `HarnessArtifact`, `MAX_ARTIFACT_BYTES`) | `packages/protocol/src/harness.ts` |
| The harness calls of the tunnel and their errors | `packages/protocol/src/tunnel/rpcs.ts`, `tunnel/errors.ts` |
| The subprocess, the ACP session and the relay (`Harness`) | `packages/core/src/harness/harness.ts` |
| The three typed ACP calls | `packages/core/src/harness/acp.ts` |
| Is it installed and logged in (`resolveHarness`, `HarnessNotReady`) | `packages/core/src/harness/detection.ts` |
| The tunnel handlers of a harness participant | `packages/core/src/harness/tunnel-handlers.ts` |
| The Workspace seam and its default, a local folder (`Workspace`) | `packages/core/src/harness/workspace.ts` |
| The artifacts of the Workspace going up (`workspaceArtifacts`) | `packages/core/src/harness/artifacts.ts` |
| A harness participant whole, with its layers in order (`harnessParticipant`) | `packages/core/src/harness/harness-participant.ts` |
| The clients attached in the hub (`HarnessClients`) | `packages/core/src/hub/harness-clients.ts` |
| The `harness` group of the management contract and its handlers | `packages/protocol/src/management/api.ts`, `packages/core/src/hub/harness-attach.ts` |

The two directions of the tunnel:

- **Up, from the participant:** one long-lived stream call, `HarnessEvents`. The hub opens it on every tunnel, right after `Welcome`, and reads it for the life of the tunnel. Everything that is born on the participant is a chunk of it: a member of the `HarnessEvent` union. To send a new kind of thing up, add a member to the union and publish it with `Harness.publish(event)`. Do not add a call from the participant to the hub; there is none.
- **Down, from the hub:** ordinary calls (`HarnessSend`, `HarnessOpenSession`, `HarnessCloseSession`). Each answers what the participant did with it; what the harness says afterwards comes up the stream.

To host a harness participant:

```ts
const { command } = yield* resolveHarness("opencode"); // fails with HarnessNotReady
const Host = harnessParticipant({
  runtime: {
    hubUrl, roomCode, participantId,
    profile: { nickname, model: "opencode", harness: { id: "opencode" } },
  },
  harness: { command },
  artifacts: { onArtifact }, // optional: what happened to each artifact
}).pipe(
  Layer.provide(
    Workspace.layerLocalDirectory({ roomCode, participantId, harness: "opencode", model: "opencode", path })
  )
);
```

`harnessParticipant` is three layers in one order: the `Harness`, then `ParticipantRuntime` with `HarnessParticipantHandlers`, then `workspaceArtifacts`. Use it instead of putting them together by hand.

Rules:

- The `Harness` layer goes under the runtime, so it is built first and released last. The harness then outlives every tunnel of a runtime that reconnects: its sessions stay open, and what it says while the tunnel is down waits (the last 4096 events) and goes up on the next tunnel.
- The artifacts go over the runtime, so they are released first: the last artifact is taken and sent while the tunnel is open and the harness is running. Released in another order, it is sent to nobody.
- The harness runs in a process group of its own, and releasing its layer signals the whole group, with SIGKILL after `stopTimeout` (2 s). The reasons are at the top of `harness.ts`. Do not start a harness with a bare `spawn`.
- The runtime types the three ACP calls it makes (`initialize`, `session/new`, `session/close`) and reads nothing else of ACP. Of a message it relays it swaps the session id and the JSON-RPC id of a client's request, so that several clients never share one. A new need to read an ACP message is a decision, not an edit: ACP stays opaque and on v1.
- A harness session opens and closes one at a time and to the end, even when whoever asked went away: the harness opens the session all the same, and the runtime has to know it.
- The hub's reader of a stream call must never wait for its consumer. One fiber reads the socket of a tunnel and waits while the buffer of a stream call is full; while it waits, no other call of that tunnel moves, pongs included, and two ping intervals later the hub drops the tunnel. `HarnessClients.deliver` therefore never waits: each attached client has a bounded buffer (`HubOptions.harnessClientBuffer`, 1024 events) and loses its own oldest events, with a `harness.dropped` event saying how many.
- A management client attaches with `GET /v1/rooms/:code/participants/:id/harness/events` (the same `eventStream` as room events) and talks with `POST .../harness/messages`, `PUT .../harness/sessions/:sessionId` and `DELETE .../harness/sessions/:sessionId`. There is no WebSocket for clients.
- A client is attached to a participant, not to a tunnel. Its stream starts with `harness.connected` or `harness.disconnected`, says so again at every change, and ends with `harness.detached` when the participant is out of the room.

### The Workspace and its artifacts

The Workspace is the folder on the participant's machine where its harness sessions run ([`GLOSSARY.md`](../../GLOSSARY.md)). It is a seam: the `Workspace` service has three operations, and whoever hosts decides which Workspace is in the environment.

| Operation | In the service | The default (`Workspace.layerLocalDirectory`) |
|---|---|---|
| Prepare | Building the layer; `path` says where the folder is | Creates `<gambiHome>/workspaces/<roomCode>/<participantId>/`, or uses the `path` it was given, and writes `.gambi.json` there and nothing else |
| Observe | `changes`: one element when something changed | A recursive watch of the folder, installed before the layer is built |
| Collect | `collect`: the files as they are now | Every regular file, text in `utf8` and the rest in `base64`, without anything named `.git` or `node_modules` (a folder or a file), without `.gambi.json` and without symbolic links |

Rules:

- **Artifacts only go up.** Nothing in the tunnel writes a file on the participant's machine ([ADR-0006](../adr/0006-harness-participants-over-acp.md)), and no call may start to. `packages/core/src/harness/tunnel-writes-no-file.test.ts` makes every call of `TunnelRpcs` and fails when the participant runtime writes; it stops compiling when a call is added, until the new call is in it.
- An artifact is a `harness.artifact` event: a whole snapshot of the Workspace, with the next `version`, sent through `Harness.publish` like everything else that goes up. It is taken when the Workspace changed and then stayed still for one second (`reason: "watch"`), and once more when the participant closes (`reason: "final"`).
- An artifact is at most `MAX_ARTIFACT_BYTES` (8 MiB of JSON text). Both limits behind it were measured: the hub drops a tunnel that receives a WebSocket message of 16 MiB, and the derived client fails a stream on a Server-Sent Event above 10 MiB. A Workspace that does not fit sends no artifact and takes no version; the host hears `artifactSkipped` through `onArtifact`. Never send a part of the files: a snapshot without a file says the file is gone.
- An artifact goes up in a tunnel message of its own (`events` in `harness.ts`): events that waited while a tunnel was down go up together in one message otherwise.
- Only the newest artifact waits for the hub. One that a newer one replaced before it went is never sent, so a client may see versions skip, and a participant that works through a long drop of its tunnel holds one snapshot, not all of them.
- Delivery is at most once. What the participant had handed to the tunnel when it dropped is not sent again; the next change of the Workspace sends a whole snapshot.
- The last artifact is sent on a best effort. Closing waits for the hub to read it, for at most two seconds, and not at all when the tunnel is down (`Harness.flushed`).
- A custom Workspace is a `Layer` that provides `Workspace`. To put starter content in the default one, build on it and write into `path` before the harness starts. `collect` must fail with `WorkspaceTooLarge` instead of reading what cannot be sent.
- A test of the waits drives a Workspace of its own on the test clock (`packages/core/src/harness/artifacts.test.ts`); a test of the whole path uses the real folder and a short `settleTime`, and waits for the artifact (`packages/core/src/hub/harness-artifacts.test.ts`).

### A harness in a test

Tests run a harness as a real subprocess and never call a model or a real harness.

- `fakeHarnessCommand()` (`packages/core/src/harness/adapters.ts`) is the well-behaved one: the deterministic fake ACP agent. On a prompt it writes `fake-output.txt` in the folder of the session, so a prompt is also a way to make an artifact.
- `fixtureHarness(mode, path)` (`@gambi/core/testing/harness-fixtures`) misbehaves on purpose: it never answers, answers ACP v2, exits on a prompt, starts a child, ignores SIGTERM.
- `nothingHoldsOpen` gives a `path` to hand to one fixture and a `released` effect that completes when the fixture and everything it started are gone. Use it instead of polling a pid: a process that is a zombie still answers `kill(pid, 0)`.
- A test that needs the platform provides `BunServices.layer`: `layer(Layer.merge(layerHub(), BunServices.layer), { excludeTestServices: true })`.
- What is in the harness's stream when a client attaches depends on timing: the session the runtime opened at start goes up as soon as the hub reads the stream. A test that attaches after joining waits for that event first (`joinHarness` in `packages/core/src/hub/harness-attach.test.ts`).
- A test that needs the tunnel to carry real pings uses `layerHub({ tunnelPingInterval: "100 millis" })` and waits for pongs with `participant.awaitSent`. Not shorter: a busy test process stalls for more than 20 ms.

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
import { joinParticipant } from "@gambi/core/testing/participant";

it.effect("answers through the tunnel", () =>
  Effect.gen(function* () {
    const client = yield* managementClient;
    const { room } = yield* client.rooms.create({ payload: { name: "Frevo" } });
    const participant = yield* joinParticipant({
      roomCode: room.code,
      participantId: "arthur-1",
      // Optional: replace the handler of a call. The other calls keep their default.
      handlers: TunnelRpcs.toLayerHandler("Echo", ({ text }) => Effect.succeed(text.toUpperCase())),
    });
    const tunnel = yield* (yield* Tunnels).client(room.code, "arthur-1");
    expect(yield* tunnel.Echo({ text: "frevo" })).toBe("FREVO");
  })
);
```

- `handlers` replaces only the calls it names. Every other call keeps the handler of `defaultHandlers` (the diagnostics, and "not supported" for the calls of the other kinds of participant), so a test keeps compiling when the tunnel gains a call. A ticket that adds calls to the tunnel adds their default handlers to `defaultHandlers`. A test that builds a runtime by hand (`openTunnel`) provides `defaultHandlers`.
- `participant.awaitSent(seen)` waits until what the participant sent to the hub satisfies `seen`: a number of pongs, a frame. Use it instead of a sleep.
- The participant stops when the test ends. `participant.stop` stops it earlier, with a closing handshake; `participant.kill` cuts its socket the way a dead process does.
- A test participant does not reconnect, unlike the runtime's own default: a participant that a test kills stays dead. Pass `reconnect: true` to test coming back.
- `participant.nextLifecycleEvent` waits for the next lifecycle event; `participant.lifecycleEvents` lists the ones so far.
- The hub notices a drop a moment later. Wait for it with `Tunnels.awaitDrop(roomCode, participantId)`, never with a sleep, and only then assert on the status.
- To see a cancellation arrive, give the handler an `Effect.onInterrupt` that completes a `Deferred` and wait on it (`observedHandler` in `packages/core/src/hub/tunnel.test.ts`).
- `participant.sentToHub` is everything the runtime sent to the hub (HTTP requests and tunnel frames), for asserting what must never leave the participant's machine.
- `register` and `openTunnel` are exported for a test that needs the two steps apart (`packages/core/src/hub/bootstrap-token.test.ts`).
- By default the participant answers the diagnostics and refuses inference (`InferenceNotServed`). Give it a `provider` to make it serve inference.

### A provider in a test

`fakeProvider` from `@gambi/core/testing/provider` is a real HTTP server on a free loopback port that stands where Ollama would. It answers like an OpenAI-compatible backend and records what it gets. With it a test runs the whole path: app, hub, tunnel, participant runtime, provider.

```ts
const provider = yield* fakeProvider();
yield* joinParticipant({
  roomCode: room.code,
  participantId: "arthur-1",
  provider: { endpoint: provider.url, authHeaders: { Authorization: "Bearer segredo" } },
});
const response = yield* Effect.promise(() =>
  fetch(`${hub.url}/rooms/${room.code}/v1/chat/completions`, {
    method: "POST",
    body: JSON.stringify({ model: "arthur-1", messages: [{ role: "user", content: "Oi" }] }),
  })
);
const call = yield* provider.nextCall;
expect(call.headers.authorization).toBe("Bearer segredo");
```

- `provider.nextCall` waits for a request and hands each one out once; `provider.calls` is all of them so far. A call has `method`, `path`, `headers`, `body` and `aborted`.
- `call.aborted` completes when the caller gave the request up. Waiting on it is how a test sees a cancellation, a timeout or a dead participant reach the provider.
- `fakeProvider({ answer })` decides the answer: `jsonAnswer`, `sseAnswer`, or `openStream()` for a body the test writes piece by piece (`send`, `end`, `fail`). A provider that never answers is `answer: () => new Promise(() => undefined)`.
- `answer: storingResponses()` is a provider that speaks the whole Responses API: it keeps the Responses it creates (`resp_1`, `resp_2`, ...) and answers the routes under `/v1/responses/:id`. `answer: chatCompletionsOnly` is a provider with no Responses API, as most local backends are. The default (`openAiAnswer`) creates a Response and keeps nothing.
- A provider sends its response head with the first piece of the body. With `openStream`, `send` one piece before the request, or the app's `fetch` never returns.
- Call the inference plane with a plain `fetch`, as an app does. A status changes a moment after the response ends only when the app cancelled; when the response ended by itself the participant is already `online`.
- A test of the inactivity timeout builds its hub inside `it.effect` and moves the test clock (`packages/core/src/hub/inference-timeout.test.ts`).

### A hub that goes away or freezes

`@gambi/core/testing/hub-link` puts a TCP relay between a participant and the hub of the test. The hub keeps running, with its rooms; the test decides what the participant sees of it.

```ts
import { linkToHub } from "@gambi/core/testing/hub-link";

it.effect("comes back when the hub returns", () =>
  Effect.gen(function* () {
    const link = yield* linkToHub;
    const participant = yield* joinParticipant({ roomCode, hubUrl: link.url, reconnect: true });
    yield* participant.nextLifecycleEvent; // connected

    yield* link.cut; // the tunnel is severed and the hub refuses connections
    yield* participant.nextLifecycleEvent; // reconnecting, attempt 1, in 1 s
    yield* link.restore;
    yield* TestClock.adjust("1 second");
    yield* participant.nextLifecycleEvent; // connected, attempt 1
  }).pipe(Effect.provide(layerHub({ tunnelPingInterval: "1 hour" })))
);
```

- `link.cut` and `link.restore` are a hub that went away and returned. `link.freeze` and `link.unfreeze` are a hub whose process froze: connections stay open, new ones are accepted, and nothing moves.
- The waits of a reconnection run on the test clock, so build the hub inside the test (`Effect.provide(layerHub(...))`) and move the clock after each event. Wait for the event first, then adjust: the runtime starts its wait right after it reports `reconnecting`.
- The hub removes a participant that stays `offline` for 60 s, and those 60 s also pass on the test clock. A runtime that comes back later registers as a new participant with the same id, so nothing changes for the test unless it watches the room.
- A hub that really restarts comes back without its rooms, and a room code cannot be asked for again, so a runtime that reconnects to it ends with `RoomNotFound`. `startHub` in `packages/core/src/participant/reconnection.test.ts` restarts a hub on its port.

### Room events in a test

`watchRoom` from `@gambi/core/testing/hub` watches a room through the derived client until the test ends. It returns once the stream is open, so whatever the test does next is in `next`.

```ts
const watch = yield* watchRoom(room.code);
yield* joinParticipant({ roomCode: room.code, participantId: "arthur-1" });
expect((yield* watch.next).type).toBe("participant.joined");
expect((yield* watch.next).type).toBe("participant.online");
```

- `watch.snapshot` is the first event; `watch.next` hands out each later event once, in order, and waits for one that has not arrived. Never sleep to "let the event arrive".
- An event that must not happen cannot be waited for. Do something whose event you can wait for, and assert it is the next one.

Known traps:

- The `it` inside a `layer` block has no `live`. For a block that needs the real clock, pass `excludeTestServices: true` and use `it.effect`.
- `bun test` stops a test after 5 s. A live test that compiles or spawns something passes a timeout in milliseconds as the third argument.
- Biome's `noMisplacedAssertion` accepts `expect` inside `it.effect` and `it.live`, and rejects it inside `.fails` and `.each`. Suppress it there with a reason.
- A failed Effect test prints its error twice: the helper logs the full cause, then `bun test` reports the rejection.
- Moving the test clock while a tunnel is open can drop the tunnel: a jump leaves no time for a pong, and the hub's ping timeout fires (`adjust("4 seconds")` then `adjust("6 seconds")` does it with the default interval). A test that needs the clock and an open tunnel starts its hub with `layerHub({ tunnelPingInterval: "1 hour" })`.
- A hub built inside `it.effect` (`Effect.provide(layerHub())`) reads the test clock; one shared with `layer(layerHub(), { excludeTestServices: true })` reads the real one.
- A participant on the test clock drops its tunnel when the clock moves three ping intervals of the hub with no frame in between (15 s with the default interval): that is its watchdog. `tunnelPingInterval: "1 hour"` puts it three hours away.
- While a registration or a dial is in flight on the test clock, a jump of 10 s fails it (`registrationTimeout`, `tunnelOpenTimeout`). Wait for the lifecycle event before moving the clock.
- Under the test clock a participant that is `offline` is removed once the clock moves 60 s. A test that moves the clock for another reason and needs the participant to stay starts its hub with `layerHub({ reconnectDeadline: "1 hour" })`.

## The SDK

`gambi-sdk` is the published package that embeds Effect code, and none of it may show. Its API is `Promise`, `AsyncIterable` and types written by hand ([ADR-0007](../adr/0007-effect-as-runtime-foundation.md)).

| What | Where |
|---|---|
| The entries of the package and how each is built | `packages/sdk/entries.ts` |
| The `Promise` boundary (`makePromiseBoundary`) | `packages/sdk/src/promise.ts` |
| What an input loses on its way in (`withoutUndefined`) | `packages/sdk/src/input.ts` |
| A hub hosted in the consumer's process (`createHub`), entry `gambi-sdk/hub` | `packages/sdk/src/hub.ts` |
| A participant hosted in the consumer's process, entry `gambi-sdk/participant` | `packages/sdk/src/participant.ts` and the files it exports from |
| What the two participant sessions share (`joinRoom`: join, `leave`, `stop`, `ended`) | `packages/sdk/src/session.ts` |
| The Workspace seam in `Promise`, and its way into the runtime (`workspaceLayer`) | `packages/sdk/src/workspace.ts`, `workspace-layer.ts` |
| The proofs that the public hosting types are the runtime's | `packages/sdk/src/hosting-proofs.ts` |
| The bridge to the management contract (`ManagementPlane`, `translated`, `ContractProofs`) | `packages/sdk/src/contract.ts` |
| The management client (`createClient`, `GambiClient`) | `packages/sdk/src/client.ts` |
| The public types of rooms, participants and events | `packages/sdk/src/types.ts` |
| The one error of the client (`ClientError`, `ClientErrorCode`) | `packages/sdk/src/client-error.ts` |
| The check of the packed package | `packages/sdk/scripts/check-packed-types.ts` |

Rules:

- A public signature names only `Promise`, `AsyncIterable`, `AbortSignal` and types declared in the SDK. Never `Effect`, `Stream`, `Layer`, a `Schema`, or `typeof X.Type`: the declarations are bundled with `effect` left as an import, so any of these would make the published `.d.ts` import a package the consumer does not have.
- A public type that mirrors a schema is an interface written by hand in `types.ts`, with no import, plus one line in `ContractProofs` (`contract.ts`). The line stops compiling when the schema and the type drift apart. A public type of a hosting entry that mirrors a type of the core gets its line in `hosting-proofs.ts`.
- A file that declares a public type exports nothing that names a type of Effect or of `@gambi/*`. The declarations of an entry are bundled from every file its types reach, and each of those files is emitted whole: one internal export there (a `Layer`, a function that takes an `Effect`) fails the build with TS2742 or leaks an import of `effect`. Internal machinery lives in its own file (`session.ts`, `hosting.ts`, `participant-failure.ts`, `workspace-layer.ts`), which a public file imports for its values only.
- Every `Promise` boundary passes its input through `withoutUndefined`: a key that holds `undefined` is a field not given. The contract uses `Schema.optionalKey` and would refuse it, and a consumer's form produces such keys all the time.
- The SDK exports functions, error classes and types. It never exports a schema value or a service.
- Each thing a consumer creates (a client, a hosted hub, a hosted participant) owns one `ManagedRuntime`, through `makePromiseBoundary(layer, what)`. An Effect leaves through `run`, a `Stream` through `iterate`, and `close` releases the layer. Nothing else in the SDK calls `Effect.runPromise`.
- Translate the failure before the boundary: `run` and `iterate` hand the failure to the consumer as it is, so the Effect must already fail with the public error.
- A stream leaves as an `AsyncIterable`, pulled one element at a time. It takes an optional `signal`, ends without an error when the signal aborts or the object is closed, and is interrupted when the consumer leaves the loop.
- The management client rejects only with `ClientError`. Its `code` is a closed union: the codes of the contract, plus `HUB_UNREACHABLE` and `NOT_A_HUB`, which the client finds by itself.
- Each entry has its own error class (`ClientError`, `HubError`, `ParticipantError`), never one class shared by name: an entry embeds its own copy of everything, so the "same" class of two entries would fail `instanceof` across them.
- Nothing crosses from one entry to another but plain JSON and `Promise`s. Each entry is one file with its own copy of `effect`: a `Layer`, an `Effect` or a schema of one entry means nothing to another.
- A hosting entry never logs by itself. The log lines of what it hosts go to the `onLog` of its options, as plain JSON, or nowhere: stdout belongs to the program that hosts.
- A callback of the consumer's (`onLifecycle`, `onArtifact`, `onLog`) is called through `calling` (`hosting.ts`) and never awaited. It may throw, and it may be `async` and reject later; either way nothing hosted fails for it, and the failure of the first two becomes an `ERROR` line for `onLog`. Awaiting it would deadlock a callback that stops its own session.
- A hosting entry is Bun only and says so: its first import is `./bun-only.ts`, which throws in any other runtime before a missing built-in can fail in a stranger way.

To cover another group of the contract in the client:

1. Write the public types of its payloads and answers in `types.ts`, and a line for each in `ContractProofs`.
2. Add each new error class to `hubErrors` in `contract.ts` and its code to `ClientErrorCode`. Until then the new methods do not compile.
3. Add the group to `GambiClient` and implement each method in `createClient` as a `call((management) => management.<group>.<endpoint>(...))`. An endpoint that streams events follows `events.watch`: `boundary.iterate` over the `Effect` of a `Stream`.
4. Use the new methods and types in the consumer file of `check-packed-types.ts`.

To add an entry (`gambi-sdk/<name>`): a line in `entries.ts`, an `exports` entry in `packages/sdk/package.json`, a line in `RUNTIME_EXPORTS` of `check-packed-types.ts`, and a line of `paths` in the `tsconfig.json` of each workspace that imports it (`apps/tui`). Each entry is built on its own, as one file, so importing one never loads another. `runsOn` says what its JavaScript may import: `anywhere` (no built-in module of Node or Bun; the default entry), `node` (Node's built-ins) or `bun`. An entry that hosts something imports `@effect/platform-bun` and is `bun`.

To host something new in the consumer's process, build it on `host` (`hosting.ts`): the layer of the thing, already failing with the entry's public error (`failingWith`), behind one `makePromiseBoundary`. A participant session is built on `joinRoom` (`session.ts`), which adds the lifecycle, `leave`, `stop` and `ended`.

A participant session leaves a room in one of two orders, and the order is part of what it promises. A session that shares a model endpoint tells the hub first and stops its runtime after, so the room hears one event (`participant.removed`). A harness participant session stops its runtime first, because its last artifact goes up through the tunnel that leaving would close, and tells the hub after. A session whose runtime was `replaced` tells the hub nothing: the participant with that id in the room is another runtime. After any other end (`refused`, `tunnelDropped`) the participant in the room is still this one, `offline`, and leaving takes it out.

A runtime that ended by itself holds nothing worth keeping, so the session releases what it hosted (the harness, the Workspace) and only then settles `ended`. While a session leaves, a drop of its tunnel is the hub closing the tunnel of the participant it took out: the runtime is released at its `reconnecting`, before it registers again, and a `tunnelDropped` end is reported as `stopped`. A session that leaves while its runtime is already waiting to come back stops the runtime first and tells the hub after, whatever its order. Both are started from the lifecycle callback and run after it returned (`queueMicrotask`): releasing waits for the fiber the callback runs in.

A Workspace of the consumer's is watched as soon as it is prepared, before the harness starts, like the default one (`workspace-layer.ts`): a change is never missed for having come before the artifacts started to be taken.

The `fake` harness is a subprocess, and the participant entry runs it from its own file (`fake-harness.ts`: `bun -e 'import("<this file>").then(...)'`). That only works when the entry is loaded as the SDK ships it or from its source. Bundled into another program, loading "this file" in a subprocess would run that program again, so the session refuses and asks for `fakeAgentCommand`.

Tests of the SDK call the `Promise` API against a real hub (`layerHub`), inside `it.effect` with `Effect.promise`. Something that is not a hub is a real `Bun.serve` on port `0`. Never replace `fetch`. A harness participant is tested on the `fake` harness, as a real subprocess. `packages/sdk/src/node.test.ts` builds the default entry and runs it in a Node process; `bun run --cwd packages/sdk build && bun run --cwd packages/sdk check:packed-types` checks the package as a consumer installs it: every entry in its runtime, the default entry with the files of the others taken away, and a Bun program that hosts a hub and both kinds of participant.

## The TUI

`apps/tui` is React (OpenTUI) and stays that way ([ADR-0007](../adr/0007-effect-as-runtime-foundation.md)). It reaches Effect code through `Promise` boundaries only.

| What | Where |
|---|---|
| The management client of a hub (`hubClient`) | `apps/tui/src/hub-client.ts` |
| The watched rooms and their reconnection (`watchRooms`, `applyRoomEvent`) | `apps/tui/src/rooms/` |
| The TUI's own participant session (`joinAsParticipant`, `leaveAsParticipant`) | `apps/tui/src/session/participant-session.ts` |
| The hub hosted in the TUI's process (`createHub` of `gambi-sdk/hub`) | `apps/tui/src/store/hub-store.ts` |
| The participant hosted in the TUI's process (`createParticipantSession`, `probeProvider` of `gambi-sdk/participant`) | `apps/tui/src/session/participant-session.ts`, `apps/tui/src/hooks/queries/use-endpoint-test-query.ts` |

Rules:

- The TUI reaches a hub through `createClient` of `gambi-sdk` and nothing else. It has no `fetch` to a hub, no SSE parser and no schema of a hub answer; its types of rooms, participants and events are the ones `gambi-sdk` exports.
- `gambi-sdk` is imported from its source, through `paths` in `apps/tui/tsconfig.json`, one line per entry: the package's `exports` point at `dist/`, which only exists after a build. The TUI's own build embeds it.
- The TUI hosts its hub and its participant through `gambi-sdk/hub` and `gambi-sdk/participant`. No file of the TUI but its tests imports `effect`, `@effect/platform-bun` or `@gambi/core`.
- A hosted hub or session gets no `onLog`: a log line on the terminal would be drawn over the screen.
- Logic lives in plain modules (`watchRooms`, the session, the stores); a hook only subscribes to one. The tests run those modules against a real hub (`layerHub`), inside `it.effect` with `Effect.promise`, and wait for what a store or a watcher shows. Never replace `fetch`.
- A room whose event stream ends is watched again, whether the stream failed or just ended. The `room.snapshot` of the next stream realigns it.
- A runtime that ended by itself (`left`) is released with `stop`, without telling the hub: after `replaced`, the participant with that id in the room is another runtime.

## The CLI

The new CLI lives in `packages/cli/src/cli/`, beside the current one, on `effect/cli`. `main.ts` is its entrypoint and the only file that imports `@effect/platform-bun`; lint rejects it anywhere else outside the tests.

A command:

- lives in `commands/<group>.ts`, under the group of its resource, and the group is one line in `root.ts`. No flat aliases ([ADR-0002](../adr/0002-agent-first-management-surface.md)).
- writes only through `Output`: `result` for a one-shot command, `event` for each step of a long-running one. Never `Console` or `process.stdout`: `Output` decides between text for a person and JSON for a program, and keeps stdout for data.
- fails with a typed error and renders nothing itself. `run.ts` shows the error on stderr and maps it to an exit code.
- reaches a hub with `withHub(hubUrl, (client) => ...)` and the shared `hubFlag`. It turns a transport failure into `HubUnreachable` and an answer outside the contract into `NotAHub`.
- asks for a missing required flag with `Flag.withFallbackPrompt`. The prompt only runs on a terminal; without one the flag is reported as missing.
- when it runs until stopped, awaits `Termination.signal` and then returns, so that a deliberate stop exits with `0`.
- reaches the outside through a service, never through a global: the network through `HttpClient`, a subprocess through `ChildProcessSpawner`, a file through `FileSystem`, and what the running process is (`execPath`, `argv`, `platform`, `pid`) through `Installation`. `main.ts` provides the real ones.

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
- A command in a test reaches this machine only. `fetch` refuses any host but loopback, so serve what the command downloads from a `Bun.serve` on `127.0.0.1`.
- A command in a test starts no process unless the test says so. `options.spawner: spawnerThat((command) => ({ exitCode, stdout, stderr }))` plays the subprocess and shows the test the command line; without it, spawning fails the test.
- `options.installation` says what the running `gambi` is (`execPath`, `argv`, `platform`, `arch`, `pid`). The default is an installation of unknown origin.
- `startCommand(args)` starts a long-running command: read its events with `nextEvent`, send `signal("SIGTERM")`, then await `result`.
- Assert on stdout, stderr and the exit code. Do not call a handler or `Output` directly.
- What only the real process shows (the two file descriptors, the exit code of the process, signals) is covered by `main.test.ts`, which spawns the entrypoint.

