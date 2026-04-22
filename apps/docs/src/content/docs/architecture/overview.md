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

### SSE for observability

- one-way room event stream is enough for monitoring
- powers the TUI and operational clients
- keeps operational visibility separate from inference transport

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

## Protocol Strategy

The default protocol is Responses. Chat Completions remains available for compatibility.

When needed, the hub can adapt between Responses and Chat Completions so that participants and clients do not have to support the same surface natively.

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
- it does not try to be an agent orchestrator yet

The future `gambi agents` direction builds above this transport layer rather than replacing it.
