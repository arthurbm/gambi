# Gambi Architecture

This document explains the conceptual architecture of Gambi after the agent-first redesign of the operational surface. For exact endpoints, error codes, event payloads, tunnel messages, and runtime constants, see [`docs/contracts.md`](./contracts.md).

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
- participant tunnel runtime (canonical `createParticipantSession()`)
- SSE room events
- mDNS discovery support
- shared transport and domain schemas (Zod)

Important files:

- `packages/core/src/hub.ts` — HTTP server, tunnel upgrade, routing
- `packages/core/src/room.ts` — room and participant state
- `packages/core/src/participant-session.ts` — participant runtime
- `packages/core/src/tunnel-protocol.ts` — tunnel messages
- `packages/core/src/types.ts` — public Zod schemas and runtime constants

### `packages/cli`

Operational CLI for both humans and agents. Workspace is `private`; the published `gambi` wrapper and `gambi-<os>-<arch>` binaries are generated under `packages/cli/dist`.

The CLI is resource-oriented:

- `gambi hub serve`
- `gambi room create|list|get`
- `gambi participant join|leave|heartbeat`
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

## Participant lifecycle

Participant registration is an idempotent upsert:

- `PUT /v1/rooms/:code/participants/:id`

Behavior:

- create on first registration
- return a stable `200` or `201` path for retries
- update the existing participant when the payload changes

The registration response also returns the tunnel bootstrap data (`participant`, `roomId`, `tunnel`). The participant then opens the bootstrap WebSocket route, after which the hub dispatches inference into the tunnel.

This idempotent shape is the foundation for retry-safe automation and the CLI's `participant join --participant-id`.

## Heartbeats and liveness

Two independent liveness signals run in parallel:

- **Management heartbeat** — `POST /v1/rooms/:code/participants/:id/heartbeat`. Drives the offline timeout.
- **Tunnel ping/pong** — drives `participant.connection.connected`.

`status` and `connection.connected` are orthogonal. A participant can be registered and heartbeating but have no active tunnel; routing requires *both* an online status and a connected tunnel.

For exact constants and payload shapes, see `docs/contracts.md`.

## Tunnel transport

The participant tunnel exists to remove the requirement that participant endpoints be published on the network.

Transport properties:

- the participant may keep its provider on `localhost`
- provider auth headers stay local to the participant runtime — they are never uploaded to the hub
- the hub forwards inference operations across a WebSocket tunnel
- the public client-facing API remains HTTP + SSE

This split is intentional:

- HTTP remains the compatibility surface for applications
- WebSocket is used only for the hub-to-participant control path
- participant count does not change the app-facing protocol

For the tunnel message catalog, see `docs/contracts.md`.

## Model routing

Routing happens on the `model` field at request time:

- `<participant-id>` routes to a specific participant
- `model:<name>` routes to the first available participant matching that model
- `*` or `any` routes to a random available participant

Specific participant targeting returns explicit errors when the participant is busy or its tunnel is disconnected. Routing only considers participants whose tunnel is connected, whose status is not offline, and which are not already handling another request.

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

### TUI

Optimized for human monitoring. It is not the canonical operational contract — automation should target the management plane (`/v1`) directly via CLI or SDK.

## Repository map

- `packages/core` — hub runtime and contracts
- `packages/cli` — operational CLI source
- `packages/sdk` — inference provider and management client
- `apps/tui` — monitoring interface
- `apps/docs` — documentation site (Astro Starlight)
- `packages/config` — shared TypeScript configs

## Security model

Gambi is designed for trusted local networks. The hub does not include native authentication. Do not expose it publicly without an external auth and proxy layer. Provider auth headers (`ParticipantAuthHeaders`) never leave the participant runtime — they are applied only when the runtime calls its local provider, never transmitted to the hub or surfaced through the management API.

## Forward path

The current architecture is meant to stay narrow: transport, routing, and operability.

Related internal docs:

- [`docs/contracts.md`](./contracts.md) — exact contract reference
- [`docs/observability.md`](./observability.md) — metrics and event detail
- [`docs/release-architecture.md`](./release-architecture.md) — distribution and publishing
- [`docs/versioning.md`](./versioning.md) — versioning policy
