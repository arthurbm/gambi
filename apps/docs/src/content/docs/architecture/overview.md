---
title: Architecture Overview
description: How Gambi works under the hood and why the system is split into public HTTP surfaces and participant tunnels.
---

# Architecture Overview

Gambi exposes an HTTP management plane, an OpenAI-compatible HTTP inference plane, and a participant tunnel between the hub and each registered participant.

## System Diagram

```text
┌──────────────────────────────────────────────┐
│                 GAMBI HUB                    │
│                                              │
│  Management API        Inference API         │
│  /v1/*                 /rooms/:code/v1/*     │
│                                              │
│  SSE events            Routing engine        │
│                                              │
│  Participant tunnel registry and sessions    │
└──────────────────────────────────────────────┘
       ▲                    ▲              ▲
       │ HTTP               │ HTTP         │ WebSocket
       │                    │              │
  ┌────┴────┐          ┌────┴────┐    ┌────┴─────────┐
  │ SDK and │          │ Apps and │    │ Participant │
  │ CLI ops │          │ AI tools │    │ runtimes    │
  └─────────┘          └──────────┘    └─────────────┘
```

## Core Idea

Application clients still talk to Gambi over standard HTTP. That keeps the system compatible with OpenAI-style tooling and SDKs.

Participants no longer need to publish a network-reachable provider endpoint. Instead, the participant runtime opens a tunnel to the hub and forwards inference requests to its local or remote provider.

## Registration Flow

1. The participant runtime probes its provider endpoint locally.
2. It registers with `PUT /v1/rooms/:code/participants/:id`.
3. The hub returns `{ participant, roomId, tunnel }`.
4. The runtime opens `GET /v1/rooms/:code/participants/:id/tunnel?token=...`.
5. The hub upgrades the connection and starts forwarding tunnel requests.
6. The runtime keeps sending management heartbeats.

## Request Flow

1. An application sends `POST /rooms/:code/v1/responses` or `POST /rooms/:code/v1/chat/completions`.
2. The hub resolves routing by participant ID, `model:<name>`, or `*`.
3. The hub forwards the request through the participant tunnel.
4. The participant runtime forwards it to the real provider endpoint.
5. The runtime streams the provider response back through the tunnel.
6. The hub returns the response to the application client.

## Why This Split Exists

### HTTP for apps

- standard OpenAI-compatible interface
- works with existing SDKs and tools
- easy to debug with normal HTTP tooling

### WebSocket for participant transport

- lets providers stay on `localhost`
- keeps provider credentials on the participant runtime
- avoids asking participants to publish network endpoints just to join a room
- carries opaque ACP v1 messages and artifacts for harness participants
- lets management clients attach through the hub without the hub initiating any connection to the participant

### SSE for observability

- one-way room event stream is enough for monitoring
- powers the TUI and operational clients
- keeps operational visibility separate from inference transport

Optional applications can build coordination above these contracts. The
repository event board uses `gambi-sdk` to attach to harness participants and
stores its own workflow in SQLite. Its local `/events` stream is not the hub
room stream and does not change the public hub API.

## Routing Rules

The `model` field controls participant selection:

| Value | Behavior |
| --- | --- |
| `*` or `any` | random available participant |
| `model:<name>` | first available participant matching that model |
| `<participant-id>` | specific participant |

A participant is available only when:

- its tunnel is connected
- it is not offline
- it is not already handling another request

## Tunnel Protocol

The tunnel is a WebSocket between the hub and the participant runtime. Messages are JSON objects with a `type` field.

Server → participant:

- `tunnel.request` — a forwarded inference request. Includes `requestId`, HTTP `method`, `path`, `headers`, `body`, and a `stream` flag.
- `tunnel.pong` — reply to a participant ping.
- `tunnel.harness.message` — opaque ACP JSON-RPC for a `sessionId`.
- `tunnel.harness.control` — open or close a harness session.

Participant → server:

- `tunnel.response.start` — response headers and HTTP status for `requestId`.
- `tunnel.response.chunk` — one streamed body chunk for `requestId`.
- `tunnel.response.end` — the response body is complete.
- `tunnel.response.error` — the participant runtime failed to produce a response; includes a `stage` label and a human-readable `message`.
- `tunnel.ping` — keepalive from the participant.
- `tunnel.harness.message` — opaque ACP JSON-RPC response or update.
- `tunnel.harness.artifact` — versioned workspace files.
- `tunnel.harness.status` — opened, closed, or error state.

The management attach route fans harness output out to every attached client. An attached client socket is independent of the participant tunnel, so a participant reconnect does not force clients to reattach.

See `packages/core/src/tunnel-protocol.ts` for the authoritative schemas.

## Protocol Adaptation (Responses ↔ Chat Completions)

The default protocol is Responses. Chat Completions remains available for compatibility.

When the client and the participant do not speak the same surface natively, the hub adapts between them. Two practical consequences:

- a client using Responses can reach a participant that only exposes Chat Completions, and vice versa
- the adapter focuses on the message-level contract; stateful Responses features such as `previous_response_id`, `store`, and `background` may be limited or unsupported when the underlying participant is a Chat Completions endpoint

New integrations should prefer Responses. Fall back to Chat Completions only when you need explicit compatibility with an existing tool.

## Health Timings

Two constants drive liveness, both defined in `packages/core/src/types.ts`:

- `HEALTH_CHECK_INTERVAL = 10_000 ms` — cadence for participant heartbeats and for tunnel pings.
- `PARTICIPANT_TIMEOUT = 30_000 ms` — after this window without a heartbeat, the hub marks the participant offline. The tunnel uses the same window before closing a silent connection.

If you build a custom participant runtime, match these windows. `createParticipantSession()` does it for you.

## Observability

The hub emits:

- `llm.request`
- `llm.complete`
- `llm.error`

`llm.complete` includes baseline metrics such as:

- `ttftMs`
- `durationMs`
- `inputTokens`
- `outputTokens`
- `totalTokens`
- `tokensPerSecond`

## What Gambi Does Not Do

- it does not host the models itself
- it does not add built-in authentication to the hub
- the hub does not orchestrate agents; optional packages and applications may
  coordinate work through the SDK without moving that policy into the hub

The future `gambi agents` direction builds above this transport layer rather than replacing it.
