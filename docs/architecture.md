# Gambi Architecture

This document explains the current architecture of Gambi after the agent-first redesign of the operational surface.

## Overview

Gambi is a local-first hub for sharing OpenAI-compatible LLM endpoints across a trusted network. It has two explicit planes:

- Management plane: Gambi-native operations for rooms, participants, heartbeats, and room events.
- Inference plane: OpenAI-compatible room-scoped endpoints for responses, chat completions, and model listing.

```
┌─────────────────────────────────────────────────────────────────────┐
│                           GAMBI HUB                                │
│                                                                     │
│  Management plane (`/v1`)                                          │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ GET    /v1/health                                            │  │
│  │ GET    /v1/rooms                                             │  │
│  │ POST   /v1/rooms                                             │  │
│  │ GET    /v1/rooms/:code                                       │  │
│  │ GET    /v1/rooms/:code/participants                          │  │
│  │ PUT    /v1/rooms/:code/participants/:id                      │  │
│  │ DELETE /v1/rooms/:code/participants/:id                      │  │
│  │ POST   /v1/rooms/:code/participants/:id/heartbeat            │  │
│  │ GET    /v1/rooms/:code/events                                │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Inference plane (`/rooms/:code/v1/*`)                             │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ GET    /rooms/:code/v1/models                                 │  │
│  │ POST   /rooms/:code/v1/responses                              │  │
│  │ GET    /rooms/:code/v1/responses/:id                          │  │
│  │ DELETE /rooms/:code/v1/responses/:id                          │  │
│  │ POST   /rooms/:code/v1/responses/:id/cancel                   │  │
│  │ GET    /rooms/:code/v1/responses/:id/input_items              │  │
│  │ POST   /rooms/:code/v1/chat/completions                       │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
             ▲                      ▲                      ▲
             │                      │                      │
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

## Component roles

### `packages/core`

Source of truth for the hub runtime and HTTP contracts.

Key responsibilities:

- room and participant registry
- management HTTP handlers
- inference proxying
- SSE room events
- mDNS discovery support
- shared transport and domain schemas

Important files:

- `packages/core/src/hub.ts`
- `packages/core/src/room.ts`
- `packages/core/src/participant.ts`
- `packages/core/src/sse.ts`
- `packages/core/src/types.ts`

### `packages/cli`

Operational CLI for both humans and agents.

The CLI is resource-oriented:

- `gambi hub serve`
- `gambi room create|list|get`
- `gambi participant join|leave|heartbeat`
- `gambi events watch`
- `gambi self update`

The CLI is a renderer over the management plane. Human mode uses compact text. Script mode uses JSON or NDJSON.

### `packages/sdk`

Split by audience:

- `createGambi()` for inference through the OpenAI-compatible room endpoints
- `createClient()` for operational control over rooms, participants, and room events

The management client maps directly to `/v1` instead of inventing a parallel contract.

### `apps/tui`

Human-first monitoring interface. It consumes the management plane and room event stream, but remains a separate package from `gambi`.

## Management plane

### Envelope contract

Every management response is structured:

```json
{
  "data": {},
  "meta": {
    "requestId": "req_123"
  }
}
```

Errors are also structured:

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Participant identifier is required.",
    "hint": "Pass --participant-id or provide it in the request path."
  },
  "meta": {
    "requestId": "req_456"
  }
}
```

`meta.requestId` is part of the public contract and should be preserved by CLI and SDK callers.

### Room lifecycle

- Room creation is intentionally non-idempotent.
- `GET /v1/rooms/:code` exists so clients do not need to list and filter locally.
- Public room summaries include:
  - `id`
  - `code`
  - `name`
  - `hostId`
  - `createdAt`
  - `participantCount`
  - `passwordProtected`
  - `defaults`

### Participant lifecycle

Participant registration uses idempotent upsert semantics:

- `PUT /v1/rooms/:code/participants/:id`

Behavior:

- create on first registration
- return a stable `200` or `201` path for retries
- update the existing participant when the payload changes

This is the foundation for retry-safe automation and the CLI’s `participant join --participant-id`.

### Heartbeats and liveness

Participants stay online by sending:

- `POST /v1/rooms/:code/participants/:id/heartbeat`

Constants:

- `HEALTH_CHECK_INTERVAL = 10_000`
- `PARTICIPANT_TIMEOUT = 30_000`

The hub marks inactive participants offline when the timeout window is exceeded.

## Event model

Room events are emitted as SSE with typed JSON payloads.

Each event object contains:

- `type`
- `timestamp`
- `roomCode`
- `data`

Current event types:

- `connected`
- `room.created`
- `participant.joined`
- `participant.updated`
- `participant.left`
- `participant.offline`
- `llm.request`
- `llm.error`

The CLI converts these directly into NDJSON for `gambi events watch --format ndjson`. The SDK exposes the same shape through `client.events.watchRoom()`.

## Inference plane

The inference plane remains OpenAI-compatible and room-scoped:

- `GET /rooms/:code/v1/models`
- `POST /rooms/:code/v1/responses`
- `GET /rooms/:code/v1/responses/:id`
- `DELETE /rooms/:code/v1/responses/:id`
- `POST /rooms/:code/v1/responses/:id/cancel`
- `GET /rooms/:code/v1/responses/:id/input_items`
- `POST /rooms/:code/v1/chat/completions`

Model routing rules:

- `model = <participant-id>` routes to a specific participant
- `model = model:<name>` routes to the first online participant matching that model
- `model = *` or `any` routes to a random online participant

The hub still prefers the Responses API first and keeps chat completions available explicitly.

## Runtime defaults

Rooms and participants can both contribute runtime defaults. At proxy time, the hub merges them in this order:

1. room defaults
2. participant defaults
3. request-time overrides

Sensitive config is not exposed raw in public management responses. Public responses expose redacted or summarized values where needed.

## Discovery

Discovery remains useful for local-network applications. The SDK discovery helpers now resolve hubs and rooms against the management plane under `/v1`.

Helpers:

- `discoverHubs()`
- `discoverRooms()`
- `resolveGambiTarget()`

These helpers remain explicit. `createGambi()` and `createClient()` do not perform implicit discovery.

## Operational surfaces

### CLI

Optimized for human-readable text and machine-readable JSON/NDJSON.

Important traits:

- flag-first
- pipe-friendly
- `--interactive` and `--no-interactive`
- XDG config support
- NDJSON on streaming commands when stdout is piped

### SDK management client

Optimized for code-driven operational workflows.

Namespaces:

- `client.rooms.*`
- `client.participants.*`
- `client.events.watchRoom()`

### TUI

Optimized for human monitoring. It is not the canonical operational contract.

## Repository map

- `packages/core`: hub runtime and contracts
- `packages/cli`: operational CLI
- `packages/sdk`: inference provider and management client
- `apps/tui`: monitoring interface
- `apps/docs`: documentation site

## Security model

Gambi is designed for trusted local networks. The hub does not include native authentication. Do not expose it publicly without an external auth and proxy layer.
