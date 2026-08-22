# Gambi Architecture

This document explains the conceptual architecture of Gambi after the agent-first redesign of the operational surface. For exact endpoints, error codes, event payloads, tunnel messages, and runtime constants, see [`docs/reference/contracts.md`](./contracts.md).

## Overview

Gambi is a local-first hub for sharing OpenAI-compatible LLM endpoints across a trusted network. It has two explicit planes:

- **Management plane** (`/v1/*`): Gambi-native operations for rooms, participants, heartbeats, and room events.
- **Inference plane** (`/rooms/:code/v1/*`): OpenAI-compatible room-scoped endpoints for responses, chat completions, and model listing.

Participants connect to the hub through a participant tunnel. The public inference surface remains HTTP, but hub-to-participant forwarding is tunnel-backed instead of requiring the participant endpoint to be directly reachable from the hub.

```
┌─────────────────────────────────────────────────────────────────────┐
│                            GAMBI HUB                                │
│                                                                     │
│   Management plane (/v1/*)        Inference plane (/rooms/.../v1)   │
│   rooms · participants · events   OpenAI-compatible (Responses,     │
│                                    Chat Completions, models)        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
             ▲                      ▲                      ▲
             │ management           │ inference            │ live ops
             │                      │                      │
      ┌─────────────┐        ┌───────────────┐      ┌─────────────┐
      │ CLI + SDK   │        │ createGambi() │      │ gambi-tui   │
      └─────────────┘        └───────────────┘      └─────────────┘
```

## Design goals

The redesign intentionally separates the operational and application contracts.

### Management plane goals

- predictable machine-readable responses
- deterministic error envelopes
- retry-safe participant registration
- typed event streams
- stateless operational control

### Inference plane goals

- OpenAI-compatible transport
- compatibility with AI SDK and similar clients
- room-scoped model routing
- Responses-first semantics with explicit Chat Completions compatibility

## Component roles

### `packages/core`

Source of truth for the hub runtime and HTTP contracts.

Key responsibilities:

- room and participant registry
- management HTTP handlers
- inference proxying
- model and harness participant tunnel runtimes
- SSE room events
- mDNS discovery support
- shared transport and domain schemas (Zod)

Important files:

- `packages/core/src/hub.ts` — HTTP server, tunnel upgrade, routing
- `packages/core/src/room.ts` — room and participant state
- `packages/core/src/participant-session.ts` — participant runtime
- `packages/core/src/harness-participant-session.ts` — ACP process, workspace watcher, and artifact runtime
- `packages/core/src/harness-adapters.ts` — local harness command and readiness checks
- `packages/core/src/harness-workspace.ts` — city tile starter and workspace metadata
- `packages/core/src/tunnel-protocol.ts` — tunnel messages
- `packages/core/src/types.ts` — public Zod schemas and runtime constants

### `packages/cli`

Operational CLI for both humans and agents. Workspace is `private`; the published `gambi` wrapper and `gambi-<os>-<arch>` binaries are generated under `packages/cli/dist`.

The CLI is resource-oriented:

- `gambi hub serve`
- `gambi room create|list|get`
- `gambi participant join|leave|heartbeat`
- `gambi participant join` as the canonical resource-oriented participant command
- `gambi events watch`
- `gambi self update`

The CLI is a renderer over the management plane. Human mode uses compact text. Script mode uses JSON or NDJSON.

### `packages/sdk`

Split by audience:

- `createGambi()` — inference through the OpenAI-compatible room endpoints
- `createClient()` — operational control over rooms, participants, and room events
- `createParticipantSession()` — participant runtime with tunnel (re-exported from `packages/core`)
- discovery helpers (`discoverHubs`, `discoverRooms`, `resolveGambiTarget`) — explicit; never invoked implicitly inside `createGambi()` or `createClient()`

The management client maps directly to `/v1` instead of inventing a parallel contract.

### `apps/tui`

Human-first monitoring interface (OpenTUI + React). It consumes the management plane and the room event stream, but remains a separate package from `gambi`. Published as `gambi-tui` on npm.

### `packages/agents` and the event board

`@gambi/agents` adds typed coordination above the SDK attach channel. It owns
decisions, dispatches, reviews, returns, model handoff, and the rule that only a
selected human steerer may resolve judgment calls. It does not add behavior to
the hub.

`apps/board` persists the event workflow, tile versions, claims, steerers, and
an append-only audit log in SQLite. `apps/board-web` is its local-network UI.
The board attaches to participant-opened harness tunnels through the SDK and
starts hosted harness sessions from its saved configuration. Restarting the
board keeps the hub and participant connections alive. The hosted supervisor
recreates its sessions and reconciles them by stable participant ID.

## Participant lifecycle

Participant registration is an idempotent upsert:

- `PUT /v1/rooms/:code/participants/:id`

Behavior:

- create on first registration
- return a stable `200` or `201` path for retries
- update the existing participant when the payload changes

The registration response also returns the tunnel bootstrap data (`participant`, `roomId`, `tunnel`). Model participants include an `endpoint`; harness participants instead include `harness` metadata and may omit it. The participant then opens the bootstrap WebSocket route.

In harness mode, the participant runtime creates a local workspace and starts an ACP process there. It negotiates only ACP v1. A one-second watcher publishes versioned workspace snapshots through the participant-opened tunnel. The hub sees ACP envelopes and artifact bytes, but it never sees the harness login or provider credentials.

This idempotent shape is the foundation for retry-safe automation and the CLI's `participant join --participant-id`.

## Heartbeats and liveness

Two independent liveness signals run in parallel:

- **Management heartbeat** — `POST /v1/rooms/:code/participants/:id/heartbeat`. Drives the offline timeout.
- **Tunnel ping/pong** — drives `participant.connection.connected`.

`status` and `connection.connected` are orthogonal. A participant can be registered and heartbeating but have no active tunnel; routing requires *both* an online status and a connected tunnel.

For exact constants and payload shapes, see `docs/reference/contracts.md`.

## Tunnel transport

The participant tunnel is the canonical (and only) hub↔participant transport. Properties:

- the participant may keep its provider on `localhost`
- provider auth headers stay local to the participant runtime — they are never uploaded to the hub
- the hub dispatches inference operations across a WebSocket tunnel opened by the participant
- the public client-facing API remains HTTP + SSE; tunnel is internal control path
- harness participants carry opaque ACP v1 frames and artifacts over that same participant-opened tunnel
- management clients initiate a separate attach WebSocket to the hub; the hub relays between it and the existing participant tunnel, and never connects back to the participant

For the rationale and rejected alternatives behind this inversion of connection direction, see [`docs/adr/0003-tunnel-first-transport.md`](../adr/0003-tunnel-first-transport.md). For the tunnel message catalog, see [`docs/reference/contracts.md`](./contracts.md).

## Model routing

Routing happens on the `model` field at request time:

- `<participant-id>` routes to a specific participant
- `model:<name>` routes to the first available participant matching that model
- `*` or `any` routes to a random available participant

Specific participant targeting returns explicit errors when the participant is busy or its tunnel is disconnected. Routing only considers model participants whose tunnel is connected, whose status is not offline, and which are not already handling another request. Harness participants are visible through management but never selected by inference routing.

## Discovery

Discovery is useful for local-network applications. The SDK helpers resolve hubs and rooms against the management plane under `/v1`. Discovery is always explicit — `createGambi()` and `createClient()` do not perform implicit discovery.

## Operational surfaces

### CLI

Optimized for human-readable text and machine-readable JSON / NDJSON. Flag-first, pipe-friendly, with `--interactive` / `--no-interactive`, XDG config support, and NDJSON on streaming commands when stdout is piped.

### SDK management client

Optimized for code-driven operational workflows. Namespaces:

- `client.rooms.*`
- `client.participants.*`
- `client.events.watchRoom()`
- `client.harness.attach()`

`@gambi/agents` supplies `TunnelHarnessTransport` above this SDK channel. It
opens an ACP harness session, turns ACP updates, status, and versioned artifact
frames into UI-independent `HarnessEvent` values, and republishes them through
the orchestrator as ordered `harness.event` domain events. A prompt is complete
only when its ACP JSON-RPC response arrives. A channel close or response timeout
is an explicit recoverable error; the orchestrator drops the cached harness
session so a retried dispatch opens a new session after reconnection. The hub
remains a relay and does not take part in that recovery policy.

Control operations and prompt turns use separate deadlines. Session open and
close keep a 10-second default. A full ACP prompt turn gets five minutes by
default because its response marks completion, not receipt. Both deadlines are
transport options so deterministic tests and event applications can choose
smaller or larger bounds without changing the hub protocol.

### TUI

Optimized for human monitoring. It is not the canonical operational contract — automation should target the management plane (`/v1`) directly via CLI or SDK.

### Event supervisor

`scripts/event.ts` owns the live event processes. `bun run event` starts the
hub, creates one room, chooses a room-specific SQLite file, then starts the
board and web UI. `bun run board:e2e` swaps hosted OpenCode for the deterministic
fake ACP adapter, uses a temporary database, and adds two ordinary fixture
model participants to the inference plane. `SIGUSR1` restarts only the board.
Ctrl+C stops children in reverse order so hosted ACP processes exit before the
hub.

## Repository map

- `packages/core` — hub runtime and contracts
- `packages/cli` — operational CLI source
- `packages/sdk` — inference provider and management client
- `packages/agents`: UI-independent coordination rules and harness transports
- `apps/board`: SQLite-backed event server and hosted harness supervisor
- `apps/board-web`: local-network event UI and city projector
- `apps/tui` — monitoring interface
- `apps/docs` — documentation site (Astro Starlight)
- `packages/config` — shared TypeScript configs

## Security model

Gambi is designed for trusted local networks. The hub does not include native authentication. Do not expose it publicly without an external auth and proxy layer. Provider auth headers (`ParticipantAuthHeaders`) never leave the participant runtime — they are applied only when the runtime calls its local provider, never transmitted to the hub or surfaced through the management API.

## Forward path

The hub stays narrow: transport, routing, and operability. Coordination lives
in the optional agents package and board app above those contracts.

Related internal docs:

- [`docs/reference/contracts.md`](./contracts.md) — exact contract reference
- [`docs/reference/observability.md`](./observability.md) — metrics and event detail
- [`docs/reference/release-architecture.md`](./release-architecture.md) — distribution and publishing
- [`docs/reference/versioning.md`](./versioning.md) — versioning policy
