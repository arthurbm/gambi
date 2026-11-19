# Gambi Architecture

This document explains the conceptual architecture of Gambi 0.8. For exact endpoints, error codes, event payloads, tunnel calls, and runtime constants, see [`docs/reference/contracts.md`](./contracts.md). For the Effect patterns the code follows, see [`docs/reference/effect-conventions.md`](./effect-conventions.md).

## Overview

Gambi is a local-first hub for sharing OpenAI-compatible LLM endpoints across a trusted network. It has two explicit planes:

- **Management plane** (`/v1/*`): Gambi-native operations for rooms, participants, room events, and the harness attach. Defined once as a typed contract.
- **Inference plane** (`/rooms/:code/v1/*`): OpenAI-compatible room-scoped endpoints for responses, chat completions, and model listing. Plain routes that pass a provider's answer through.

Participants reach the hub through a tunnel they open themselves. The public inference surface stays HTTP, and the hub forwards each request into the participant's tunnel, so the participant's provider never has to be reachable from the hub.

```
┌─────────────────────────────────────────────────────────────────────┐
│                            GAMBI HUB                                │
│                                                                     │
│   Management plane (/v1/*)        Inference plane (/rooms/.../v1)   │
│   contract: rooms · participants  OpenAI-compatible (Responses,     │
│   events · harness attach         Chat Completions, models)         │
│                                                                     │
│                     tunnels (effect/rpc over WebSocket)             │
└─────────────────────────────────────────────────────────────────────┘
       ▲                     ▲                    ▲             ▲
       │ management          │ inference          │ live ops    │ tunnel (dialed
       │                     │                    │             │ by participant)
 ┌────────────┐     ┌───────────────┐      ┌────────────┐  ┌──────────────────┐
 │ CLI + SDK  │     │ createGambi() │      │ gambi-tui  │  │ participant      │
 │ client     │     │ OpenAI SDKs   │      │            │  │ runtime          │
 └────────────┘     └───────────────┘      └────────────┘  └──────────────────┘
```

## Foundation

Since 0.8 the core and the CLI are written on Effect v4 (ADR-0007):

- Schemas are `effect/Schema`. There is no zod in the core or the SDK.
- The management plane is an `HttpApi` contract in `@gambi/protocol`. The hub implements it; the SDK client, the CLI, and the TUI call the client derived from it; the OpenAPI document is generated from it. Changing an operation in the contract makes the compiler point at every handler and caller that no longer fits.
- The tunnel is `effect/rpc` over a WebSocket, with typed calls, cancellation, timeouts, and ping built in.
- Resources (the port, the mDNS announcement, timers, sockets, subprocesses) are acquired in a scope and released when it closes. A hub that fails to start leaves nothing behind.
- State lives in services, never in module variables, so two hubs in one process (a test, the TUI) never see each other's rooms.
- `@effect/platform-bun` enters only at the entrypoints (the CLI's `main.ts`, the SDK's hosting entries, tests). The core depends on the abstract services, and a lint rule keeps `Bun.*`, `bun:*`, and `@effect/platform-*` out of it.
- The public `gambi-sdk` API stays in `Promise`, with no Effect types in its signatures. The TUI stays in React.

Because the tunnel's wire format is the one of `effect/rpc` and has no version field, a hub and its participants must run the same minor version of Gambi. Registration carries the participant's version, and the hub refuses another minor with `VERSION_MISMATCH`.

## Component roles

### `packages/protocol`

`@gambi/protocol`: the schemas, the management plane contract, the tunnel calls, the typed errors, and the status transition function. It has no server and no platform dependency, and runs unchanged in Bun, Node, and a browser. It is not published; it is bundled into what is.

- `src/management/api.ts`: the `ManagementApi` contract
- `src/management/errors.ts`, `src/tunnel/errors.ts`, `src/inference/errors.ts`: typed errors, each with its code and HTTP status
- `src/management/envelope.ts`: the success and error envelopes
- `src/management/event-stream.ts`: SSE in the contract; the only SSE parser in the repository
- `src/room-event.ts`, `src/harness.ts`: room events and harness attach events
- `src/participant-status.ts`: `transitionStatus`, the status table
- `src/tunnel/rpcs.ts`: `TunnelRpcs`, the tunnel calls
- `src/version.ts`: `GAMBI_VERSION` and the minor-version rule

### `packages/core`

The hub, the participant runtime, and the harness. Not published; bundled into the CLI and the SDK.

- `src/hub/`: the hub. `hub.ts` (`Hub.layer`: port, mDNS, and the order resources are released in), `management.ts` (contract handlers, request id, `ROUTE_NOT_FOUND`), `inference.ts` (the inference plane), `participants.ts` (state, routing, the reconnection deadline), `tunnels.ts` (bootstrap tokens and open tunnels), `room-events.ts`, `harness-clients.ts` and `harness-attach.ts` (the attach fan-out), `stored-responses.ts`, `responses-translation.ts`
- `src/participant/`: the participant runtime. `runtime.ts` (join, reconnection, watchdog, lifecycle events), `inference.ts` (the `Infer` handler that calls the local provider with the `ParticipantAuthHeaders`), `endpoint-capabilities.ts` (the provider probe)
- `src/harness/`: the harness participant. `harness.ts` (subprocess and ACP relay), `acp.ts` (the three typed ACP calls), `detection.ts` (adapters and readiness checks), `workspace.ts` and `artifacts.ts` (the `Workspace` seam and snapshots)
- `src/testing/`: hub, participant, provider, and network helpers for tests (`@gambi/core/testing/*`)

### `packages/cli`

The `gambi` binary, written on `effect/cli`. Workspace is `private`; the published `gambi` wrapper and the `gambi-<os>-<arch>` binaries are generated under `packages/cli/dist`. Its source is `packages/cli/src/cli/`: `main.ts` is the only file that touches the platform (Bun layers, signals, process exit code), and `run.ts` holds `runCli`, the CLI as a function that the command tests call.

The CLI is resource-oriented:

- `gambi hub serve`
- `gambi room create|list|get`
- `gambi participant join|leave`
- `gambi events watch`
- `gambi self update`

It is a renderer over the management plane: text on a terminal, JSON or NDJSON otherwise, typed errors on stderr, and exit codes from one table (`exit-codes.ts`).

### `packages/sdk`

`gambi-sdk`, published, in four entries. Each entry is one file with its own copy of `effect`, so importing one never loads another:

- `gambi-sdk`: `createGambi()` (the inference provider for the AI SDK) and `createClient()` (the management client, including the harness attach). Runs in Node and Bun.
- `gambi-sdk/discovery`: `discoverHubs()`, `discoverRooms()`, `resolveGambiTarget()`. Explicit; never invoked inside `createGambi()` or `createClient()`.
- `gambi-sdk/hub`: `createHub()`, a hub in the current process. Bun only.
- `gambi-sdk/participant`: `createParticipantSession()`, `createHarnessParticipantSession()`, the `Workspace` seam, the fake harness, and the provider probe. Bun only.

Every function returns a `Promise` and rejects with one error class per entry (`ClientError`, `HubError`, `ParticipantError`). The SDK exports types, not schema values.

### `apps/tui`

Human-first monitoring interface (OpenTUI + React). It reads the management plane through the SDK client, and hosts a hub and a participant in its own process through `gambi-sdk/hub` and `gambi-sdk/participant`. Published as `gambi-tui` on npm.

### `packages/testing`

`@gambi/testing/effect`: the Effect test helper over `bun test`. It mirrors the API of `@effect/vitest` (`it.effect` with the test clock, `it.live` for a real socket or subprocess, `layer` for a shared layer).

### Experiences above the hub

Orchestration and the event board from 2026-08-23 live in
[`arthurbm/gambiarra-lab`](https://github.com/arthurbm/gambiarra-lab), a
separate repository of club experiments. They consume `gambi` and `gambi-sdk`
like any external client. Nothing in this repository imports from there
(ADR-0006, revision 2026-10-24).

## Participant lifecycle

Registration is an idempotent upsert, `PUT /v1/rooms/:code/participants/:id`. The first registration creates the participant, `offline`; a later one with the same id updates its profile and keeps its status. The response carries a single-use bootstrap token, and the runtime dials the tunnel with it. Each runtime creates a public `runtimeId` and sends it on every registration. A runtime takes ownership when it registers an offline participant or opens a tunnel for that participant. Registering while another tunnel is open only updates the profile.

A participant has one **status**, derived from its tunnel alone:

| From | Event | To |
|---|---|---|
| (not in the room) | registration | `offline` |
| `offline` | tunnel opens | `online` |
| `online` | the hub dispatches a request | `busy` |
| `busy` | the request ends, is cancelled, or times out | `online` |
| `online`, `busy` | tunnel drops | `offline` |
| `offline` | 60 s without coming back | removed |
| any | the participant leaves | removed |

Every transition goes through one pure function, `transitionStatus`, and emits the matching room event (`participant.joined`, `participant.online`, `participant.busy`, `participant.offline`, `participant.removed`). Only `online` participants receive routes. There is no heartbeat and no separate connection state.

The participant runtime joins once: register, open the tunnel, wait for the hub's `Welcome`. After that it reconnects by itself when the tunnel drops, waiting 1 second and doubling up to 30, with the same `participantId`, so whoever routes to it by id keeps the target. If it stays away for 60 seconds the hub removes it, and the next registration brings it back as a new participant with the same id. The hub pings every tunnel; the runtime watches what it receives and drops a tunnel whose hub went silent, which catches a frozen hub process. A refusal on the way back (`ROOM_NOT_FOUND`, `INVALID_PASSWORD`, `VERSION_MISMATCH`, `INVALID_REQUEST`) ends the runtime.

A host that leaves names its own `runtimeId`. The hub checks ownership before removing the participant. The removed runtime receives WebSocket close code `4002` and stops reconnecting. A runtime between retries can miss the close and register again.

Rooms live in the hub's memory. A hub that restarts comes back without its rooms, and runtimes trying to come back end with `ROOM_NOT_FOUND`. Recovering from that is issue #132.

In harness mode, the runtime starts the harness as a child process in a process group of its own, negotiates ACP v1, opens a first harness session in the participant's Workspace, and watches the Workspace for artifacts. The hub sees ACP messages and artifact contents, never the harness login or provider credentials.

## Tunnel transport

The tunnel is the only hub↔participant transport. It is `effect/rpc` over a WebSocket with the roles inverted: the participant dials and serves the calls; the hub accepts and calls. Properties:

- the participant may keep its provider on `localhost`
- provider auth headers stay in the participant runtime and are never uploaded to the hub
- an inference request is one `Infer` stream call; interrupting it (the app went away, the idle timeout passed) aborts the request to the provider and frees the participant
- what is born on a harness participant (ACP messages, session status, artifacts) goes up as chunks of one long-lived `HarnessEvents` call the hub opens with the tunnel
- the public client-facing API remains HTTP + SSE; the tunnel is internal
- management clients attach to a harness participant over SSE and plain requests to the hub; the hub relays into the existing participant tunnel and never connects back to the participant

The hub closes every open tunnel before it stops its HTTP server, so Ctrl+C on the hub returns in well under a second.

For the rationale behind the inverted connection direction, see [ADR-0003](../adr/0003-tunnel-first-transport.md); for the move to `effect/rpc`, [ADR-0007](../adr/0007-effect-as-runtime-foundation.md). For the call catalog, see [`docs/reference/contracts.md`](./contracts.md#tunnel-calls).

## Model routing

Routing happens on the `model` field at request time. There are four forms of model selector:

- `*` or `any`: any `online` participant, at random
- `model:<name>`: the first `online` participant sharing that model
- `<participantId>`: that participant
- `<name>` that is no `online` participant's id: the same as `model:<name>`, which is what a plain OpenAI client sends

Naming a participant that is `busy` or `offline` returns an explicit error. Harness participants are visible through management but never picked by `*`, `any`, or a model name; naming one by id is refused.

## Discovery

Discovery is useful for local-network applications. The `gambi-sdk/discovery` helpers find hubs over mDNS and resolve rooms against the management plane under `/v1`. Discovery is always explicit: `createGambi()` and `createClient()` do not perform it.

## Operational surfaces

### CLI

Text on a terminal; JSON or NDJSON otherwise. Flag-first and pipe-friendly. On a terminal a missing required flag becomes a prompt; `--no-interactive` or `GAMBI_NO_INTERACTIVE=1` turns prompts off. Long-running commands (`hub serve`, `participant join`) report each step as a JSON line, and every failure is a typed error with a stable exit code.

### SDK management client

`createClient()` exposes the contract in `Promise`:

- `client.hub.health()`
- `client.rooms.*`
- `client.participants.*`
- `client.events.watch()`
- `client.harness.attach()`, `send()`, `openSession()`, `closeSession()`

`client.harness.attach()` is an async iterable of the participant's ACP messages, session status, and artifacts. Orchestration policy (retries, deadlines per prompt, review) belongs to the consumer; the hub stays a relay.

### TUI

Optimized for human monitoring. It is not the canonical operational contract: automation should target the management plane (`/v1`) directly, through the CLI or the SDK.

## Observability

The hub writes structured log lines through Effect's logger, annotated with the room, the participant, and the request id, and names its operations as spans (`Hub.listModels`, `Participants.dispatch`, ...). No trace exporter is wired. The room event stream carries the `llm.*` events with hub-observed metrics; see [`docs/reference/observability.md`](./observability.md).

## Repository map

- `packages/protocol`: contract, schemas, tunnel calls, typed errors (internal)
- `packages/core`: hub, participant runtime, harness (internal)
- `packages/testing`: Effect test helper for `bun test` (internal)
- `packages/cli`: the `gambi` CLI
- `packages/sdk`: `gambi-sdk`
- `apps/tui`: monitoring interface
- `apps/docs`: documentation site (Astro Starlight)
- `packages/config`: shared TypeScript configs

## Security model

Gambi is designed for trusted local networks. The hub has no native authentication. Do not expose it publicly without an external auth and proxy layer. Provider auth headers (`ParticipantAuthHeaders`) never leave the participant runtime: registration refuses them, and the runtime applies them only when it calls its local provider. A harness session runs inside the participant's Workspace, and the tunnel has no call that writes files on the participant's machine.

## Forward path

The hub stays narrow: transport, routing, and operability. Coordination lives
above those contracts, outside this repository, in `gambiarra-lab`.

Related internal docs:

- [`docs/reference/contracts.md`](./contracts.md): exact contract reference
- [`docs/reference/effect-conventions.md`](./effect-conventions.md): how the code uses Effect
- [`docs/reference/observability.md`](./observability.md): metrics and event detail
- [`docs/reference/release-architecture.md`](./release-architecture.md): distribution and publishing
- [`docs/reference/versioning.md`](./versioning.md): versioning policy
